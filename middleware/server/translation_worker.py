#!/usr/bin/env python3
"""
Translation Worker - 缈昏瘧浠诲姟鎵ц鍣?
灏佽 main.py 鐨勭炕璇戦€昏緫锛屾敮鎸佸紓姝ユ墽琛屽拰杩涘害鍥炶皟

淇锛?
- 甯搁┗ llama-server锛岄伩鍏嶅喎鍚姩鍦扮嫳
- 杩涚▼缁勯攢姣侊紝閬垮厤鍍靛案杩涚▼
- PYTHONUNBUFFERED=1 纭繚鏃ュ織鍗虫椂鎬?
"""

import os
import sys
import signal
import asyncio
import tempfile
import subprocess
import threading
import time
import json
import requests
from pathlib import Path
from typing import Optional, Callable, List
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime

# 娣诲姞鐖剁洰褰曞埌 path
sys.path.insert(0, str(Path(__file__).parent.parent))


class TaskStatus(Enum):
    """浠诲姟鐘舵€?""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TranslationTask:
    """缈昏瘧浠诲姟"""
    task_id: str
    request: object  # TranslateRequest from api_server
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)

    # 杩涘害
    progress: float = 0.0
    current_block: int = 0
    total_blocks: int = 0

    # 缁撴灉
    result: Optional[str] = None
    output_path: Optional[str] = None
    error: Optional[str] = None

    # 鏃ュ織锛堥檺鍒舵渶澶ф潯鏁伴槻姝㈠唴瀛樻硠婕忥級
    logs: List[str] = field(default_factory=list)
    MAX_LOG_LINES: int = field(default=500, repr=False)  # 鏈€澶氫繚鐣?500 鏉℃棩蹇?

    # 鎺у埗
    cancel_requested: bool = False
    _process: Optional[asyncio.subprocess.Process] = field(default=None, repr=False)

    def add_log(self, message: str):
        """娣诲姞鏃ュ織锛岃嚜鍔ㄩ檺鍒舵潯鏁伴槻姝㈠唴瀛樿啫鑳€"""
        self.logs.append(message)
        # 瓒呰繃闄愬埗鏃跺彧淇濈暀鏈€鏂扮殑鏃ュ織锛堜娇鐢ㄥ畨鍏ㄧ殑鍒囩墖閫昏緫锛?
        if len(self.logs) > self.MAX_LOG_LINES:
            # 鍙繚鐣欐渶鏂扮殑 MAX_LOG_LINES 鏉★紝閬垮厤澶嶆潅鐨勫ご灏炬嫾鎺ュ鑷撮敊涔?
            self.logs = self.logs[-self.MAX_LOG_LINES:]


class TranslationWorker:
    """
    缈昏瘧宸ヤ綔鍣?- 绠＄悊甯搁┗ llama-server 鍜岀炕璇戜换鍔?

    鏋舵瀯锛?
    1. 鍚姩鏃跺惎鍔ㄥ父椹?llama-server锛堟ā鍨嬪父椹诲唴瀛橈級
    2. 缈昏瘧浠诲姟浣跨敤 --no-server-spawn 杩炴帴甯搁┗鏈嶅姟鍣?
    3. 杩涚▼浣跨敤杩涚▼缁勶紝纭繚 cancel 鏃跺瓙杩涚▼涓€璧烽攢姣?
    """

    def __init__(self, model_path: Optional[str] = None, port: int = 8080):
        self.model_path = model_path or os.environ.get("MURASAKI_DEFAULT_MODEL")
        self.server_process = None
        self.server_port = port
        self.server_host = "127.0.0.1"
        self.start_time = time.time()
        self._lock = threading.Lock()
        self._server_ready = False

        # 骞跺彂鎺у埗锛氶槻姝㈤厤缃彉鏇存椂鏉€姝绘鍦ㄨ繍琛岀殑浠诲姟
        self._running_tasks = 0  # 姝ｅ湪杩愯鐨勪换鍔℃暟
        self._tasks_lock = threading.Lock()  # 浠诲姟璁℃暟閿?

        # 鏈嶅姟鍣ㄩ厤缃紦瀛橈細鐢ㄤ簬妫€娴嬪弬鏁板彉鍖?
        self._current_config = {
            "model_path": None,
            "ctx": None,
            "gpu_layers": None,
            "flash_attn": None,
            "kv_cache_type": None
        }

    def is_ready(self) -> bool:
        """妫€鏌ユ湇鍔″櫒鏄惁灏辩华"""
        if not self._server_ready:
            return False
        if self.server_process is None:
            return False
        return self.server_process.poll() is None

    def uptime(self) -> float:
        """鑾峰彇杩愯鏃堕棿"""
        return time.time() - self.start_time

    def _find_llama_server(self) -> str:
        """鏌ユ壘 llama-server 浜岃繘鍒讹紙甯?NVIDIA GPU 妫€娴嬶級"""
        middleware_dir = Path(__file__).parent.parent

        if sys.platform == 'linux':
            # 淇锛氫娇鐢?which 妫€娴嬭€岄潪纭紪鐮佽矾寰?
            has_nvidia = self._check_nvidia_gpu()
            if has_nvidia:
                candidate = middleware_dir / 'bin' / 'linux-cuda' / 'llama-server'
                if not candidate.exists():
                    candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
            else:
                candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
        elif sys.platform == 'darwin':
            import platform
            if 'arm' in platform.machine().lower():
                candidate = middleware_dir / 'bin' / 'darwin-metal' / 'llama-server'
            else:
                candidate = middleware_dir / 'bin' / 'darwin-x64' / 'llama-server'
        else:
            # Windows: 妫€娴?nvidia-smi
            has_nvidia = self._check_nvidia_gpu()
            if has_nvidia:
                candidate = middleware_dir / 'bin' / 'win-cuda' / 'llama-server.exe'
            else:
                candidate = middleware_dir / 'bin' / 'win-vulkan' / 'llama-server.exe'

        # 鍥為€€鍒版棫鐩綍缁撴瀯
        if not candidate.exists():
            for subdir in middleware_dir.iterdir():
                if subdir.is_dir():
                    binary_name = 'llama-server.exe' if sys.platform == 'win32' else 'llama-server'
                    legacy_path = subdir / binary_name
                    if legacy_path.exists():
                        return str(legacy_path)

        if not candidate.exists():
            raise FileNotFoundError(f"llama-server not found: {candidate}")

        return str(candidate)

    def _check_nvidia_gpu(self) -> bool:
        """璺ㄥ钩鍙版娴?NVIDIA GPU锛堟敮鎸?Windows 澶氳矾寰勶級"""
        import shutil
        # Windows 涓?nvidia-smi 鍙兘涓嶅湪 PATH 涓?
        nvidia_smi_paths = ['nvidia-smi']
        if sys.platform == 'win32':
            nvidia_smi_paths.extend([
                r'C:\Windows\System32\nvidia-smi.exe',
                r'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe'
            ])

        for nvidia_smi in nvidia_smi_paths:
            try:
                # 妫€鏌ュ懡浠ゆ槸鍚﹀瓨鍦?
                if not os.path.isabs(nvidia_smi) and not shutil.which(nvidia_smi):
                    continue
                if os.path.isabs(nvidia_smi) and not os.path.exists(nvidia_smi):
                    continue

                result = subprocess.run(
                    [nvidia_smi, '--query-gpu=name', '--format=csv,noheader'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    logging.info(f"NVIDIA GPU detected: {result.stdout.strip()}")
                    return True
            except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                continue

        logging.info("No NVIDIA GPU detected, using Vulkan/Metal fallback")
        return False

    async def start_server(self, gpu_layers: int = -1, ctx: int = 8192,
                          flash_attn: bool = False, kv_cache_type: str = "f16"):
        """鍚姩甯搁┗ llama-server锛堟ā鍨嬪父椹诲唴瀛橈級"""
        if self.server_process and self.server_process.poll() is None:
            return  # 宸插湪杩愯

        if not self.model_path:
            raise ValueError("Model path not set")

        # 淇濆瓨褰撳墠閰嶇疆
        self._current_config = {
            "model_path": self.model_path,
            "ctx": ctx,
            "gpu_layers": gpu_layers,
            "flash_attn": flash_attn,
            "kv_cache_type": kv_cache_type
        }

        server_path = self._find_llama_server()

        cmd = [
            server_path,
            "-m", self.model_path,
            "--host", self.server_host,
            "--port", str(self.server_port),
            "-ngl", str(gpu_layers),
            "-c", str(ctx),
            "--parallel", "4",  # 鏀寔骞跺彂璇锋眰
            "--reasoning-format", "deepseek-legacy",
            "--metrics"
        ]

        if flash_attn:
            cmd.extend(["-fa", "on"])
        if kv_cache_type:
            cmd.extend(["--cache-type-k", kv_cache_type, "--cache-type-v", kv_cache_type])

        # 浣跨敤杩涚▼缁勫惎鍔紝纭繚瀛愯繘绋嬪彲琚竴璧烽攢姣?
        if sys.platform != 'win32':
            self.server_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True  # 鍒涘缓鏂拌繘绋嬬粍
            )
        else:
            # Windows: 浣跨敤 CREATE_NEW_PROCESS_GROUP
            self.server_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )

        # 绛夊緟鏈嶅姟鍣ㄥ氨缁?
        await self._wait_for_server_ready()
        self._server_ready = True

    async def _wait_for_server_ready(self, timeout: int = 180):
        """绛夊緟 llama-server 灏辩华"""
        start = time.time()
        url = f"http://{self.server_host}:{self.server_port}/v1/models"

        while time.time() - start < timeout:
            if self.server_process and self.server_process.poll() is not None:
                raise RuntimeError(f"llama-server exited with code {self.server_process.returncode}")

            try:
                resp = requests.get(url, timeout=2)
                if resp.status_code == 200:
                    return
            except requests.RequestException:
                pass

            await asyncio.sleep(1)

        raise TimeoutError("llama-server failed to start within timeout")

    def stop_server(self):
        """鍋滄甯搁┗鏈嶅姟鍣紙杩涚▼缁勯攢姣侊級"""
        if self.server_process:
            pid = self.server_process.pid

            if sys.platform != 'win32':
                # Unix: 鏉€姝绘暣涓繘绋嬬粍
                try:
                    os.killpg(os.getpgid(pid), signal.SIGTERM)
                    self.server_process.wait(timeout=5)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        os.killpg(os.getpgid(pid), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            else:
                # Windows: 浣跨敤 taskkill /T 鏉€姝昏繘绋嬫爲
                try:
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        capture_output=True,
                        timeout=5
                    )
                except subprocess.TimeoutExpired:
                    pass

            self.server_process = None
            self._server_ready = False

    async def translate(self, task: TranslationTask) -> str:
        """
        鎵ц缈昏瘧浠诲姟锛堜娇鐢ㄥ父椹绘湇鍔″櫒锛?
        """
        request = task.request
        middleware_dir = Path(__file__).parent.parent

        # 鏋勫缓鏂伴厤缃?
        new_config = {
            "model_path": self.model_path,
            "ctx": request.ctx,
            "gpu_layers": request.gpu_layers,
            "flash_attn": request.flash_attn,
            "kv_cache_type": request.kv_cache_type
        }

        # 妫€鏌ラ厤缃槸鍚﹀彉鍖栵紙淇鏈嶅姟鍣ㄥ弬鏁?閿佸畾"闂锛?
        config_changed = (
            self._current_config["ctx"] != new_config["ctx"] or
            self._current_config["gpu_layers"] != new_config["gpu_layers"] or
            self._current_config["model_path"] != new_config["model_path"]
        )

        # 骞跺彂淇濇姢锛氭湁浠诲姟杩愯鏃舵嫆缁濋厤缃彉鏇达紝闃叉鏉€姝绘鍦ㄨ繍琛岀殑浠诲姟
        with self._tasks_lock:
            if self.is_ready() and config_changed:
                if self._running_tasks > 0:
                    # 鏈変换鍔℃鍦ㄨ繍琛岋紝鎷掔粷閰嶇疆鍙樻洿
                    task.add_log(f"[Worker] 閰嶇疆鍙樺寲琚嫆缁濓細褰撳墠鏈?{self._running_tasks} 涓换鍔℃鍦ㄨ繍琛?)
                    task.add_log(f"[Worker] 浣跨敤褰撳墠閰嶇疆缁х画 (ctx: {self._current_config['ctx']})")
                else:
                    # 娌℃湁浠诲姟杩愯锛屽彲浠ュ畨鍏ㄩ噸鍚?
                    task.add_log(f"[Worker] 閰嶇疆鍙樺寲 (ctx: {self._current_config['ctx']} -> {new_config['ctx']}), 閲嶅惎鏈嶅姟鍣?..")
                    await self.stop_server()

            # 澧炲姞杩愯浠诲姟璁℃暟
            self._running_tasks += 1

        try:
            # 纭繚鏈嶅姟鍣ㄥ凡鍚姩
            if not self.is_ready():
                await self.start_server(
                    gpu_layers=request.gpu_layers,
                    ctx=request.ctx,
                    flash_attn=request.flash_attn,
                    kv_cache_type=request.kv_cache_type
                )

        # 鍑嗗杈撳叆
        if request.text:
            # 鏂囨湰妯″紡锛氬啓鍏ヤ复鏃舵枃浠?
            input_file = tempfile.NamedTemporaryFile(
                mode='w', suffix='.txt', delete=False, encoding='utf-8'
            )
            input_file.write(request.text)
            input_file.close()
            input_path = input_file.name
        else:
            # 瀹夊叏楠岃瘉锛歠ile_path 蹇呴』鍦ㄥ厑璁哥殑鐩綍鍐?
            # 闃叉璺緞閬嶅巻鏀诲嚮锛堝 ../../etc/passwd锛?
            uploads_dir = middleware_dir / "uploads"
            uploads_dir.mkdir(exist_ok=True)

            requested_path = Path(request.file_path).resolve()

            # 妫€鏌ユ槸鍚﹀湪鍏佽鐨勭洰褰曞唴
            allowed_dirs = [
                uploads_dir.resolve(),
                (middleware_dir / "outputs").resolve(),
            ]

            is_allowed = any(
                str(requested_path).startswith(str(allowed_dir))
                for allowed_dir in allowed_dirs
            )

            if not is_allowed:
                raise ValueError(
                    f"Security error: file_path must be within uploads/ or outputs/ directory. "
                    f"Got: {request.file_path}"
                )

            if not requested_path.exists():
                raise FileNotFoundError(f"File not found: {request.file_path}")

            input_path = str(requested_path)

        # 鍑嗗杈撳嚭璺緞
        output_dir = middleware_dir / "outputs"
        output_dir.mkdir(exist_ok=True)
        output_path = output_dir / f"{task.task_id}_output.txt"
        task.output_path = str(output_path)

        # 鏋勫缓鍛戒护琛屽弬鏁帮紙鍏抽敭锛氫娇鐢?--no-server-spawn 杩炴帴甯搁┗鏈嶅姟鍣級
        cmd = [
            sys.executable,
            str(middleware_dir / "murasaki_translator" / "main.py"),
            "--file", input_path,
            "--output", str(output_path),
            "--preset", request.preset,
            "--mode", request.mode,
            "--chunk-size", str(request.chunk_size),
            "--ctx", str(request.ctx),
            "--gpu-layers", str(request.gpu_layers),
            "--temperature", str(request.temperature),
            # 鍏抽敭淇锛氳繛鎺ュ父椹绘湇鍔″櫒锛屼笉鍐嶆瘡娆″惎鍔ㄦ柊鏈嶅姟鍣?
            "--no-server-spawn",
            "--server-host", self.server_host,
            "--server-port", str(self.server_port),
        ]

        # 鍙€夊弬鏁?
        if request.model:
            cmd.extend(["--model", request.model])
        elif self.model_path:
            cmd.extend(["--model", self.model_path])

        if request.glossary:
            cmd.extend(["--glossary", request.glossary])

        if request.line_check:
            cmd.append("--line-check")

        if request.traditional:
            cmd.append("--traditional")

        if request.save_cot:
            cmd.append("--save-cot")

        if request.rules_pre:
            cmd.extend(["--rules-pre", request.rules_pre])

        if request.rules_post:
            cmd.extend(["--rules-post", request.rules_post])

        if request.parallel > 1:
            cmd.extend(["--parallel", str(request.parallel)])

        if request.flash_attn:
            cmd.append("--flash-attn")

        if request.kv_cache_type:
            cmd.extend(["--kv-cache-type", request.kv_cache_type])

        # 鎵ц缈昏瘧
        task.add_log(f"[INFO] Running translation (using persistent server on port {self.server_port})...")

        # 璁剧疆鐜鍙橀噺纭繚鏃ュ織鍗虫椂鎬?
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        # 浣跨敤杩涚▼缁勫惎鍔紝纭繚 cancel 鏃跺瓙杩涚▼涓€璧烽攢姣?
        if sys.platform != 'win32':
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(middleware_dir),
                env=env,
                start_new_session=True  # 鍒涘缓鏂拌繘绋嬬粍
            )
        else:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(middleware_dir),
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
            )

        task._process = process

        # 瀹炴椂璇诲彇杈撳嚭
        while True:
            line = await process.stdout.readline()
            if not line:
                break

            line_text = line.decode('utf-8', errors='ignore').strip()
            if line_text:
                task.add_log(line_text)

                # 瑙ｆ瀽杩涘害
                if "PROGRESS:" in line_text:
                    try:
                        progress_json = line_text.split("PROGRESS:")[-1]
                        progress_data = json.loads(progress_json)
                        task.current_block = progress_data.get("current", 0)
                        task.total_blocks = progress_data.get("total", 0)
                        if task.total_blocks > 0:
                            task.progress = task.current_block / task.total_blocks
                    except:
                        pass

            # 妫€鏌ュ彇娑堣姹?
            if task.cancel_requested:
                await self._kill_process_tree(process)
                task.status = TaskStatus.CANCELLED
                task.add_log("[WARN] Translation cancelled by user")
                return ""

        await process.wait()
        task._process = None

        # 璇诲彇缁撴灉
        if process.returncode == 0 and output_path.exists():
            with open(output_path, 'r', encoding='utf-8') as f:
                result = f.read()

            # 濡傛灉鏄枃鏈ā寮忥紝娓呯悊涓存椂鏂囦欢
            if request.text:
                os.unlink(input_path)

            return result
        else:
            raise RuntimeError(f"Translation failed with code {process.returncode}")
        finally:
            # 鍑忓皯杩愯浠诲姟璁℃暟
            with self._tasks_lock:
                self._running_tasks -= 1

    async def _kill_process_tree(self, process: asyncio.subprocess.Process):
        """鏉€姝昏繘绋嬫爲锛堜慨澶嶅兊灏歌繘绋嬮棶棰橈級"""
        pid = process.pid

        if sys.platform != 'win32':
            # Unix: 鏉€姝绘暣涓繘绋嬬粍
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
                await asyncio.sleep(0.5)
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass
        else:
            # Windows: 浣跨敤 taskkill /T 鏉€姝昏繘绋嬫爲
            try:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True,
                    timeout=5
                )
            except subprocess.TimeoutExpired:
                pass


# ============================================
# 鐙珛杩愯娴嬭瘯
# ============================================
if __name__ == "__main__":
    import asyncio

    async def test():
        worker = TranslationWorker()

        class MockRequest:
            text = "銇撱倱銇仭銇€佷笘鐣岋紒"
            file_path = None
            model = None
            glossary = None
            preset = "default"
            mode = "line"
            chunk_size = 1000
            ctx = 8192
            gpu_layers = -1
            temperature = 0.3
            line_check = False
            traditional = False
            save_cot = False
            rules_pre = None
            rules_post = None
            parallel = 1
            flash_attn = False
            kv_cache_type = "f16"

        task = TranslationTask(
            task_id="test001",
            request=MockRequest()
        )

        try:
            result = await worker.translate(task)
            print(f"Result: {result}")
            print(f"Logs: {task.logs}")
        finally:
            worker.stop_server()

    asyncio.run(test())
