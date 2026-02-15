"""OpenAI-compatible provider."""

from __future__ import annotations

from typing import Any, Dict, List
import json
import time
import requests

from .base import BaseProvider, ProviderRequest, ProviderResponse, ProviderError


def _normalize_base_url(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    if base_url.endswith("/v1"):
        return base_url
    if base_url.endswith("/v1/chat/completions"):
        return base_url.rsplit("/chat/completions", 1)[0]
    return f"{base_url}/v1"


def _build_url(base_url: str) -> str:
    normalized = _normalize_base_url(base_url)
    return f"{normalized}/chat/completions"


class OpenAICompatProvider(BaseProvider):
    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        model = str(settings.get("model") or self.profile.get("model") or "").strip()
        if not model:
            raise ProviderError("OpenAI-compatible provider requires model")
        temperature = settings.get("temperature")
        max_tokens = settings.get("max_tokens")
        extra: Dict[str, Any] = {}
        profile_params = self.profile.get("params") or {}
        settings_params = settings.get("params") or settings.get("extra") or {}
        if isinstance(profile_params, dict):
            extra.update(profile_params)
        if isinstance(settings_params, dict):
            extra.update(settings_params)

        headers: Dict[str, str] = {}
        profile_headers = self.profile.get("headers") or {}
        settings_headers = settings.get("headers") or {}
        if isinstance(profile_headers, dict):
            headers.update({str(k): str(v) for k, v in profile_headers.items()})
        if isinstance(settings_headers, dict):
            headers.update({str(k): str(v) for k, v in settings_headers.items()})

        timeout = settings.get("timeout") or self.profile.get("timeout")
        timeout = int(timeout) if timeout is not None else None
        return ProviderRequest(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            extra=extra,
            headers=headers if headers else None,
            timeout=timeout,
        )

    def send(self, request: ProviderRequest) -> ProviderResponse:
        base_url = str(self.profile.get("base_url") or "").strip()
        if not base_url:
            raise ProviderError("OpenAI-compatible provider requires base_url")

        url = _build_url(base_url)
        api_key = str(self.profile.get("api_key") or "").strip()
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        if request.headers:
            headers.update({str(k): str(v) for k, v in request.headers.items()})

        payload: Dict[str, Any] = {
            "model": request.model,
            "messages": request.messages,
        }
        if request.temperature is not None:
            payload["temperature"] = request.temperature
        if request.max_tokens is not None:
            payload["max_tokens"] = request.max_tokens
        if request.extra:
            payload.update(request.extra)

        start = time.time()
        try:
            resp = requests.post(
                url,
                headers=headers,
                data=json.dumps(payload),
                timeout=request.timeout or 600,
            )
        except requests.RequestException as exc:
            raise ProviderError(f"OpenAI-compatible request failed: {exc}") from exc

        duration = time.time() - start
        if resp.status_code >= 400:
            raise ProviderError(
                f"OpenAI-compatible HTTP {resp.status_code}: {resp.text}"
            )

        try:
            data = resp.json()
        except ValueError as exc:
            raise ProviderError("OpenAI-compatible response is not JSON") from exc

        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("OpenAI-compatible response missing content") from exc

        return ProviderResponse(text=text, raw={"data": data, "duration": duration})
