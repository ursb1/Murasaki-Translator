"""Built-in parser implementations."""

from __future__ import annotations

from typing import Any, List
import json
import re

from .base import BaseParser, ParseOutput, ParserError


def _split_lines_keep_empty(text: str) -> List[str]:
    if text == "":
        return [""]
    return text.split("\n")


class PlainParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        cleaned = text.strip("\n")
        return ParseOutput(text=cleaned, lines=_split_lines_keep_empty(cleaned))


class LineStrictParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        options = self.profile.get("options") or {}
        multi_line = str(options.get("multi_line") or "join")
        lines = _split_lines_keep_empty(text.strip("\n"))
        if len(lines) <= 1:
            return ParseOutput(text=lines[0] if lines else "", lines=lines if lines else [""])
        if multi_line == "first":
            return ParseOutput(text=lines[0], lines=[lines[0]])
        if multi_line == "error":
            raise ParserError("LineStrictParser: multiple lines detected")
        joined = " ".join([l for l in lines if l.strip()]) if multi_line == "join" else "\n".join(lines)
        return ParseOutput(text=joined, lines=[joined])


class JsonArrayParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ParserError("JsonArrayParser: invalid JSON") from exc
        if not isinstance(data, list):
            raise ParserError("JsonArrayParser: expected JSON array")
        lines = [str(item) for item in data]
        return ParseOutput(text="\n".join(lines), lines=lines)


class TaggedLineParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        options = self.profile.get("options") or {}
        pattern = options.get("pattern") or r"^@@(?P<id>\d+)@@(?P<text>.*)$"
        compiled = re.compile(pattern)
        lines: List[str] = []
        for raw in text.splitlines():
            match = compiled.match(raw.strip())
            if match:
                lines.append(match.group("text"))
        if not lines:
            raise ParserError("TaggedLineParser: no tagged lines found")
        return ParseOutput(text="\n".join(lines), lines=lines)


class RegexParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        options = self.profile.get("options") or {}
        pattern = str(options.get("pattern") or "").strip()
        if not pattern:
            raise ParserError("RegexParser: options.pattern is required")

        flags = 0
        raw_flags = options.get("flags")
        if isinstance(raw_flags, str):
            raw_flags = [f.strip() for f in raw_flags.split(",") if f.strip()]
        if isinstance(raw_flags, list):
            if any(str(f).lower() == "multiline" for f in raw_flags):
                flags |= re.MULTILINE
            if any(str(f).lower() == "dotall" for f in raw_flags):
                flags |= re.DOTALL
            if any(str(f).lower() == "ignorecase" for f in raw_flags):
                flags |= re.IGNORECASE
        if options.get("multiline"):
            flags |= re.MULTILINE
        if options.get("dotall"):
            flags |= re.DOTALL
        if options.get("ignorecase"):
            flags |= re.IGNORECASE

        compiled = re.compile(pattern, flags)
        match = compiled.search(text)
        if not match:
            raise ParserError("RegexParser: pattern not matched")
        group = options.get("group", 0)
        try:
            extracted = match.group(group)
        except (IndexError, KeyError) as exc:
            raise ParserError("RegexParser: invalid group") from exc
        cleaned = str(extracted).strip("\n")
        return ParseOutput(text=cleaned, lines=_split_lines_keep_empty(cleaned))


def _get_by_path(data: Any, path: str) -> Any:
    current = data
    for part in path.split("."):
        if part == "":
            continue
        if isinstance(current, list):
            try:
                index = int(part)
            except ValueError as exc:
                raise ParserError("JsonObjectParser: list index must be int") from exc
            try:
                current = current[index]
            except IndexError as exc:
                raise ParserError("JsonObjectParser: list index out of range") from exc
        elif isinstance(current, dict):
            if part not in current:
                raise ParserError("JsonObjectParser: key not found")
            current = current[part]
        else:
            raise ParserError("JsonObjectParser: invalid path segment")
    return current


class JsonObjectParser(BaseParser):
    def parse(self, text: str) -> ParseOutput:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ParserError("JsonObjectParser: invalid JSON") from exc
        if not isinstance(data, dict):
            raise ParserError("JsonObjectParser: expected JSON object")
        options = self.profile.get("options") or {}
        path = options.get("path") or options.get("key")
        if not path:
            raise ParserError("JsonObjectParser: options.path or options.key is required")
        value = _get_by_path(data, str(path))
        cleaned = str(value).strip("\n")
        return ParseOutput(text=cleaned, lines=_split_lines_keep_empty(cleaned))
