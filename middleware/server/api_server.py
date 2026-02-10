#!/usr/bin/env python3
"""
Murasaki Translation API Server
鎻愪緵涓?GUI 100% 鐩稿悓鍔熻兘鐨勮繙绋嬬炕璇戞湇鍔?

鐢ㄦ硶:
  python api_server.py --model /path/to/model.gguf --port 8000

API 绔偣:
  POST /api/v1/translate      - 鏂囨湰/鏂囦欢缈昏瘧
  GET  /api/v1/translate/{id} - 浠诲姟鐘舵€佹煡璇?
  WS   /api/v1/ws             - WebSocket 瀹炴椂鏃ュ織
  GET  /api/v1/models         - 妯″瀷鍒楄〃
  GET  /api/v1/glossaries     - 鏈琛ㄥ垪琛?
  GET  /health                - 鍋ュ悍妫€鏌?
"""

import os
import sys
import json
import uuid
import asyncio
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, BackgroundTasks, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

# 娣诲姞鐖剁洰褰曞埌 path
sys.path.insert(0, str(Path(__file__).parent.parent))

from translation_worker import TranslationWorker, TranslationTask, TaskStatus

# ============================================
# Logging
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger("murasaki-api")

# ============================================
# FastAPI App
# ============================================
app = FastAPI(
    title="Murasaki Translation API",
    version="1.0.0",
    description="Remote translation server with full GUI functionality"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# API Key Authentication
# ============================================
api_key_header = APIKeyHeader(name="Authorization", auto_error=False)

async def verify_api_key(api_key: str = Security(api_key_header)):
    """
    楠岃瘉 API Key
    濡傛灉鏈嶅姟鍣ㄦ湭璁剧疆 API Key (MURASAKI_API_KEY)锛屽垯寮€鏀捐闂?
    濡傛灉璁剧疆浜?API Key锛屽垯蹇呴』鍦?Header 涓彁渚涙纭殑 Bearer Token
    """
    import secrets

    server_key = os.environ.get("MURASAKI_API_KEY")

    # 濡傛灉娌¤瀵嗙爜鍒欏紑鏀捐闂?
    if not server_key:
        return None

    # 楠岃瘉 API Key
    if not api_key:
        raise HTTPException(
            status_code=403,
            detail="Missing API Key. Please provide 'Authorization: Bearer <your-key>' header."
        )

    # 鏀寔 "Bearer <key>" 鎴栫洿鎺?"<key>" 鏍煎紡
    provided_key = api_key.replace("Bearer ", "").strip()

    # 浣跨敤 secrets.compare_digest 闃叉璁℃椂鏀诲嚮
    if not secrets.compare_digest(provided_key, server_key):
        raise HTTPException(
            status_code=403,
            detail="Invalid API Key"
        )

    return provided_key

# ============================================
# Global State
# ============================================
worker: Optional[TranslationWorker] = None
tasks: Dict[str, TranslationTask] = {}
websocket_connections: List[WebSocket] = []

# 浠诲姟娓呯悊閰嶇疆锛堥槻姝㈠唴瀛樻硠婕忥級
MAX_COMPLETED_TASKS = 100  # 鏈€澶氫繚鐣?100 涓凡瀹屾垚浠诲姟
TASK_RETENTION_HOURS = 24  # 淇濈暀 24 灏忔椂

# 绾跨▼瀹夊叏閿侊紙闃叉骞跺彂淇敼瀛楀吀锛?
import threading
_tasks_lock = threading.Lock()

def cleanup_old_tasks():
    """娓呯悊鏃т换鍔★紝闃叉鍐呭瓨娉勬紡鍜岀鐩樻硠婕?""
    global tasks
    now = datetime.now()

    # 浣跨敤閿侀槻姝㈠苟鍙戜慨鏀?
    with _tasks_lock:
        # 浣跨敤 list() 鎷疯礉杩唬锛岄槻姝?RuntimeError: dictionary changed size
        to_remove = []
        completed_count = 0

        for task_id, task in list(tasks.items()):
            age_hours = (now - task.created_at).total_seconds() / 3600
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                completed_count += 1
                if age_hours > TASK_RETENTION_HOURS:
                    to_remove.append((task_id, task))

        # 濡傛灉宸插畬鎴愪换鍔¤秴杩囬檺鍒讹紝娓呯悊鏈€鏃х殑
        if completed_count > MAX_COMPLETED_TASKS:
            completed_tasks = [
                (tid, t) for tid, t in list(tasks.items())
                if t.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]
            ]
            completed_tasks.sort(key=lambda x: x[1].created_at)
            for tid, t in completed_tasks[:completed_count - MAX_COMPLETED_TASKS]:
                if not any(item[0] == tid for item in to_remove):
                    to_remove.append((tid, t))

        # 鎵ц娓呯悊锛氬垹闄ゅ唴瀛樺拰鐗╃悊鏂囦欢
        middleware_dir = Path(__file__).parent.parent
        for task_id, task in to_remove:
            # 鍒犻櫎鍏宠仈鐨勭墿鐞嗘枃浠讹紙闃叉纾佺洏娉勬紡锛?
            try:
                # 鍒犻櫎杈撳嚭鏂囦欢
                if task.output_path:
                    output_file = Path(task.output_path)
                    if output_file.exists():
                        output_file.unlink()
                        logger.debug(f"Deleted output file: {output_file}")

                # 鍒犻櫎涓婁紶鏂囦欢锛堝鏋滀娇鐢ㄤ簡 file_path锛?
                if hasattr(task.request, 'file_path') and task.request.file_path:
                    uploads_dir = middleware_dir / "uploads"
                    input_file = Path(task.request.file_path)
                    # 鍙垹闄?uploads 鐩綍涓嬬殑鏂囦欢
                    if str(input_file).startswith(str(uploads_dir)):
                        if input_file.exists():
                            input_file.unlink()
                            logger.debug(f"Deleted upload file: {input_file}")
            except Exception as e:
                logger.warning(f"Failed to delete files for task {task_id}: {e}")

            # 鍒犻櫎鍐呭瓨涓殑浠诲姟
            del tasks[task_id]

        if to_remove:
            logger.info(f"Cleaned up {len(to_remove)} old tasks (memory + disk)")

# ============================================
# Request/Response Models
# ============================================

class TranslateRequest(BaseModel):
    """缈昏瘧璇锋眰"""
    text: Optional[str] = None          # 鐩存帴鏂囨湰缈昏瘧
    file_path: Optional[str] = None     # 鏈嶅姟鍣ㄤ笂鐨勬枃浠惰矾寰?

    # 缈昏瘧閰嶇疆 (涓?GUI 鍙傛暟瀹屽叏涓€鑷?
    model: Optional[str] = None         # 妯″瀷璺緞锛孨one 浣跨敤榛樿
    glossary: Optional[str] = None      # 鏈琛ㄨ矾寰?
    preset: str = "default"             # prompt preset
    mode: str = "doc"                   # doc | line
    chunk_size: int = 1000
    ctx: int = 8192
    gpu_layers: int = -1
    temperature: float = 0.3

    # 楂樼骇閫夐」
    line_check: bool = True
    traditional: bool = False
    save_cot: bool = False
    rules_pre: Optional[str] = None
    rules_post: Optional[str] = None

    # 骞惰閰嶇疆
    parallel: int = 1
    flash_attn: bool = False
    kv_cache_type: str = "f16"


class TranslateResponse(BaseModel):
    """缈昏瘧鍝嶅簲"""
    task_id: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    """浠诲姟鐘舵€佸搷搴?""
    task_id: str
    status: str
    progress: float
    current_block: int
    total_blocks: int
    logs: List[str]
    result: Optional[str] = None
    error: Optional[str] = None


class ModelInfo(BaseModel):
    """妯″瀷淇℃伅"""
    name: str
    path: str
    size_gb: float


class ServerStatus(BaseModel):
    """鏈嶅姟鍣ㄧ姸鎬?""
    status: str
    model_loaded: bool
    current_model: Optional[str]
    active_tasks: int
    uptime_seconds: float


# ============================================
# API Endpoints
# ============================================

@app.get("/health")
async def health():
    """鍋ュ悍妫€鏌?""
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/v1/status", response_model=ServerStatus)
async def get_status():
    """鑾峰彇鏈嶅姟鍣ㄧ姸鎬?""
    global worker
    return ServerStatus(
        status="running",
        model_loaded=worker is not None and worker.is_ready(),
        current_model=worker.model_path if worker else None,
        active_tasks=len([t for t in tasks.values() if t.status == TaskStatus.RUNNING]),
        uptime_seconds=worker.uptime() if worker else 0
    )


@app.get("/api/v1/models", response_model=List[ModelInfo])
async def list_models():
    """鍒楀嚭鏈嶅姟鍣ㄤ笂鍙敤鐨勬ā鍨?""
    models_dir = Path(__file__).parent.parent / "models"
    models = []

    if models_dir.exists():
        for f in models_dir.glob("*.gguf"):
            size_gb = f.stat().st_size / (1024**3)
            models.append(ModelInfo(
                name=f.stem,
                path=str(f),
                size_gb=round(size_gb, 2)
            ))

    return models


@app.get("/api/v1/glossaries")
async def list_glossaries():
    """鍒楀嚭鏈嶅姟鍣ㄤ笂鍙敤鐨勬湳璇〃"""
    glossaries_dir = Path(__file__).parent.parent / "glossaries"
    glossaries = []

    if glossaries_dir.exists():
        for f in glossaries_dir.glob("*.json"):
            glossaries.append({
                "name": f.stem,
                "path": str(f)
            })

    return glossaries


@app.post("/api/v1/translate", response_model=TranslateResponse, dependencies=[Depends(verify_api_key)])
async def create_translation(request: TranslateRequest, background_tasks: BackgroundTasks):
    """鍒涘缓缈昏瘧浠诲姟"""
    global worker, tasks

    # 娓呯悊鏃т换鍔★紝闃叉鍐呭瓨娉勬紡
    cleanup_old_tasks()

    if not request.text and not request.file_path:
        raise HTTPException(400, "Must provide either 'text' or 'file_path'")

    # 鍒涘缓浠诲姟
    task_id = str(uuid.uuid4())[:8]
    task = TranslationTask(
        task_id=task_id,
        request=request,
        status=TaskStatus.PENDING,
        created_at=datetime.now()
    )
    tasks[task_id] = task

    # 鍚庡彴鎵ц缈昏瘧
    background_tasks.add_task(execute_translation, task)

    return TranslateResponse(
        task_id=task_id,
        status="pending",
        message="Translation task created"
    )


@app.get("/api/v1/translate/{task_id}", response_model=TaskStatusResponse, dependencies=[Depends(verify_api_key)])
async def get_task_status(task_id: str):
    """鑾峰彇浠诲姟鐘舵€?""
    if task_id not in tasks:
        raise HTTPException(404, f"Task {task_id} not found")

    task = tasks[task_id]
    return TaskStatusResponse(
        task_id=task_id,
        status=task.status.value,
        progress=task.progress,
        current_block=task.current_block,
        total_blocks=task.total_blocks,
        logs=task.logs[-50:],  # 鏈€杩?50 鏉℃棩蹇?
        result=task.result,
        error=task.error
    )


@app.delete("/api/v1/translate/{task_id}", dependencies=[Depends(verify_api_key)])
async def cancel_task(task_id: str):
    """鍙栨秷浠诲姟"""
    if task_id not in tasks:
        raise HTTPException(404, f"Task {task_id} not found")

    task = tasks[task_id]
    if task.status == TaskStatus.RUNNING:
        task.cancel_requested = True
        return {"message": "Cancel requested"}
    else:
        return {"message": f"Task is {task.status.value}, cannot cancel"}


@app.post("/api/v1/upload/file", dependencies=[Depends(verify_api_key)])
async def upload_file(file: UploadFile = File(...)):
    """涓婁紶鏂囦欢鍒版湇鍔″櫒"""
    upload_dir = Path(__file__).parent.parent / "uploads"
    upload_dir.mkdir(exist_ok=True)

    file_id = str(uuid.uuid4())[:8]
    file_ext = Path(file.filename).suffix
    save_path = upload_dir / f"{file_id}{file_ext}"

    with open(save_path, "wb") as f:
        content = await file.read()
        f.write(content)

    return {
        "file_id": file_id,
        "file_path": str(save_path),
        "original_name": file.filename,
        "size": len(content)
    }


@app.get("/api/v1/download/{task_id}", dependencies=[Depends(verify_api_key)])
async def download_result(task_id: str):
    """涓嬭浇缈昏瘧缁撴灉"""
    if task_id not in tasks:
        raise HTTPException(404, f"Task {task_id} not found")

    task = tasks[task_id]
    if task.status != TaskStatus.COMPLETED:
        raise HTTPException(400, f"Task is {task.status.value}, not completed")

    if task.output_path and Path(task.output_path).exists():
        return FileResponse(task.output_path, filename=Path(task.output_path).name)
    else:
        raise HTTPException(404, "Output file not found")


# ============================================
# WebSocket for Real-time Logs
# ============================================

@app.websocket("/api/v1/ws/{task_id}")
async def websocket_logs(websocket: WebSocket, task_id: str):
    """WebSocket 瀹炴椂鏃ュ織鎺ㄩ€?""
    await websocket.accept()
    websocket_connections.append(websocket)

    try:
        if task_id not in tasks:
            await websocket.send_json({"error": f"Task {task_id} not found"})
            return

        task = tasks[task_id]
        last_log_index = 0

        while True:
            # 鍙戦€佹柊鏃ュ織
            if len(task.logs) > last_log_index:
                new_logs = task.logs[last_log_index:]
                for log in new_logs:
                    await websocket.send_json({
                        "type": "log",
                        "message": log
                    })
                last_log_index = len(task.logs)

            # 鍙戦€佽繘搴?
            await websocket.send_json({
                "type": "progress",
                "progress": task.progress,
                "current_block": task.current_block,
                "total_blocks": task.total_blocks,
                "status": task.status.value
            })

            # 浠诲姟瀹屾垚鍒欓€€鍑?
            if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
                await websocket.send_json({
                    "type": "complete",
                    "status": task.status.value,
                    "result": task.result,
                    "error": task.error
                })
                break

            await asyncio.sleep(0.5)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for task {task_id}")
    finally:
        if websocket in websocket_connections:
            websocket_connections.remove(websocket)


# ============================================
# Translation Execution
# ============================================

async def execute_translation(task: TranslationTask):
    """鎵ц缈昏瘧浠诲姟"""
    global worker

    try:
        task.status = TaskStatus.RUNNING
        task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Starting translation...")

        # 纭繚 worker 宸插垵濮嬪寲
        if worker is None:
            worker = TranslationWorker()

        # 鎵ц缈昏瘧
        result = await worker.translate(task)

        task.result = result
        task.status = TaskStatus.COMPLETED
        task.progress = 1.0
        task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] Translation completed!")

    except Exception as e:
        task.status = TaskStatus.FAILED
        task.error = str(e)
        task.add_log(f"[{datetime.now().strftime('%H:%M:%S')}] ERROR: {e}")
        logger.exception(f"Translation failed for task {task.task_id}")


