"""API stats event protocol for Pipeline V2."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from threading import Lock
from typing import Any, Dict
import uuid

API_STATS_EVENT_PREFIX = "JSON_API_STATS_EVENT:"

_emit_lock = Lock()


def now_iso() -> str:
    """Return an ISO8601 UTC timestamp."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def generate_request_id() -> str:
    """Return a request id suitable for correlating request lifecycle events."""
    return uuid.uuid4().hex


def _is_sensitive_header_key(key: str) -> bool:
    normalized = str(key).strip().lower().replace("_", "-")
    return any(
        token in normalized
        for token in ("authorization", "api-key", "token", "secret", "password")
    )


def sanitize_headers(headers: Any) -> Dict[str, str] | None:
    """Mask sensitive header values before persistence."""
    if not isinstance(headers, dict):
        return None
    sanitized: Dict[str, str] = {}
    for key, value in headers.items():
        header_name = str(key).strip()
        if not header_name:
            continue
        if _is_sensitive_header_key(header_name):
            sanitized[header_name] = "[REDACTED]"
        else:
            sanitized[header_name] = str(value)
    return sanitized or None


def emit_api_stats_event(payload: Dict[str, Any]) -> None:
    """Emit one line event for GUI main process ingestion."""
    if not isinstance(payload, dict):
        return
    body = dict(payload)
    body.setdefault("ts", now_iso())
    line = f"{API_STATS_EVENT_PREFIX}{json.dumps(body, ensure_ascii=False, default=str, separators=(',', ':'))}"
    with _emit_lock:
        print(line, flush=True)
