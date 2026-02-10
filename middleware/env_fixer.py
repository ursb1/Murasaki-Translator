#!/usr/bin/env python3
"""
Murasaki 鐜淇宸ュ叿
鐢ㄤ簬璇婃柇鍜屼慨澶嶅唴宓岀殑 Python銆丆UDA銆乂ulkan 鐜闂

璁捐鐞嗗康锛?
1. 姣忎釜缁勪欢鐙珛妫€娴嬪拰淇
2. 缁欑敤鎴锋竻鏅扮殑閫夐」鍜岀‘璁?
3. 杈撳嚭缁撴瀯鍖朖SON鎶ュ憡锛屼究浜庡墠绔睍绀?
"""

import os
import sys
import subprocess
import shutil
import json
import platform
import re
import argparse
import socket
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Literal

class EnvFixerError(Exception):
    """鐜淇宸ュ叿涓撶敤寮傚父"""
    pass

# 鍏ㄥ眬闈欓粯妯″紡鏍囧織锛岀敤浜?JSON 杈撳嚭鏃剁鐢ㄥ僵鑹叉枃鏈?
_QUIET_MODE = False

class Colors:
    """缁堢棰滆壊杈撳嚭"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_header(text: str):
    if _QUIET_MODE:
        return
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text:^60}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.END}\n")

def print_success(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.GREEN}鉁搟Colors.END} {text}")

def print_error(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.RED}鉁梴Colors.END} {text}")

def print_warning(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.YELLOW}鈿爗Colors.END} {text}")

def print_info(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.CYAN}鈩箋Colors.END} {text}")

def print_step(step: int, total: int, text: str):
    if _QUIET_MODE:
        return
    print(f"\n{Colors.BOLD}[{step}/{total}] {text}{Colors.END}")

def emit_progress(stage: str, progress: int, message: str = "", total_bytes: int = 0, downloaded_bytes: int = 0):
    """杈撳嚭 JSON 鏍煎紡鐨勮繘搴︿俊鎭紝渚涘墠绔疄鏃惰В鏋?

    Args:
        stage: 褰撳墠闃舵鍚嶇О锛堝 'download', 'install', 'pip'锛?
        progress: 杩涘害鐧惧垎姣?(0-100)
        message: 鍙€夌殑杩涘害娑堟伅
        total_bytes: 鎬诲瓧鑺傛暟锛堢敤浜庝笅杞斤級
        downloaded_bytes: 宸蹭笅杞藉瓧鑺傛暟
    """
    progress_data = {
        "type": "progress",
        "stage": stage,
        "progress": progress,
        "message": message
    }
    if total_bytes > 0:
        progress_data["totalBytes"] = total_bytes
        progress_data["downloadedBytes"] = downloaded_bytes
    # 浣跨敤鐗规畩鍓嶇紑鏍囪杩欐槸杩涘害淇℃伅锛屼究浜?IPC 瑙ｆ瀽
    print(f"__PROGRESS__:{json.dumps(progress_data)}", flush=True)

def download_with_progress(url: str, dest_path: Path, stage_name: str = "download") -> bool:
    """甯﹁繘搴﹀洖璋冪殑涓嬭浇鍑芥暟

    Args:
        url: 涓嬭浇鍦板潃
        dest_path: 淇濆瓨璺緞
        stage_name: 闃舵鍚嶇О锛堢敤浜庤繘搴﹁緭鍑猴級

    Returns:
        鏄惁涓嬭浇鎴愬姛
    """
    try:
        emit_progress(stage_name, 0, f"姝ｅ湪杩炴帴 {url[:50]}...")

        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, timeout=60)

        total_size = int(response.headers.get('Content-Length', 0))
        downloaded = 0
        block_size = 8192

        with open(dest_path, 'wb') as f:
            while True:
                chunk = response.read(block_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)

                if total_size > 0:
                    percent = int((downloaded / total_size) * 100)
                    size_mb = downloaded / (1024 * 1024)
                    total_mb = total_size / (1024 * 1024)
                    emit_progress(stage_name, percent, f"{size_mb:.1f}/{total_mb:.1f} MB", total_size, downloaded)
                else:
                    size_mb = downloaded / (1024 * 1024)
                    emit_progress(stage_name, 50, f"宸蹭笅杞?{size_mb:.1f} MB")

        emit_progress(stage_name, 100, "涓嬭浇瀹屾垚")
        return True

    except Exception as e:
        emit_progress(stage_name, -1, f"涓嬭浇澶辫触: {str(e)}")
        return False

def run_command(cmd: List[str], timeout: int = 10) -> Tuple[bool, str]:
    """鎵ц鍛戒护骞惰繑鍥炵粨鏋?""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding='utf-8',
            errors='replace'
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, f"Command timed out after {timeout}s"
    except Exception as e:
        return False, str(e)

