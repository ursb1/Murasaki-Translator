"""Provider pool for load balancing between multiple API profiles."""

from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING
import itertools
import random

from .base import BaseProvider, ProviderRequest, ProviderResponse, ProviderError

if TYPE_CHECKING:
    from .registry import ProviderRegistry


class PoolProvider(BaseProvider):
    def __init__(self, profile: Dict[str, Any], registry: "ProviderRegistry"):
        super().__init__(profile)
        self.registry = registry
        self.strategy = str(profile.get("strategy") or "round_robin")
        members = profile.get("members") or []
        if not isinstance(members, list) or not members:
            raise ProviderError("Pool provider requires non-empty members")
        self.members = [str(m) for m in members]
        self._rr = itertools.cycle(self.members)

    def _pick(self) -> str:
        if self.strategy == "random":
            return random.choice(self.members)
        return next(self._rr)

    def build_request(
        self, messages: List[Dict[str, str]], settings: Dict[str, Any]
    ) -> ProviderRequest:
        provider = self.registry.get_provider(self._pick())
        return provider.build_request(messages, settings)

    def send(self, request: ProviderRequest) -> ProviderResponse:
        provider = self.registry.get_provider(self._pick())
        return provider.send(request)