# ============================================
# CLI Entry Point
# ============================================

def main():
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Murasaki Translation API Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    parser.add_argument("--model", help="Default model path")
    parser.add_argument("--api-key", help="API key for authentication (optional)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")

    args = parser.parse_args()

    # 璁剧疆榛樿妯″瀷
    if args.model:
        os.environ["MURASAKI_DEFAULT_MODEL"] = args.model

    if args.api_key:
        os.environ["MURASAKI_API_KEY"] = args.api_key
        api_key_display = args.api_key
    else:
        # 瀹夊叏榛樿鍊硷細鏃?Key 鏃惰嚜鍔ㄧ敓鎴?UUID锛岀姝㈡棤閴存潈杩愯
        import secrets
        generated_key = secrets.token_urlsafe(24)
        os.environ["MURASAKI_API_KEY"] = generated_key
        api_key_display = generated_key

    print(f"""
鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽
鈺?          Murasaki Translation API Server                    鈺?
鈺犫晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暎
鈺? API:     http://{args.host}:{args.port}/api/v1/translate           鈺?
鈺? Docs:    http://{args.host}:{args.port}/docs                       鈺?
鈺? Health:  http://{args.host}:{args.port}/health                     鈺?
鈺犫晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暎
鈺? 馃攼 API Key: {api_key_display:<47}鈺?
鈺? (Use: Authorization: Bearer <key>)                          鈺?
鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆
    """)

    uvicorn.run(
        "api_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload
    )


if __name__ == "__main__":
    main()
