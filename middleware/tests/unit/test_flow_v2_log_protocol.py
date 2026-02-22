"""Tests for V2 log protocol realtime metrics."""

import pytest

from murasaki_flow_v2.utils import log_protocol as lp


class _FakeClock:
    def __init__(self, start: float = 0.0):
        self.now = start


@pytest.mark.unit
def test_progress_tracker_emits_realtime_metrics(monkeypatch):
    emitted = []
    clock = _FakeClock(0.0)

    monkeypatch.setattr(lp, "emit", lambda prefix, data: emitted.append((prefix, data)))
    monkeypatch.setattr(lp.time, "time", lambda: clock.now)

    tracker = lp.ProgressTracker(
        total_blocks=3,
        total_source_lines=3,
        total_source_chars=30,
        api_url="https://api.example.com",
    )
    tracker.start_time = clock.now

    tracker.emit_progress_snapshot(force=True)
    clock.now = 0.5
    tracker.note_request(input_tokens=120, output_tokens=60, ping=95)
    clock.now = 1.0
    tracker.block_done(0, "src line", "dst line")

    progress_payloads = [payload for prefix, payload in emitted if prefix == "JSON_PROGRESS"]
    assert len(progress_payloads) >= 2

    latest = progress_payloads[-1]
    assert latest["total_requests"] >= 1
    assert latest["total_input_tokens"] >= 120
    assert latest["total_output_tokens"] >= 60
    assert latest["api_rpm"] > 0
    assert latest["realtime_speed_tokens"] >= 0
    assert latest["realtime_speed_chars"] >= 0
    assert latest["realtime_speed_lines"] >= 0

    preview_payloads = [payload for prefix, payload in emitted if prefix == "JSON_PREVIEW_BLOCK"]
    assert len(preview_payloads) == 1
    assert preview_payloads[0]["block"] == 1


@pytest.mark.unit
def test_progress_tracker_rpm_uses_active_window(monkeypatch):
    emitted = []
    clock = _FakeClock(0.0)

    monkeypatch.setattr(lp, "emit", lambda prefix, data: emitted.append((prefix, data)))
    monkeypatch.setattr(lp.time, "time", lambda: clock.now)

    tracker = lp.ProgressTracker(total_blocks=10)
    tracker.start_time = clock.now
    tracker.emit_progress_snapshot(force=True)

    for _ in range(5):
        clock.now += 2.0
        tracker.note_request(input_tokens=10, output_tokens=5)

    progress_payloads = [payload for prefix, payload in emitted if prefix == "JSON_PROGRESS"]
    assert progress_payloads
    latest = progress_payloads[-1]
    # 5 requests / 10 seconds => 30 RPM（按当前运行窗口折算）
    assert 29.0 <= float(latest["api_rpm"]) <= 31.0
