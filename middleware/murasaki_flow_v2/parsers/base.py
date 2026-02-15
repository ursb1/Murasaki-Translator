"""Parser base classes for Pipeline V2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class ParseOutput:
    text: str
    lines: List[str]


class ParserError(RuntimeError):
    pass


class BaseParser:
    def __init__(self, profile: Dict[str, Any]):
        self.profile = profile

    def parse(self, text: str) -> ParseOutput:
        raise NotImplementedError
