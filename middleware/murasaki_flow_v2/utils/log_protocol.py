"""Dashboard-compatible JSON log protocol for Pipeline V2.

Emits structured logs to stdout that the Electron Dashboard can parse.
Protocol prefixes:
  JSON_PROGRESS:   – block progress, speed, ETA
  JSON_PREVIEW_BLOCK: – real-time source/output preview
  JSON_OUTPUT_PATH: – final output file path
  JSON_FINAL:      – summary statistics
  JSON_RETRY:      – retry event
  JSON_WARNING:    – quality warnings
  JSON_ERROR:      – critical failure
"""

from __future__ import annotations

import json
import sys
import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any, Deque, Dict, List, Optional, Tuple

_stdout_lock = threading.Lock()


def emit(prefix: str, data: Dict[str, Any]) -> None:
    """Thread-safe JSON log emission compatible with Dashboard's onLogUpdate."""
    with _stdout_lock:
        sys.stdout.write(f"\n{prefix}:{json.dumps(data, ensure_ascii=False)}\n")
        sys.stdout.flush()


def emit_progress(
    *,
    current: int,
    total: int,
    elapsed: float,
    speed_chars: float = 0,
    speed_lines: float = 0,
    speed_gen: float = 0,
    speed_eval: float = 0,
    total_lines: int = 0,
    total_chars: int = 0,
    source_lines: int = 0,
    source_chars: int = 0,
    api_ping: Optional[int] = None,
    api_concurrency: int = 0,
    api_url: Optional[str] = None,
    # 实时口径（滑动窗口）
    realtime_speed_chars: Optional[float] = None,
    realtime_speed_lines: Optional[float] = None,
    realtime_speed_gen: Optional[float] = None,
    realtime_speed_eval: Optional[float] = None,
    realtime_speed_tokens: Optional[float] = None,
    api_rpm: Optional[float] = None,
    total_requests: Optional[int] = None,
    total_input_tokens: Optional[int] = None,
    total_output_tokens: Optional[int] = None,
) -> None:
    """Emit JSON_PROGRESS compatible with Dashboard's progress parser."""
    percent = round(current / max(total, 1) * 100, 1)
    remaining = (elapsed / max(current, 1)) * (total - current) if current > 0 else 0
    emit("JSON_PROGRESS", {
        "current": current,
        "total": total,
        "percent": percent,
        "elapsed": round(elapsed, 1),
        "remaining": round(max(0, remaining), 1),
        "speed_chars": round(speed_chars, 1),
        "speed_lines": round(speed_lines, 2),
        "speed_gen": round(speed_gen, 1),
        "speed_eval": round(speed_eval, 1),
        "total_lines": total_lines,
        "total_chars": total_chars,
        "source_lines": source_lines,
        "source_chars": source_chars,
        "api_ping": api_ping,
        "api_concurrency": api_concurrency,
        "api_url": api_url,
        "realtime_speed_chars": (
            round(realtime_speed_chars, 1)
            if realtime_speed_chars is not None
            else None
        ),
        "realtime_speed_lines": (
            round(realtime_speed_lines, 2)
            if realtime_speed_lines is not None
            else None
        ),
        "realtime_speed_gen": (
            round(realtime_speed_gen, 1)
            if realtime_speed_gen is not None
            else None
        ),
        "realtime_speed_eval": (
            round(realtime_speed_eval, 1)
            if realtime_speed_eval is not None
            else None
        ),
        "realtime_speed_tokens": (
            round(realtime_speed_tokens, 1)
            if realtime_speed_tokens is not None
            else None
        ),
        "api_rpm": round(api_rpm, 2) if api_rpm is not None else None,
        "total_requests": total_requests,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
    })


def emit_preview_block(block_idx: int, src: str, output: str) -> None:
    """Emit JSON_PREVIEW_BLOCK for real-time translation preview."""
    emit("JSON_PREVIEW_BLOCK", {
        "block": block_idx,
        "src": src,
        "output": output,
    })


