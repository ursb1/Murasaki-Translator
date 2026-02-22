"""Provider pool for load balancing between multiple API profiles."""

from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING
import math
import random
import threading

from .base import BaseProvider, ProviderError, ProviderRequest, ProviderResponse
from .openai_compat import OpenAICompatProvider

if TYPE_CHECKING:
    from .registry import ProviderRegistry


class PoolProvider(BaseProvider):
    def __init__(self, profile: Dict[str, Any], registry: "ProviderRegistry"):
        super().__init__(profile)
        self.registry = registry
        self._endpoints = self._normalize_endpoints(profile.get("endpoints") or [])
        if not self._endpoints:
            raise ProviderError("Pool provider requires endpoints")
        self._endpoint_providers = [
            OpenAICompatProvider(self._build_endpoint_profile(item))
            for item in self._endpoints
        ]
        self._endpoint_weights = [
            self._normalize_weight(item.get("weight")) for item in self._endpoints
        ]
        self._lock = threading.Lock()

    def _normalize_endpoints(self, raw: Any) -> List[Dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        endpoints: List[Dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            base_url = str(item.get("base_url") or item.get("baseUrl") or "").strip()
            if not base_url:
                continue
            endpoint_index = len(endpoints)
            endpoint_id = (
                str(item.get("id") or item.get("endpoint_id") or "").strip()
                or f"endpoint_{endpoint_index + 1}"
            )
            endpoint_label = (
                str(item.get("label") or item.get("name") or "").strip()
                or endpoint_id
            )
            endpoints.append(
                {
                    "base_url": base_url,
                    "api_key": item.get("api_key") or item.get("apiKey"),
                    "model": item.get("model"),
                    "weight": item.get("weight"),
                    "rpm": item.get("rpm"),
                    "endpoint_id": endpoint_id,
                    "endpoint_label": endpoint_label,
                }
            )
        return endpoints

    def _normalize_weight(self, value: Any) -> float:
        try:
            weight = float(value)
        except (TypeError, ValueError):
            weight = 1.0
        if not math.isfinite(weight) or weight <= 0:
            return 1.0
        return weight

    def _build_endpoint_profile(self, endpoint: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "base_url": endpoint.get("base_url"),
            "api_key": endpoint.get("api_key") or self.profile.get("api_key"),
            "model": endpoint.get("model") or self.profile.get("model"),
            "headers": self.profile.get("headers"),
            "params": self.profile.get("params"),
            "timeout": self.profile.get("timeout"),
            "rpm": endpoint.get("rpm") or self.profile.get("rpm"),
            "_pool_endpoint_id": endpoint.get("endpoint_id"),
            "_pool_endpoint_label": endpoint.get("endpoint_label"),
        }

    def _pick_endpoint_index(self) -> int:
        with self._lock:
            if not self._endpoint_weights:
                return 0
            return random.choices(
                range(len(self._endpoint_weights)),
                weights=self._endpoint_weights,
                k=1,
            )[0]

    def _endpoint_id(self, index: int) -> str:
        return f"endpoint:{index}"

    def _endpoint_from_request(self, request: ProviderRequest) -> int | None:
        provider_id = request.provider_id or ""
        if provider_id.startswith("endpoint:"):
            try:
                idx = int(provider_id.split(":", 1)[1])
            except (ValueError, TypeError):
                return None
            if 0 <= idx < len(self._endpoint_providers):
                return idx
        return None

    def _attach_endpoint_meta(self, request: ProviderRequest, idx: int) -> None:
        endpoint = self._endpoints[idx]
        request.provider_id = self._endpoint_id(idx)
        request_meta = dict(request.meta or {})
        request_meta.update(
            {
                "endpoint_index": idx,
                "endpoint_id": endpoint.get("endpoint_id"),
                "endpoint_label": endpoint.get("endpoint_label"),
            }
        )
        request.meta = request_meta

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        idx = self._pick_endpoint_index()
        provider = self._endpoint_providers[idx]
        request = provider.build_request(messages, settings)
        self._attach_endpoint_meta(request, idx)
        return request

    def send(self, request: ProviderRequest) -> ProviderResponse:
        idx = self._endpoint_from_request(request)
        if idx is None:
            idx = self._pick_endpoint_index()
        self._attach_endpoint_meta(request, idx)

        provider = self._endpoint_providers[idx]
        response = provider.send(request)

        if isinstance(response.raw, dict):
            response.raw.setdefault(
                "pool",
                {
                    "endpoint_index": idx,
                    "endpoint_id": self._endpoints[idx].get("endpoint_id"),
                    "endpoint_label": self._endpoints[idx].get("endpoint_label"),
                },
            )
        return response
