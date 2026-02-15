# Line policy implementations for Pipeline V2.

from __future__ import annotations

from typing import Any, Dict, List

from murasaki_flow_v2.utils.line_aligner import align_lines


class LinePolicyError(RuntimeError):
    pass


class LinePolicy:
    def __init__(self, profile: Dict[str, Any]):
        self.profile = profile

    def apply(self, source_lines: List[str], output_lines: List[str]) -> List[str]:
        return output_lines


def _pad_or_truncate(lines: List[str], target_len: int) -> List[str]:
    if len(lines) < target_len:
        return lines + [""] * (target_len - len(lines))
    return lines[:target_len]


class StrictLinePolicy(LinePolicy):
    def apply(self, source_lines: List[str], output_lines: List[str]) -> List[str]:
        if len(source_lines) == len(output_lines):
            return output_lines
        options = self.profile.get("options") or {}
        on_mismatch = str(options.get("on_mismatch") or "error")
        if on_mismatch == "pad":
            return _pad_or_truncate(output_lines, len(source_lines))
        if on_mismatch == "truncate":
            return _pad_or_truncate(output_lines, len(source_lines))
        if on_mismatch == "align":
            return align_lines(source_lines, output_lines)
        raise LinePolicyError(
            f"StrictLinePolicy mismatch: src={len(source_lines)} dst={len(output_lines)}"
        )


class TolerantLinePolicy(LinePolicy):
    def apply(self, source_lines: List[str], output_lines: List[str]) -> List[str]:
        if len(source_lines) == len(output_lines):
            return output_lines
        return align_lines(source_lines, output_lines)