def emit_output_path(path: str) -> None:
    """Emit JSON_OUTPUT_PATH when the output file path is determined."""
    emit("JSON_OUTPUT_PATH", {"path": path})


def emit_cache_path(path: str) -> None:
    """Emit JSON_CACHE_PATH so Dashboard can record cache location for proofreading."""
    emit("JSON_CACHE_PATH", {"path": path})


def emit_final(
    *,
    total_time: float,
    avg_speed: float,
    source_lines: int,
    source_chars: int,
    output_lines: int,
    output_chars: int,
    # V2 API 专属统计（可选，V1 不传）
    total_requests: int = 0,
    total_retries: int = 0,
    total_errors: int = 0,
    total_input_tokens: int = 0,
    total_output_tokens: int = 0,
    error_status_codes: Optional[Dict[str, int]] = None,
) -> None:
    """Emit JSON_FINAL summary statistics."""
    data: Dict[str, Any] = {
        "totalTime": round(total_time, 1),
        "avgSpeed": round(avg_speed, 1),
        "sourceLines": source_lines,
        "sourceChars": source_chars,
        "outputLines": output_lines,
        "outputChars": output_chars,
    }
    # V2 专属字段始终输出（0 也保留，便于历史落库）
    data["totalRequests"] = total_requests
    data["totalRetries"] = total_retries
    data["totalErrors"] = total_errors
    data["totalInputTokens"] = total_input_tokens
    data["totalOutputTokens"] = total_output_tokens
    if error_status_codes:
        data["errorStatusCodes"] = error_status_codes
    emit("JSON_FINAL", data)


def emit_retry(
    block: int,
    attempt: int,
    error_type: str,
    *,
    src_lines: int = 0,
    dst_lines: int = 0,
) -> None:
    """Emit JSON_RETRY for retry events."""
    payload: Dict[str, Any] = {
        "block": block,
        "attempt": attempt,
        "type": error_type,
    }
    if src_lines or dst_lines:
        payload["src_lines"] = src_lines
        payload["dst_lines"] = dst_lines
    emit("JSON_RETRY", payload)


def emit_warning(block: int, message: str, warn_type: str = "quality") -> None:
    """Emit JSON_WARNING for quality check warnings."""
    emit("JSON_WARNING", {
        "block": block,
        "type": warn_type,
        "message": message,
    })


def emit_error(message: str, title: str = "Pipeline V2 Error") -> None:
    """Emit JSON_ERROR for critical failures shown as alert dialog."""
    emit("JSON_ERROR", {
        "title": title,
        "message": message,
    })


