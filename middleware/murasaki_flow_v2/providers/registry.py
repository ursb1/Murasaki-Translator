"""Provider registry for Pipeline V2."""

from __future__ import annotations

from typing import Dict

from murasaki_flow_v2.registry.profile_store import ProfileStore
from .base import BaseProvider, ProviderError
from .openai_compat import OpenAICompatProvider
from .pool import PoolProvider


class ProviderRegistry:
    def __init__(self, store: ProfileStore):
        self.store = store
        self._cache: Dict[str, BaseProvider] = {}

    def get_provider(self, ref: str) -> BaseProvider:
        if ref in self._cache:
            return self._cache[ref]
        profile = self.store.load_profile("api", ref)
        provider_type = str(profile.get("type") or profile.get("provider") or "openai_compat")
        if provider_type == "pool":
            provider = PoolProvider(profile, registry=self)
        elif provider_type == "openai_compat":
            provider = OpenAICompatProvider(profile)
        else:
            raise ProviderError(f"Unsupported provider type: {provider_type}")
        self._cache[ref] = provider
        return provider
