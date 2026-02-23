from datetime import datetime, timedelta
from pathlib import Path

import pytest

import api_server as server
from translation_worker import TranslationTask, TaskStatus


class DummyRequest:
    def __init__(self, file_path: str = ""):
        self.file_path = file_path


def _make_task(task_id: str, status: TaskStatus, created_at: datetime, output_path: str = None, file_path: str = ""):
    task = TranslationTask(task_id=task_id, request=DummyRequest(file_path))
    task.status = status
    task.created_at = created_at
    task.output_path = output_path
    return task


@pytest.mark.unit
def test_task_status_transition():
    task = _make_task("t1", TaskStatus.RUNNING, datetime.now())
    assert server._try_transition_task_status(task, TaskStatus.COMPLETED) is True
    assert task.status == TaskStatus.COMPLETED
    assert server._try_transition_task_status(task, TaskStatus.RUNNING) is False
    assert task.status == TaskStatus.COMPLETED


@pytest.mark.unit
def test_set_get_and_count_running(monkeypatch):
    monkeypatch.setattr(server, "tasks", {})
    task_a = _make_task("a", TaskStatus.RUNNING, datetime.now())
    task_b = _make_task("b", TaskStatus.PENDING, datetime.now())
    server._set_task(task_a)
    server._set_task(task_b)
    assert server._get_task("a") is task_a
    assert server._count_running_tasks() == 1


@pytest.mark.unit
def test_cleanup_old_tasks_removes_files(monkeypatch, tmp_path):
    now = datetime.now()
    old_time = now - timedelta(hours=2)
    monkeypatch.setattr(server, "tasks", {})
    monkeypatch.setattr(server, "TASK_RETENTION_HOURS", 1)
    monkeypatch.setattr(server, "MAX_COMPLETED_TASKS", 100)

    output_file = tmp_path / "out.txt"
    output_file.write_text("ok", encoding="utf-8")

    middleware_dir = Path(server.__file__).resolve().parent.parent
    uploads_dir = middleware_dir / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    upload_file = uploads_dir / "unit-test-upload.txt"
    upload_file.write_text("data", encoding="utf-8")

    task = _make_task(
        "old",
        TaskStatus.COMPLETED,
        old_time,
        output_path=str(output_file),
        file_path=str(upload_file),
    )
    server.tasks["old"] = task

    server.cleanup_old_tasks()

    assert "old" not in server.tasks
    assert output_file.exists() is False
    assert upload_file.exists() is False


@pytest.mark.unit
def test_cleanup_old_tasks_max_completed(monkeypatch):
    now = datetime.now()
    monkeypatch.setattr(server, "tasks", {})
    monkeypatch.setattr(server, "TASK_RETENTION_HOURS", 999)
    monkeypatch.setattr(server, "MAX_COMPLETED_TASKS", 1)

    t1 = _make_task("t1", TaskStatus.COMPLETED, now - timedelta(hours=3))
    t2 = _make_task("t2", TaskStatus.COMPLETED, now - timedelta(hours=1))
    server.tasks["t1"] = t1
    server.tasks["t2"] = t2

    server.cleanup_old_tasks()

    assert len(server.tasks) == 1
    assert "t2" in server.tasks


@pytest.mark.unit
@pytest.mark.asyncio
async def test_get_task_status_uses_snapshot_window(monkeypatch):
    monkeypatch.setattr(server, "tasks", {})
    task = _make_task("snapshot_task", TaskStatus.RUNNING, datetime.now())
    task.set_progress(0.5, 5, 10)
    for idx in range(120):
        task.add_log(f"log-{idx}")
    server.tasks[task.task_id] = task

    default_resp = await server.get_task_status(task.task_id, log_from=None, log_limit=200)
    assert default_resp.log_total == 120
    assert default_resp.logs_truncated is True
    assert len(default_resp.logs) == 50
    assert default_resp.logs[0] == "log-70"
    assert default_resp.next_log_index == 120

    ranged_resp = await server.get_task_status(task.task_id, log_from=100, log_limit=10)
    assert ranged_resp.logs == [f"log-{idx}" for idx in range(100, 110)]
    assert ranged_resp.next_log_index == 110
    assert ranged_resp.progress == 0.5
    assert ranged_resp.current_block == 5
    assert ranged_resp.total_blocks == 10


class DummyWebSocket:
    def __init__(self):
        self.query_params = {}
        self.headers = {}
        self.accepted = False
        self.messages = []
        self.closed_code = None

    async def accept(self):
        self.accepted = True

    async def close(self, code: int = 1000):
        self.closed_code = code

    async def send_json(self, payload):
        self.messages.append(payload)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_websocket_logs_emits_snapshot_and_complete(monkeypatch):
    monkeypatch.setattr(server, "tasks", {})
    monkeypatch.delenv("MURASAKI_API_KEY", raising=False)
    monkeypatch.setenv("MURASAKI_WS_AUTH_REQUIRED", "0")

    task = _make_task("ws_task", TaskStatus.COMPLETED, datetime.now())
    task.set_progress(1.0, 2, 2)
    task.set_result("done")
    task.add_log("line-1")
    task.add_log("line-2")
    server.tasks[task.task_id] = task

    websocket = DummyWebSocket()
    await server.websocket_logs(websocket, task.task_id)

    assert websocket.accepted is True
    assert [msg for msg in websocket.messages if msg.get("type") == "log"] == [
        {"type": "log", "message": "line-1"},
        {"type": "log", "message": "line-2"},
    ]
    progress_messages = [msg for msg in websocket.messages if msg.get("type") == "progress"]
    assert len(progress_messages) == 1
    assert progress_messages[0]["status"] == "completed"
    complete_messages = [msg for msg in websocket.messages if msg.get("type") == "complete"]
    assert len(complete_messages) == 1
    assert complete_messages[0]["result"] == "done"