@dataclass
class ProgressTracker:
    """Accumulates per-block stats and emits periodic progress updates."""

    total_blocks: int = 0
    completed_blocks: int = 0
    total_source_lines: int = 0
    total_source_chars: int = 0
    total_output_lines: int = 0
    total_output_chars: int = 0
    start_time: float = field(default_factory=time.time)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # --- V2 API 专属统计 ---
    total_requests: int = 0
    total_retries: int = 0
    total_errors: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    error_status_codes: Counter = field(default_factory=Counter)
    last_ping: Optional[int] = None
    current_concurrency: int = 1
    api_url: Optional[str] = None
    _last_emit_at: float = 0.0
    _min_emit_interval_sec: float = 0.2
    _speed_window_sec: float = 5.0
    _request_window_sec: float = 60.0
    _speed_samples: Deque[Tuple[float, int, int, int, int]] = field(
        default_factory=deque, repr=False
    )
    _request_timestamps: Deque[float] = field(default_factory=deque, repr=False)

    def _prune_request_timestamps_locked(self, now: float) -> None:
        cutoff = now - self._request_window_sec
        while self._request_timestamps and self._request_timestamps[0] < cutoff:
            self._request_timestamps.popleft()

    def _append_speed_sample_locked(self, now: float) -> None:
        self._speed_samples.append(
            (
                now,
                self.total_output_lines,
                self.total_output_chars,
                self.total_input_tokens,
                self.total_output_tokens,
            )
        )
        cutoff = now - self._speed_window_sec
        while len(self._speed_samples) > 2 and self._speed_samples[0][0] < cutoff:
            self._speed_samples.popleft()

    def _build_progress_payload_locked(self, now: float) -> Dict[str, Any]:
        self._prune_request_timestamps_locked(now)
        self._append_speed_sample_locked(now)

        elapsed = max(now - self.start_time, 0.001)

        avg_speed_chars = self.total_output_chars / elapsed
        avg_speed_lines = self.total_output_lines / elapsed
        avg_speed_gen = self.total_output_tokens / elapsed
        avg_speed_eval = self.total_input_tokens / elapsed

        realtime_speed_chars = 0.0
        realtime_speed_lines = 0.0
        realtime_speed_gen = 0.0
        realtime_speed_eval = 0.0
        if len(self._speed_samples) >= 2:
            t0, lines0, chars0, input0, output0 = self._speed_samples[0]
            t1, lines1, chars1, input1, output1 = self._speed_samples[-1]
            dt = max(t1 - t0, 0.001)
            realtime_speed_lines = max(0.0, (lines1 - lines0) / dt)
            realtime_speed_chars = max(0.0, (chars1 - chars0) / dt)
            realtime_speed_eval = max(0.0, (input1 - input0) / dt)
            realtime_speed_gen = max(0.0, (output1 - output0) / dt)

        warmup_window = min(self._request_window_sec, max(elapsed, 1.0))
        api_rpm = (len(self._request_timestamps) * 60.0) / warmup_window

        return {
            "current": self.completed_blocks,
            "total": self.total_blocks,
            "elapsed": elapsed,
            # speed_* 在 V2 下改为实时口径（滑动窗口）
            "speed_chars": realtime_speed_chars,
            "speed_lines": realtime_speed_lines,
            "speed_gen": realtime_speed_gen,
            "speed_eval": realtime_speed_eval,
            "total_lines": self.total_output_lines,
            "total_chars": self.total_output_chars,
            "source_lines": self.total_source_lines,
            "source_chars": self.total_source_chars,
            "api_ping": self.last_ping,
            "api_concurrency": self.current_concurrency,
            "api_url": self.api_url,
            "realtime_speed_chars": realtime_speed_chars,
            "realtime_speed_lines": realtime_speed_lines,
            "realtime_speed_gen": realtime_speed_gen,
            "realtime_speed_eval": realtime_speed_eval,
            "realtime_speed_tokens": realtime_speed_gen + realtime_speed_eval,
            "api_rpm": api_rpm,
            "total_requests": self.total_requests,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "avg_speed_chars": avg_speed_chars,
            "avg_speed_lines": avg_speed_lines,
            "avg_speed_gen": avg_speed_gen,
            "avg_speed_eval": avg_speed_eval,
        }

    def emit_progress_snapshot(self, *, force: bool = False) -> None:
        """Emit a progress snapshot (throttled by default)."""
        payload: Optional[Dict[str, Any]] = None
        now = time.time()
        with self._lock:
            if not force and (now - self._last_emit_at) < self._min_emit_interval_sec:
                return
            payload = self._build_progress_payload_locked(now)
            self._last_emit_at = now

        if payload is None:
            return

        emit_progress(
            current=int(payload["current"]),
            total=int(payload["total"]),
            elapsed=float(payload["elapsed"]),
            speed_chars=float(payload["speed_chars"]),
            speed_lines=float(payload["speed_lines"]),
            speed_gen=float(payload["speed_gen"]),
            speed_eval=float(payload["speed_eval"]),
            total_lines=int(payload["total_lines"]),
            total_chars=int(payload["total_chars"]),
            source_lines=int(payload["source_lines"]),
            source_chars=int(payload["source_chars"]),
            api_ping=payload["api_ping"],
            api_concurrency=int(payload["api_concurrency"]),
            api_url=payload["api_url"],
            realtime_speed_chars=float(payload["realtime_speed_chars"]),
            realtime_speed_lines=float(payload["realtime_speed_lines"]),
            realtime_speed_gen=float(payload["realtime_speed_gen"]),
            realtime_speed_eval=float(payload["realtime_speed_eval"]),
            realtime_speed_tokens=float(payload["realtime_speed_tokens"]),
            api_rpm=float(payload["api_rpm"]),
            total_requests=int(payload["total_requests"]),
            total_input_tokens=int(payload["total_input_tokens"]),
            total_output_tokens=int(payload["total_output_tokens"]),
        )

    def block_done(
        self,
        block_idx: int,
        src_text: str,
        output_text: str,
        *,
        emit_preview: bool = True,
        lines_done: Optional[int] = None,
    ) -> None:
        """Record a completed block and emit progress + preview."""
        out_lines = lines_done if lines_done is not None else (output_text.count("\n") + 1 if output_text else 0)
        out_chars = len(output_text)

        with self._lock:
            self.completed_blocks += 1
            self.total_output_lines += out_lines
            self.total_output_chars += out_chars
        self.emit_progress_snapshot(force=True)

        if emit_preview:
            # Truncate very long blocks for preview
            max_preview = 2000
            preview_src = src_text[:max_preview] if len(src_text) > max_preview else src_text
            preview_out = output_text[:max_preview] if len(output_text) > max_preview else output_text
            emit_preview_block(block_idx + 1, preview_src, preview_out)

    def note_request(
        self,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
        ping: Optional[int] = None,
    ) -> None:
        """Record a successful API request with token usage."""
        now = time.time()
        with self._lock:
            self.total_requests += 1
            self.total_input_tokens += input_tokens
            self.total_output_tokens += output_tokens
            if ping is not None:
                self.last_ping = ping
            self._request_timestamps.append(now)
            self._prune_request_timestamps_locked(now)
        # 请求完成后即时更新一次进度（含实时 RPM / token 速度）
        self.emit_progress_snapshot(force=False)

    def note_retry(self, status_code: Optional[int] = None) -> None:
        """Record a retry event."""
        with self._lock:
            self.total_retries += 1
            if status_code is not None:
                self.error_status_codes[status_code] += 1

    def note_error(self, status_code: Optional[int] = None) -> None:
        """Record a final error (exhausted retries)."""
        with self._lock:
            self.total_errors += 1
            if status_code is not None:
                self.error_status_codes[status_code] += 1

    def seed_progress(
        self,
        *,
        completed_blocks: int,
        output_lines: int,
        output_chars: int,
    ) -> None:
        """Seed progress counters for resume mode and emit a baseline progress update."""
        with self._lock:
            self.completed_blocks = max(0, min(completed_blocks, self.total_blocks))
            self.total_output_lines = max(0, output_lines)
            self.total_output_chars = max(0, output_chars)
        self.emit_progress_snapshot(force=True)

    def emit_final_stats(self) -> None:
        """Emit JSON_FINAL with accumulated statistics (incl. V2 API stats)."""
        elapsed = time.time() - self.start_time
        avg_speed = self.total_output_chars / max(elapsed, 0.1)
        emit_final(
            total_time=elapsed,
            avg_speed=avg_speed,
            source_lines=self.total_source_lines,
            source_chars=self.total_source_chars,
            output_lines=self.total_output_lines,
            output_chars=self.total_output_chars,
            total_requests=self.total_requests,
            total_retries=self.total_retries,
            total_errors=self.total_errors,
            total_input_tokens=self.total_input_tokens,
            total_output_tokens=self.total_output_tokens,
            error_status_codes=dict(self.error_status_codes),
        )
