"""OpenAI-compatible provider."""

from __future__ import annotations

from typing import Any, Dict, List
import itertools
import json
import threading
import time
import re
from urllib.parse import urlparse

import requests

from murasaki_flow_v2.utils.api_stats_protocol import sanitize_headers

from .base import BaseProvider, ProviderError, ProviderRequest, ProviderResponse


_VERSION_SEGMENT = re.compile(r"/v\d+(?:/|$)")
DEFAULT_STOP_TOKENS = [
    "<|im_end|>",
    "<|endoftext|>",
    "</s>",
    "<|eot_id|>",
    "<|end_of_text|>",
    "\n\n\n",
]
DEFAULT_TIMEOUT_SECONDS = 60
MAX_ERROR_TEXT_CHARS = 4000


class _RpmLimiter:
    def __init__(self, rpm: int):
        self.rpm = rpm
        self._lock = threading.Lock()
        self._next_slot = 0.0

    def acquire(self) -> None:
        if self.rpm <= 0:
            return
        interval = 60.0 / float(self.rpm)
        with self._lock:
            now = time.monotonic()
            slot = max(self._next_slot, now)
            self._next_slot = slot + interval
            wait_seconds = slot - now
        if wait_seconds > 0:
            time.sleep(wait_seconds)


def _normalize_base_url(base_url: str) -> str:
    base_url = base_url.strip().rstrip("/")
    if not base_url:
        return base_url
    if base_url.endswith("/v1/chat/completions"):
        return base_url.rsplit("/chat/completions", 1)[0]

    path = (urlparse(base_url).path or "").lower()
    if (
        not path
        or path == "/"
        or path.endswith("/v1")
        or _VERSION_SEGMENT.search(path)
        or "/openapi" in path
    ):
        return base_url if path and path != "/" else f"{base_url}/v1"

    return base_url


def _build_url(base_url: str) -> str:
    base_url = base_url.strip().rstrip("/")
    if not base_url:
        return ""

    if base_url.endswith("/chat/completions"):
        return base_url

    normalized = _normalize_base_url(base_url)
    return f"{normalized}/chat/completions"


def _normalize_keys(raw: Any) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str):
        return [line.strip() for line in raw.splitlines() if line.strip()]
    return [str(raw).strip()] if str(raw).strip() else []


