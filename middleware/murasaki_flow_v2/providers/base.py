"""Provider base classes for Pipeline V2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class ProviderRequest:
    model: str
    messages: List[Dict[str, str]]
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    extra: Dict[str, Any] | None = None
    headers: Dict[str, str] | None = None
    timeout: Optional[int] = None
    provider_id: Optional[str] = None
    request_id: Optional[str] = None
    meta: Dict[str, Any] | None = None


@dataclass
class ProviderResponse:
    text: str
    raw: Any
    status_code: Optional[int] = None
    duration_ms: Optional[int] = None
    url: Optional[str] = None
    request_headers: Dict[str, str] | None = None
    response_headers: Dict[str, str] | None = None


class ProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        error_type: str | None = None,
        status_code: int | None = None,
        request_id: str | None = None,
        duration_ms: int | None = None,
        url: str | None = None,
        response_text: str | None = None,
        request_headers: Dict[str, str] | None = None,
        response_headers: Dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.status_code = status_code
        self.request_id = request_id
        self.duration_ms = duration_ms
        self.url = url
        self.response_text = response_text
        self.request_headers = request_headers
        self.response_headers = response_headers


class BaseProvider:
    def __init__(self, profile: Dict[str, Any]):
        self.profile = profile

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        raise NotImplementedError

    def send(self, request: ProviderRequest) -> ProviderResponse:
        raise NotImplementedError