class ComponentChecker:
    """缁勪欢妫€鏌ュ熀绫?""

    def __init__(self, name: str):
        self.name = name
        self.status: Literal['ok', 'warning', 'error'] = 'ok'
        self.version: Optional[str] = None
        self.path: Optional[str] = None
        self.issues: List[str] = []
        self.fixes: List[str] = []
        self.can_auto_fix = False

    def check(self) -> None:
        """妫€鏌ョ粍浠剁姸鎬侊紝鐢卞瓙绫诲疄鐜?""
        raise NotImplementedError

    def fix(self) -> Dict[str, any]:
        """灏濊瘯淇缁勪欢锛岀敱瀛愮被瀹炵幇"""
        return {'success': False, 'message': '涓嶆敮鎸佽嚜鍔ㄤ慨澶?}

    def to_dict(self) -> Dict[str, any]:
        """杞崲涓哄瓧鍏告牸寮?""
        return {
            'name': self.name,
            'status': self.status,
            'version': self.version,
            'path': self.path,
            'issues': self.issues,
            'fixes': self.fixes,
            'canAutoFix': self.can_auto_fix
        }

class PythonChecker(ComponentChecker):
    """Python 鐜妫€鏌ュ櫒 - 妫€鏌ュ唴宓孭ython鍜屼緷璧栧畬鏁存€?""

    def __init__(self):
        super().__init__('Python')
        self.platform = platform.system()
        self.can_auto_fix = True  # 鍙互鑷姩瀹夎缂哄け鐨勪緷璧栧寘
        # 瀹為檯 requirements.txt 涓殑蹇呰渚濊禆锛堝鍏ュ悕锛?
        self.required_packages = [
            'requests',      # HTTP 瀹㈡埛绔?
            'lxml',          # EPUB 澶勭悊
            'bs4',           # beautifulsoup4
            'tqdm',          # 杩涘害鏉?
            'opencc',        # 绻佺畝杞崲 (opencc-python-reimplemented)
        ]
        # 鍙€変緷璧栵紙妫€娴嬩絾涓嶅己鍒讹級
        self.optional_packages = [
            'pynvml',        # GPU 鐩戞帶
            'fugashi',       # 鏃ヨ鍒嗚瘝 (MeCab)
        ]
        self.missing_packages: List[str] = []
        self.missing_optional: List[str] = []

    def check(self) -> None:
        """妫€鏌ュ唴宓?Python 鐜鍜屼緷璧栧畬鏁存€?""

        # 浣跨敤缁濆璺緞瀹氫綅锛岄伩鍏嶇浉瀵硅矾寰勫湪鎵撳寘鍚庡け鏁?
        script_dir = Path(__file__).parent.resolve()
        python_path = None

        # [璋冭瘯] 鎵撳嵃褰撳墠鑴氭湰鐩綍锛屼究浜庢帓鏌?Release 鐜璺緞闂
        print_info(f"鑴氭湰鐩綍: {script_dir}")

        # 鏋勫缓 Python 鍙墽琛屾枃浠跺悕
        python_exes = ['python.exe'] if self.platform == 'Windows' else ['python3', 'python']
        python_subdir = 'Scripts' if self.platform == 'Windows' else 'bin'

        # 澶氱鍙兘璺緞锛屾寜浼樺厛绾ф帓搴?        possible_paths = []

        # 1. Release 鐜: middleware 鍚岀骇 python_env锛堜紭鍏堢骇鏈€楂橈級
        #    鍏煎 resources/python_env/{python.exe|bin/python3}
        python_env_roots = [
            script_dir / 'python_env',
            script_dir.parent / 'python_env',
        ]
        for root in python_env_roots:
            for exe in python_exes:
                possible_paths.append(root / exe)
                possible_paths.append(root / python_subdir / exe)

        # 2. 寮€鍙戠幆澧? middleware/.venv
        for exe in python_exes:
            possible_paths.append(script_dir / '.venv' / python_subdir / exe)
            possible_paths.append(script_dir.parent / '.venv' / python_subdir / exe)
            possible_paths.append(script_dir.parent / 'middleware' / '.venv' / python_subdir / exe)

        # 3. 鏈€鍚庡洖閫€鍒?PATH 涓殑 Python锛堝挨鍏舵槸 macOS/Linux 鐨?python3锛?        if self.platform == 'Windows':
            possible_paths.extend([Path('python.exe'), Path('python')])
        else:
            possible_paths.extend([Path('python3'), Path('python')])

        # 鎸変紭鍏堢骇鏌ユ壘绗竴涓瓨鍦ㄧ殑璺緞
        for path in possible_paths:
            # PATH 鍛戒护
            if str(path) in ('python', 'python3', 'python.exe'):
                resolved = shutil.which(str(path))
                if resolved:
                    python_path = Path(resolved)
                    break
                continue
            if path.exists():
                python_path = path.resolve()
                break

        if not python_path:
            self.status = 'error'
            self.issues.append("鍐呭祵 Python 鐜鏈壘鍒?)
            self.fixes.append("閲嶆柊瀹夎 Murasaki Translator")
            self.can_auto_fix = False
            print_error("鏈壘鍒板唴宓?Python 鐜")
            return

        self.path = str(python_path)
        print_success(f"鎵惧埌鍐呭祵 Python: {python_path}")

        # 妫€鏌?Python 鐗堟湰
        success, output = run_command([str(python_path), '--version'], timeout=10)
        if not success:
            self.status = 'error'
            self.issues.append("Python 鐜鎹熷潖")
            self.fixes.append("閲嶆柊瀹夎 Murasaki Translator")
            self.can_auto_fix = False
            print_error("Python 鐜鎹熷潖")
            return

        version_match = re.search(r'Python (\d+\.\d+\.\d+)', output)
        if version_match:
            self.version = version_match.group(1)
            major, minor = map(int, self.version.split('.')[:2])
            if (major, minor) < (3, 10):
                self.status = 'error'
                self.issues.append(f"Python 鐗堟湰杩囦綆: {self.version} (闇€瑕?>= 3.10)")
                self.fixes.append("閲嶆柊瀹夎 Murasaki Translator")
                self.can_auto_fix = False
                print_error(f"Python 鐗堟湰 {self.version} 浣庝簬椤圭洰鏈€浣庤姹?(3.10)")
                return
            print_success(f"妫€娴嬪埌绗﹀悎鏍囧噯鐨?Python 鐜: v{self.version}")

        print_info("姝ｅ湪蹇€熸壂鎻忔牳蹇冭繍琛屽簱缁勪欢...")

        # 妫€鏌ュ叧閿緷璧栧寘
        for package in self.required_packages:
            success, output = run_command([str(python_path), '-c', f'import {package}'], timeout=5)
            if not success:
                self.missing_packages.append(package)
                print_error(f"缂哄皯蹇呰渚濊禆: {package}")

        # 妫€鏌ュ彲閫変緷璧?
        for package in self.optional_packages:
            success, output = run_command([str(python_path), '-c', f'import {package}'], timeout=5)
            if not success:
                self.missing_optional.append(package)
                print_warning(f"缂哄皯鍙€変緷璧? {package}")

        if self.missing_packages:
            self.status = 'error'
            self.issues.append(f"缂哄皯 {len(self.missing_packages)} 涓牳蹇冭繍琛屼緷璧? {', '.join(self.missing_packages)}")
            self.fixes.append("鐐瑰嚮涓嬫柟銆屼竴閿畨瑁呬緷璧栥€嶅皢鑷姩涓轰綘閰嶇疆瀹屾暣鐨勮繍琛岀幆澧?)
        elif self.missing_optional:
            self.status = 'warning'
            self.issues.append(f"缂哄皯鍙€夊姛鑳界粍浠? {', '.join(self.missing_optional)} (褰卞搷 GPU 鐩戞帶鎴栨棩璇垎璇?")
            self.fixes.append("鍙互鐐瑰嚮鑷姩瀹夎锛屾垨鍦ㄩ渶瑕佽繖浜涘姛鑳芥椂鍐嶅畨瑁?)
        else:
            print_success("鎵€鏈変緷璧栧寘宸插畨瑁?)

    def fix(self) -> Dict[str, any]:
        """鑷姩瀹夎缂哄け鐨勪緷璧栧寘"""
        if not self.path:
            return {'success': False, 'message': 'Python 鐜鏈壘鍒?}

        if not self.missing_packages:
            return {'success': True, 'message': '娌℃湁闇€瑕佸畨瑁呯殑渚濊禆鍖?}

        print_info(f"姝ｅ湪瀹夎 {len(self.missing_packages)} 涓己澶辩殑渚濊禆鍖?..")
        emit_progress("pip_install", 0, f"鍑嗗瀹夎 {len(self.missing_packages)} 涓緷璧栧寘...")

        # 鍖呭悕鏄犲皠锛堟湁浜涘寘鐨勫鍏ュ悕鍜屽畨瑁呭悕涓嶅悓锛?
        package_map = {
            'PIL': 'Pillow',
        }

        install_packages = [package_map.get(pkg, pkg) for pkg in self.missing_packages]

        emit_progress("pip_install", 10, f"姝ｅ湪瀹夎: {', '.join(install_packages)}")

        # 浣跨敤 pip 瀹夎缂哄け鐨勫寘锛堥暅鍍忓け璐ユ椂鍥為€€瀹樻柟婧愶紝鎻愬崌璺ㄥ钩鍙板彲鐢ㄦ€э級
        pip_cmds = [
            [
                self.path, '-m', 'pip', 'install',
                '--disable-pip-version-check',
                '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple',
                '--trusted-host', 'pypi.tuna.tsinghua.edu.cn'
            ] + install_packages,
            [
                self.path, '-m', 'pip', 'install',
                '--disable-pip-version-check'
            ] + install_packages,
        ]

        success = False
        output = ""
        for idx, pip_cmd in enumerate(pip_cmds):
            source_name = "娓呭崕闀滃儚" if idx == 0 else "瀹樻柟 PyPI"
            emit_progress("pip_install", 20 + idx * 30, f"灏濊瘯瀹夎婧? {source_name}")
            success, output = run_command(pip_cmd, timeout=300)  # 5鍒嗛挓瓒呮椂
            if success:
                break

        emit_progress("pip_install", 100, "瀹夎瀹屾垚" if success else "瀹夎澶辫触")

        if success:
            print_success(f"鎴愬姛瀹夎渚濊禆鍖? {', '.join(install_packages)}")
            self.missing_packages.clear()
            self.status = 'ok'
            self.issues.clear()
            self.fixes.clear()
            return {'success': True, 'message': f'鎴愬姛瀹夎 {len(install_packages)} 涓緷璧栧寘'}
        else:
            print_error(f"瀹夎澶辫触: {output}")
            return {'success': False, 'message': f'瀹夎澶辫触: {output[:200]}'}

class CUDAChecker(ComponentChecker):
    """CUDA 鐜妫€鏌ュ櫒 - 鍙鏌?GPU 鍜岄┍鍔?""

    def __init__(self):
        super().__init__('CUDA')
        self.platform = platform.system()
        self.driver: Optional[str] = None
        self.gpu: Optional[str] = None
        self.vram: Optional[str] = None
        self.can_auto_fix = False  # CUDA 闇€瑕佹墜鍔ㄥ畨瑁?

    def check(self) -> None:
        """妫€鏌?NVIDIA GPU 鍜岄┍鍔?""
        nvidia_smi_paths = []

        if self.platform == 'Windows':
            nvidia_smi_paths.extend([
                'nvidia-smi',
                'C:\\Windows\\System32\\nvidia-smi.exe',
                'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
            ])
        else:
            nvidia_smi_paths.append('nvidia-smi')

        # 妫€鏌?NVIDIA GPU
        for cmd in nvidia_smi_paths:
            success, output = run_command(
                [cmd, '--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
                timeout=5
            )
            if success and output.strip():
                parts = output.strip().split(', ')
                if len(parts) >= 3:
                    self.gpu = parts[0]
                    self.driver = parts[1]
                    self.vram = parts[2]
                    self.status = 'ok'
                    print_success(f"CUDA鍔犻€熷氨缁? {self.gpu}")
                    print_info(f"  鈹斺攢 纭欢瑙勬牸: 鏄惧瓨 {self.vram}MB | 椹卞姩鐗堟湰 {self.driver}")
                    return

        # 鏈娴嬪埌 GPU
        self.status = 'warning'
        self.issues.append("NVIDIA GPU 鏈娴嬪埌鎴栭┍鍔ㄦ湭瀹夎")
        self.fixes.append("瀹夎 NVIDIA 椹卞姩: https://www.nvidia.com/Download/index.aspx")
        print_warning("鏈娴嬪埌 NVIDIA GPU锛堝皢浣跨敤 Vulkan/CPU 妯″紡锛?)

class VulkanChecker(ComponentChecker):
    """Vulkan 鐜妫€鏌ュ櫒"""

    def __init__(self):
        super().__init__('Vulkan')
        self.platform = platform.system()
        self.devices: List[str] = []
        self.can_auto_fix = self.platform == 'Windows'  # Windows 鏀寔鑷姩瀹夎

    def check(self) -> None:
        """妫€鏌?Vulkan 鐜"""
        success, output = run_command(['vulkaninfo', '--summary'], timeout=10)

        if success:
            version_match = re.search(r'Vulkan Instance Version:\s*(\d+\.\d+\.\d+)', output, re.IGNORECASE)
            if version_match:
                self.version = version_match.group(1)
                self.status = 'ok'
                print_success(f"Vulkan {self.version} 鍙敤")

                # 鎻愬彇璁惧淇℃伅
                gpu_matches = re.finditer(r'GPU\d+:\s*\w+\s*\([^)]+\)', output)
                for match in gpu_matches:
                    device_name = match.group(0)
                    self.devices.append(device_name)
                    print_info(f"  璁惧: {device_name}")
                return

        self.status = 'warning'
        self.issues.append("Vulkan 杩愯鏃舵湭瀹夎")

        if self.platform == 'Windows':
            self.fixes.append("鐐瑰嚮銆屼竴閿畨瑁?Vulkan銆嶈嚜鍔ㄤ笅杞藉苟瀹夎")
            print_warning("Vulkan 杩愯鏃剁粍浠剁己澶?(閫氱敤 GPU 鍔犻€熷彲鑳藉彈闄?")
        elif self.platform == 'Linux':
            self.fixes.append("瀹夎 Vulkan: apt install vulkan-tools (Ubuntu/Debian)")
            print_warning("Vulkan 宸ュ叿閾剧己澶?)
        else:
            self.fixes.append("macOS 鐢ㄦ埛灏嗕娇鐢?Metal 鍚庣")

        print_warning("Llama 鎺ㄧ悊鍚庣灏嗚嚜鍔ㄥ皾璇曞洖閫€鑷?CPU 杩愮畻妯″紡")

    def fix(self) -> Dict[str, any]:
        """鑷姩涓嬭浇骞跺畨瑁?Vulkan Runtime锛堜粎 Windows锛?""
        if self.platform != 'Windows':
            return {'success': False, 'message': '鑷姩瀹夎浠呮敮鎸?Windows 绯荤粺'}

        import tempfile

        # Vulkan Runtime 涓嬭浇鍦板潃锛圠unarG 瀹樻柟锛?
        vulkan_url = "https://sdk.lunarg.com/sdk/download/latest/windows/vulkan-runtime.exe"

        try:
            print_info("姝ｅ湪涓嬭浇 Vulkan Runtime...")

            # 涓嬭浇瀹夎绋嬪簭鍒颁复鏃剁洰褰?
            temp_dir = tempfile.gettempdir()
            installer_path = Path(temp_dir) / "vulkan_runtime_installer.exe"

            # 浣跨敤甯﹁繘搴︾殑涓嬭浇鍑芥暟
            if not download_with_progress(vulkan_url, installer_path, "vulkan_download"):
                return {'success': False, 'message': '涓嬭浇澶辫触'}

            if not installer_path.exists():
                return {'success': False, 'message': '涓嬭浇澶辫触锛氭枃浠舵湭淇濆瓨'}

            print_success(f"涓嬭浇瀹屾垚: {installer_path}")
            print_info("姝ｅ湪瀹夎 Vulkan Runtime锛堥潤榛樻ā寮忥級...")
            emit_progress("vulkan_install", 0, "姝ｅ湪鍚姩瀹夎绋嬪簭...")

            # 闈欓粯瀹夎
            success, output = run_command([str(installer_path), '/S'], timeout=120)

            emit_progress("vulkan_install", 100, "瀹夎瀹屾垚" if success else "瀹夎澶辫触")

            if success:
                print_success("Vulkan Runtime 瀹夎鎴愬姛锛?)
                self.status = 'ok'
                self.issues.clear()
                self.fixes.clear()
                return {'success': True, 'message': 'Vulkan Runtime 瀹夎鎴愬姛'}
            else:
                print_error(f"瀹夎澶辫触: {output}")
                return {'success': False, 'message': f'瀹夎澶辫触: {output[:200]}'}

        except urllib.error.URLError as e:
            emit_progress("vulkan_download", -1, f"涓嬭浇澶辫触: {str(e)}")
            print_error(f"涓嬭浇澶辫触: {e}")
            return {'success': False, 'message': f'涓嬭浇澶辫触: {str(e)}'}
        except Exception as e:
            emit_progress("vulkan_install", -1, f"瀹夎鍑洪敊: {str(e)}")
            print_error(f"瀹夎杩囩▼鍑洪敊: {e}")
            return {'success': False, 'message': f'瀹夎鍑洪敊: {str(e)}'}

class LlamaBackendChecker(ComponentChecker):
    """Llama 鍚庣妫€鏌ュ櫒 - 妫€鏌ュ畨瑁呭拰杩愯鐘舵€?""

    def __init__(self, port: int = 8080):
        super().__init__('LlamaBackend')
        self.platform = platform.system()
        self.can_auto_fix = False
        self.port = port  # 鏀寔浠庡懡浠よ浼犲叆绔彛
        self.error_type: Optional[str] = None  # oom, model, driver, connection, unknown
        self.server_path: Optional[str] = None
        self.is_running = False

    def _get_subdir(self) -> str:
        """鏍规嵁骞冲彴鍜?GPU 杩斿洖浜岃繘鍒跺瓙鐩綍鍚?""
        if self.platform == 'Windows':
            # 妫€鏌ユ槸鍚︽湁 NVIDIA GPU
            has_nvidia = False
            for cmd in ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe']:
                success, _ = run_command([cmd, '--query-gpu=name', '--format=csv,noheader'], timeout=3)
                if success:
                    has_nvidia = True
                    break
            return 'win-cuda' if has_nvidia else 'win-vulkan'
        elif self.platform == 'Darwin':
            import platform as plat
            return 'darwin-metal' if plat.machine() == 'arm64' else 'darwin-x64'
        else:  # Linux
            success, _ = run_command(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], timeout=3)
            return 'linux-cuda' if success else 'linux-vulkan'

    def _find_llama_server(self) -> Optional[str]:
        """鏌ユ壘 llama-server 鍙墽琛屾枃浠讹紙澶嶇敤 platform.ts 閫昏緫锛?""
        middleware_dir = Path(__file__).parent
        binary_name = 'llama-server.exe' if self.platform == 'Windows' else 'llama-server'

        # 1. 灏濊瘯鏂扮殑 bin/{platform}/ 鐩綍锛圧elease 鐜浼樺厛锛?
        subdir = self._get_subdir()
        new_path = middleware_dir / 'bin' / subdir / binary_name
        if new_path.exists():
            return str(new_path)

        # 2. 灏濊瘯鏃х粨鏋勶細鎵弿 middleware 鐩綍涓嬬殑鏃х洰褰曪紙llama-*-bin-* 鎴?llama-*-bin锛?
        for item in middleware_dir.iterdir():
            if item.is_dir() and 'llama' in item.name.lower() and 'bin' in item.name.lower():
                candidate = item / binary_name
                if candidate.exists():
                    print_info(f"鎵惧埌鏃х粨鏋勭殑 llama-server: {candidate}")
                    return str(candidate)

        # 3. 鍥為€€锛氶檺鍒堕€掑綊娣卞害鎼滅储鏁翠釜 middleware 鐩綍锛堝吋瀹规€ф鏌ワ紝鏈€澶?灞傦級
        # 鏂版爣鍑嗙粨鏋? middleware/bin/{platform}/llama-server.exe (depth=2)
        # 鏃х粨鏋? middleware/llama-bin/bin/llama-server.exe (depth=3)
        # [鎬ц兘浼樺寲] 浣跨敤 rglob 鑰岄潪 glob('**/*')锛屽噺灏戠洰褰曢亶鍘嗗紑閿€
        print_info(f"閫掑綊鎼滅储 {binary_name}锛堟渶澶?灞傦級...")
        for item in middleware_dir.rglob(binary_name):
            # 闄愬埗娣卞害锛氭鏌ヨ矾寰勬繁搴︼紝閬垮厤鎵弿娣卞眰鐩綍
            # parts 鍖呭惈鏂囦欢鍚嶏紝鎵€浠ユ繁搴﹂檺鍒堕渶瑕?+1
            depth = len(item.relative_to(middleware_dir).parts)
            if depth > 3:  # 鍏佽鏈€澶?灞傜洰褰曪紙濡?middleware/llama-bin/bin/llama-server.exe锛?
                continue
            if item.is_file():
                print_info(f"閫氳繃閫掑綊鎼滅储鎵惧埌 llama-server: {item}")
                return str(item)

        return None

    def check(self) -> None:
        """妫€鏌?Llama 鍚庣鐘舵€?""
        print_info("妫€鏌?Llama 鍚庣...")

        # Step 1: 妫€鏌ュ畨瑁咃紙鏌ユ壘 llama-server锛?
        self.server_path = self._find_llama_server()
        if not self.server_path:
            self.status = 'error'
            self.issues.append("llama-server 鏈畨瑁?)
            self.fixes.append("璇蜂笅杞藉搴斿钩鍙扮殑 llama.cpp 浜岃繘鍒舵枃浠跺埌 middleware/bin/ 鐩綍")
            print_error("llama-server 鏈壘鍒?)
            return

        self.path = self.server_path
        print_success(f"鎵惧埌 llama-server: {Path(self.server_path).name}")

        # Step 2: 妫€鏌ョ鍙ｆ槸鍚﹀紑鏀撅紙鍒ゆ柇鏄惁姝ｅ湪杩愯锛?
        port_open = False
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex(('127.0.0.1', self.port))
                port_open = (result == 0)
        except Exception:
            pass

        if not port_open:
            # 鍚庣鏈繍琛?- 杩欏彲鑳芥槸姝ｅ父鐨勯潤榛樼姸鎬侊紝涔熷彲鑳芥槸鍚姩澶辫触
            # 浣跨敤 ok 鐘舵€佷絾鏄庣‘璇存槑鎯呭喌锛岃鐢ㄦ埛鑷鍒ゆ柇
            self.status = 'ok'
            self.version = None
            self.is_running = False
            # 娉細杩欓噷鏃犳硶鍖哄垎"鐢ㄦ埛涓诲姩鏈惎鍔?鍜?鍚姩澶辫触"锛岄渶鐢ㄦ埛鏍规嵁瀹為檯鎯呭喌鍒ゆ柇
            print_success("Llama 鎺ㄧ悊鍚庣宸插畨瑁咃紙褰撳墠鏈繍琛岋紝缈昏瘧鏃跺皢鑷姩鍚姩锛?)
            return

        # Step 3: 鍚庣姝ｅ湪杩愯锛屽彂鍖呮祴璇曟帹鐞嗚兘鍔?
        self.is_running = True
        print_info(f"妫€娴嬪埌娲诲姩鍚庣杩涚▼ (绔彛 {self.port})锛屾鍦ㄨ繘琛屽畬鏁存€ф彙鎵嬫祴璇?..")

        try:
            print_info(f"鍙戦€佹暟鎹姤鏂囪繘琛岀鍒扮鎺ㄧ悊闆嗘垚娴嬭瘯...")
            test_url = f'http://127.0.0.1:{self.port}/v1/chat/completions'
            test_payload = json.dumps({
                "model": "default",
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 5,
                "temperature": 0
            }).encode('utf-8')

            req = urllib.request.Request(test_url, data=test_payload, method='POST')
            req.add_header('Content-Type', 'application/json')

            print_info("姝ｅ湪杩涜缈昏瘧娴嬭瘯...")
            try:
                response = urllib.request.urlopen(req, timeout=30)
                content = response.read().decode()
                result = json.loads(content)
            except (json.JSONDecodeError, UnicodeDecodeError, Exception) as e:
                self.status = 'warning'
                self.issues.append(f"杩斿洖鏁版嵁瑙ｆ瀽澶辫触: {str(e)}")
                self.fixes.append("妫€鏌ュ悗绔槸鍚︿负鍏煎鐨?llama-server 鎺ュ彛")
                print_error(f"瑙ｆ瀽鍝嶅簲澶辫触: {e}")
                return

            if 'choices' in result and len(result['choices']) > 0:
                self.status = 'ok'
                self.version = result.get('model', '杩愯涓?)
                print_success(f"娴嬭瘯鎴愬姛: 鍝嶅簲寤舵椂姝ｅ父锛屾ā鍨嬨€寋self.version}銆嶄互鍙婂悗绔湇鍔￠獙璇侀€氳繃")
                return
            else:
                self.status = 'warning'
                self.issues.append("鎺ㄧ悊杩斿洖鏍煎紡寮傚父")
                self.fixes.append("妫€鏌ユā鍨嬫槸鍚︽纭姞杞?)
                return

        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode()
            except:
                pass

            error_lower = error_body.lower()

            # 璇嗗埆甯歌閿欒
            if 'out of memory' in error_lower or 'oom' in error_lower:
                self.status = 'error'
                self.error_type = 'oom'
                self.issues.append("鏄惧瓨涓嶈冻 (OOM)")
                self.fixes.append("鍑忓皬 Context Size 鎴栦娇鐢ㄦ洿灏忕殑閲忓寲鐗堟湰")
                print_error("鏄惧瓨涓嶈冻")
            elif 'failed to load' in error_lower or 'model not found' in error_lower:
                self.status = 'error'
                self.error_type = 'model'
                self.issues.append("妯″瀷鍔犺浇澶辫触")
                self.fixes.append("妫€鏌ユā鍨嬫枃浠惰矾寰勫拰鏍煎紡")
                print_error("妯″瀷鍔犺浇澶辫触")
            elif 'cuda' in error_lower or 'vulkan' in error_lower or 'gpu' in error_lower:
                self.status = 'error'
                self.error_type = 'driver'
                self.issues.append("GPU/椹卞姩闂")
                self.fixes.append("鏇存柊 GPU 椹卞姩鎴栧垏鎹㈠埌 CPU 妯″紡")
                print_error("GPU/椹卞姩闂")
            elif e.code == 404:
                # 鍙兘鏄?Ollama 鎴栧叾浠栧悗绔?
                self.status = 'warning'
                self.issues.append("API 绔偣涓嶅彲鐢?)
                self.fixes.append("纭浣跨敤鐨勬槸 llama-server")
            else:
                self.status = 'error'
                self.error_type = 'unknown'
                self.issues.append(f"HTTP {e.code}")
                self.fixes.append("鏌ョ湅鏈嶅姟鍣ㄦ棩蹇?)

        except urllib.error.URLError as e:
            self.status = 'warning'
            self.issues.append(f"杩炴帴澶辫触: {e.reason}")
            self.fixes.append("鍚庣鍙兘浠嶅湪鍒濆鍖?)

        except Exception as e:
            self.status = 'warning'
            self.issues.append(f"娴嬭瘯澶辫触: {str(e)}")
            self.fixes.append("鏌ョ湅鏈嶅姟鍣ㄦ棩蹇?)

class MiddlewareChecker(ComponentChecker):
    """涓棿浠舵枃浠舵鏌ュ櫒"""

    def __init__(self):
        super().__init__('Middleware')
        # 瀹為檯瀛樺湪鐨勬牳蹇冩枃浠?
        self.required_files = [
            'get_specs.py',        # 纭欢瑙勬牸妫€娴?
            'term_extractor.py',   # 鏈鎻愬彇
            'rule_processor.py',   # 瑙勫垯澶勭悊
            'common_utils.py',     # 閫氱敤宸ュ叿
        ]
        # 蹇呰鐨勫瓙鐩綍
        self.required_dirs = [
            'murasaki_translator',  # 缈昏瘧寮曟搸鏍稿績
            'server',               # 鏈嶅姟鍣ㄦā鍧?
        ]
        self.missing_files: List[str] = []
        self.missing_dirs: List[str] = []
        self.can_auto_fix = False  # 涓棿浠舵枃浠舵崯鍧忛渶瑕侀噸鏂板畨瑁?

    def check(self) -> None:
        """妫€鏌ヤ腑闂翠欢鏂囦欢鍜岀洰褰?""
        # 浣跨敤鑴氭湰鎵€鍦ㄧ洰褰曚綔涓?middleware 鐩綍
        middleware_dir = Path(__file__).parent

        # 濡傛灉鑴氭湰涓嶅湪 middleware 鐩綍锛屽皾璇曟煡鎵?
        if middleware_dir.name != 'middleware':
            # 灏濊瘯鐩稿璺緞
            test_paths = [
                Path('./middleware'),
                Path('../middleware'),
                middleware_dir,
            ]
            middleware_dir = None
            for test_path in test_paths:
                if test_path.exists() and (test_path / 'translation_worker.py').exists():
                    middleware_dir = test_path
                    break

            if middleware_dir is None:
                self.status = 'error'
                self.issues.append("涓棿浠剁洰褰曚笉瀛樺湪")
                self.fixes.append("閲嶆柊瀹夎 Murasaki Translator")
                print_error("鏈壘鍒颁腑闂翠欢鐩綍")
                return

        self.path = str(middleware_dir.resolve())
        print_success(f"鎵惧埌涓棿浠剁洰褰? {middleware_dir}")

        # 妫€鏌ュ繀瑕佺洰褰?
        for dir_name in self.required_dirs:
            dir_path = middleware_dir / dir_name
            if not dir_path.exists():
                self.missing_dirs.append(dir_name)
                print_error(f"缂哄皯鐩綍: {dir_name}")

        # 妫€鏌ュ繀瑕佹枃浠?
        for file_name in self.required_files:
            file_path = middleware_dir / file_name
            if not file_path.exists():
                self.missing_files.append(file_name)
                print_error(f"缂哄皯鏂囦欢: {file_name}")

        if self.missing_dirs or self.missing_files:
            self.status = 'error'
            # 鏄剧ず鍏蜂綋缂哄け鐨勬枃浠?鐩綍鍚嶇О
            if self.missing_dirs:
                self.issues.append(f"缂哄皯鐩綍: {', '.join(self.missing_dirs)}")
            if self.missing_files:
                self.issues.append(f"缂哄皯鏂囦欢: {', '.join(self.missing_files)}")
            self.fixes.append("閲嶆柊瀹夎 Murasaki Translator")
        else:
            self.status = 'ok'
            print_success("涓棿浠剁粨鏋勫畬鏁?)

class PermissionChecker(ComponentChecker):
    """鏂囦欢鏉冮檺妫€鏌ュ櫒"""

    def __init__(self):
        super().__init__('Permissions')
        self.can_auto_fix = False  # 鏉冮檺闂闇€瑕佺敤鎴锋墜鍔ㄨВ鍐?

    def check(self) -> None:
        """妫€鏌ユ枃浠舵潈闄?""
        test_dirs = [
            Path('.'),
            Path('./middleware'),
            Path('./models'),
            Path('./glossaries'),
            Path('./output'),
        ]

        for test_dir in test_dirs:
            if test_dir.exists():
                test_file = test_dir / '.permission_test'
                try:
                    test_file.touch()
                    test_file.unlink()
                except PermissionError:
                    self.status = 'error'
                    self.issues.append(f"鐩綍鏉冮檺涓嶈冻: {test_dir}")
                    self.fixes.append("浠ョ鐞嗗憳/Root 鏉冮檺杩愯锛屾垨妫€鏌ョ洰褰曟潈闄愯缃?)
                    print_error(f"鐩綍鏃犲啓鍏ユ潈闄? {test_dir}")
                    return

        print_success("鏂囦欢鏉冮檺妫€鏌ラ€氳繃")
        self.status = 'ok'

class EnvironmentFixer:
    """鐜淇宸ュ叿涓荤被"""

    def __init__(self, llama_port: int = 8080):
        self.platform = platform.system()
        self.arch = platform.machine()

        # 鍒濆鍖栧悇缁勪欢妫€鏌ュ櫒
        self.checkers: List[ComponentChecker] = [
            PythonChecker(),
            CUDAChecker(),
            VulkanChecker(),
            LlamaBackendChecker(port=llama_port),  # 浼犲叆鐢ㄦ埛閰嶇疆鐨勭鍙?
            MiddlewareChecker(),
            PermissionChecker(),
        ]

    def check_all(self) -> None:
        """妫€鏌ユ墍鏈夌粍浠?""
        print_header("Murasaki 鐜璇婃柇")
        print_info(f"骞冲彴: {self.platform} {self.arch}")

        for i, checker in enumerate(self.checkers, 1):
            print_step(i, len(self.checkers), f"妫€鏌?{checker.name}")
            checker.check()

    def fix_component(self, component_name: str) -> Dict[str, any]:
        """淇鎸囧畾缁勪欢"""
        checker = next((c for c in self.checkers if c.name.lower() == component_name.lower()), None)

        if not checker:
            return {
                'success': False,
                'message': f'鏈壘鍒扮粍浠? {component_name}'
            }

        print_header(f"淇 {checker.name}")
        result = checker.fix()

        if result['success']:
            print_success(f"{checker.name} 淇鎴愬姛")
        else:
            print_error(f"{checker.name} 淇澶辫触: {result.get('message', '鏈煡閿欒')}")

        return result

    def generate_report(self) -> Dict[str, any]:
        """鐢熸垚璇婃柇鎶ュ憡"""
        # 缁熻闂
        total_issues = sum(len(c.issues) for c in self.checkers)
        total_errors = sum(1 for c in self.checkers if c.status == 'error')
        total_warnings = sum(1 for c in self.checkers if c.status == 'warning')

        report = {
            'system': {
                'platform': self.platform,
                'arch': self.arch,
            },
            'components': [c.to_dict() for c in self.checkers],
            'summary': {
                'totalIssues': total_issues,
                'totalErrors': total_errors,
                'totalWarnings': total_warnings,
                'overallStatus': 'ok' if total_errors == 0 else 'error',
            }
        }

        # 鎵撳嵃姹囨€伙紙闈?JSON 妯″紡锛?
        if not _QUIET_MODE:
            print_header("璇婃柇鎶ュ憡姹囨€?)

            print(f"{Colors.BOLD}绯荤粺淇℃伅:{Colors.END}")
            print(f"  骞冲彴: {self.platform} {self.arch}")

            print(f"\n{Colors.BOLD}缁勪欢鐘舵€?{Colors.END}")
            for checker in self.checkers:
                status_icon = {
                    'ok': f"{Colors.GREEN}鉁搟Colors.END}",
                    'warning': f"{Colors.YELLOW}鈿爗Colors.END}",
                    'error': f"{Colors.RED}鉁梴Colors.END}"
                }.get(checker.status, '?')
                print(f"  {status_icon} {checker.name}: {checker.version or 'N/A'}")

            if total_issues > 0:
                print(f"\n{Colors.RED}{Colors.BOLD}鍙戠幇 {total_issues} 涓棶棰?({total_errors} 閿欒, {total_warnings} 璀﹀憡){Colors.END}")
            else:
                print(f"\n{Colors.GREEN}{Colors.BOLD}鉁?鐜妫€鏌ラ€氳繃锛屾湭鍙戠幇闂{Colors.END}")

        return report

    def save_report(self, report: Dict[str, any]) -> None:
        """淇濆瓨鎶ュ憡鍒版枃浠?""
        # 浣跨敤缁濆璺緞淇濆瓨鍒拌剼鏈墍鍦ㄧ洰褰?
        script_dir = Path(__file__).parent.resolve()
        report_path = script_dir / 'environment_report.json'
        try:
            with open(report_path, 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            print_info(f"璇︾粏鎶ュ憡宸蹭繚瀛樺埌: {report_path}")
        except Exception as e:
            print_error(f"淇濆瓨鎶ュ憡澶辫触: {e}")

def main():
    """涓诲嚱鏁?""
    global _QUIET_MODE

    parser = argparse.ArgumentParser(description='Murasaki 鐜淇宸ュ叿')
    parser.add_argument('--check', action='store_true', help='浠呮鏌ワ紝涓嶄慨澶?)
    parser.add_argument('--fix', type=str, help='淇鎸囧畾缁勪欢 (Python/CUDA/Vulkan/LlamaBackend/Middleware/Permissions)')
    parser.add_argument('--json', action='store_true', help='杈撳嚭 JSON 鏍煎紡')
    parser.add_argument('--port', type=int, default=8080, help='Llama 鍚庣绔彛 (榛樿 8080)')

    args = parser.parse_args()

    # JSON 妯″紡涓嬪惎鐢ㄩ潤榛樻ā寮?
    if args.json:
        _QUIET_MODE = True

    # 浼犲叆鐢ㄦ埛閰嶇疆鐨勭鍙?
    fixer = EnvironmentFixer(llama_port=args.port)

    # 鎵ц妫€鏌?
    fixer.check_all()

    # 鐢熸垚鎶ュ憡
    report = fixer.generate_report()

    # 淇濆瓨鎶ュ憡
    fixer.save_report(report)

    # 鎵ц淇锛堝鏋滄寚瀹氾級
    if args.fix:
        result = fixer.fix_component(args.fix)
        if args.json:
            print(json.dumps({'fixResult': result}, indent=2, ensure_ascii=False))
        sys.exit(0 if result['success'] else 1)

    # 杈撳嚭 JSON锛堝鏋滄寚瀹氾級
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(0 if report['summary']['totalErrors'] == 0 else 1)

    # 姝ｅ父閫€鍑?
    sys.exit(0 if report['summary']['totalErrors'] == 0 else 1)

if __name__ == '__main__':
    main()