def _parse_timeout_seconds(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = int(float(text))
    except (ValueError, TypeError):
        return None
    return parsed if parsed > 0 else None


def _extract_usage(data: Any) -> Dict[str, Any]:
    if isinstance(data, dict):
        usage = data.get("usage")
        if isinstance(usage, dict):
            return usage
    return {}


class OpenAICompatProvider(BaseProvider):
    def __init__(self, profile: Dict[str, Any]):
        super().__init__(profile)
        self._api_keys = _normalize_keys(profile.get("api_key"))
        self._api_key_cycle = (
            itertools.cycle(self._api_keys) if len(self._api_keys) > 1 else None
        )
        self._lock = threading.Lock()
        raw_rpm = (
            profile.get("rpm")
            if profile.get("rpm") is not None
            else profile.get("requests_per_minute")
        )
        try:
            rpm_value = int(raw_rpm) if raw_rpm is not None else 0
        except (TypeError, ValueError):
            rpm_value = 0
        self._rpm_limiter = _RpmLimiter(rpm_value) if rpm_value > 0 else None
        self._session = requests.Session()

    def _pick_api_key(self) -> str:
        if not self._api_keys:
            return ""
        with self._lock:
            if self._api_key_cycle is not None:
                return next(self._api_key_cycle)
            return self._api_keys[0]

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        model = str(settings.get("model") or self.profile.get("model") or "").strip()
        if not model:
            raise ProviderError(
                "OpenAI-compatible provider requires model",
                error_type="invalid_config",
            )

        raw_temp = settings.get("temperature")
        temperature = None
        if raw_temp is not None and str(raw_temp).strip() != "":
            try:
                temperature = float(raw_temp)
            except (ValueError, TypeError):
                pass

        raw_max = settings.get("max_tokens")
        max_tokens = None
        if raw_max is not None and str(raw_max).strip() != "":
            try:
                max_tokens = int(raw_max)
            except (ValueError, TypeError):
                pass

        extra: Dict[str, Any] = {}
        profile_params = self.profile.get("params") or {}
        settings_params = settings.get("params") or settings.get("extra") or {}
        if isinstance(profile_params, dict):
            extra.update(profile_params)
        if isinstance(settings_params, dict):
            extra.update(settings_params)
        if "stop" not in extra:
            # Keep max 4 stop entries for compatibility with OpenAI-like endpoints.
            extra["stop"] = DEFAULT_STOP_TOKENS[:4]

        headers: Dict[str, str] = {}
        profile_headers = self.profile.get("headers") or {}
        settings_headers = settings.get("headers") or {}
        if isinstance(profile_headers, dict):
            headers.update({str(k): str(v) for k, v in profile_headers.items()})
        if isinstance(settings_headers, dict):
            headers.update({str(k): str(v) for k, v in settings_headers.items()})

        timeout = _parse_timeout_seconds(settings.get("timeout") or self.profile.get("timeout"))

        stats_meta = settings.get("_stats") if isinstance(settings.get("_stats"), dict) else None
        request_id = None
        if stats_meta:
            request_id = str(stats_meta.get("request_id") or "").strip() or None

        return ProviderRequest(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra=extra,
            headers=headers if headers else None,
            timeout=timeout,
            request_id=request_id,
            meta=dict(stats_meta or {}),
        )

    def send(self, request: ProviderRequest) -> ProviderResponse:
        base_url = str(self.profile.get("base_url") or "").strip()
        if not base_url:
            raise ProviderError(
                "OpenAI-compatible provider requires base_url",
                error_type="invalid_config",
                request_id=request.request_id,
            )

        if self._rpm_limiter:
            self._rpm_limiter.acquire()

        url = _build_url(base_url)
        api_key = self._pick_api_key()
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        if request.headers:
            headers.update({str(k): str(v) for k, v in request.headers.items()})

        payload: Dict[str, Any] = {
            "model": request.model,
            "messages": request.messages,
        }
        if request.extra:
            payload.update(request.extra)
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens

        timeout_seconds = request.timeout or DEFAULT_TIMEOUT_SECONDS
        safe_request_headers = sanitize_headers(headers)

        start = time.perf_counter()
        try:
            resp = self._session.post(
                url,
                headers=headers,
                data=json.dumps(payload, ensure_ascii=False),
                timeout=timeout_seconds,
            )
        except requests.Timeout as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            raise ProviderError(
                f"OpenAI-compatible request timeout: {exc}",
                error_type="timeout",
                request_id=request.request_id,
                duration_ms=duration_ms,
                url=url,
                request_headers=safe_request_headers,
            ) from exc
        except requests.RequestException as exc:
            duration_ms = int((time.perf_counter() - start) * 1000)
            raise ProviderError(
                f"OpenAI-compatible request failed: {exc}",
                error_type="network_error",
                request_id=request.request_id,
                duration_ms=duration_ms,
                url=url,
                request_headers=safe_request_headers,
            ) from exc

        duration_ms = int((time.perf_counter() - start) * 1000)
        raw_response_headers = getattr(resp, "headers", None)
        if isinstance(raw_response_headers, dict):
            response_headers = {str(k): str(v) for k, v in raw_response_headers.items()}
        else:
            try:
                response_headers = dict(raw_response_headers or {})
            except Exception:
                response_headers = {}
        safe_response_headers = sanitize_headers(response_headers)

        if resp.status_code >= 400:
            body = (resp.text or "").strip()
            body_preview = body[:MAX_ERROR_TEXT_CHARS]
            raise ProviderError(
                f"OpenAI-compatible HTTP {resp.status_code}: {body_preview}",
                error_type="http_error",
                status_code=resp.status_code,
                request_id=request.request_id,
                duration_ms=duration_ms,
                url=url,
                response_text=body_preview,
                request_headers=safe_request_headers,
                response_headers=safe_response_headers,
            )

        try:
            data = resp.json()
        except ValueError as exc:
            body = (resp.text or "").strip()
            body_preview = body[:MAX_ERROR_TEXT_CHARS]
            raise ProviderError(
                "OpenAI-compatible response is not JSON",
                error_type="invalid_json",
                status_code=resp.status_code,
                request_id=request.request_id,
                duration_ms=duration_ms,
                url=url,
                response_text=body_preview,
                request_headers=safe_request_headers,
                response_headers=safe_response_headers,
            ) from exc

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            body = (resp.text or "").strip()
            body_preview = body[:MAX_ERROR_TEXT_CHARS]
            raise ProviderError(
                "OpenAI-compatible response missing content",
                error_type="invalid_response",
                status_code=resp.status_code,
                request_id=request.request_id,
                duration_ms=duration_ms,
                url=url,
                response_text=body_preview,
                request_headers=safe_request_headers,
                response_headers=safe_response_headers,
            ) from exc

        usage = _extract_usage(data)
        raw = {
            "data": data,
            "usage": usage,
            "duration": duration_ms / 1000.0,
            "duration_ms": duration_ms,
            "request": {
                "url": url,
                "headers": safe_request_headers,
                "payload": payload,
            },
            "response": {
                "status_code": resp.status_code,
                "headers": safe_response_headers,
            },
        }
        return ProviderResponse(
            text=text,
            raw=raw,
            status_code=resp.status_code,
            duration_ms=duration_ms,
            url=url,
            request_headers=safe_request_headers,
            response_headers=safe_response_headers,
        )
