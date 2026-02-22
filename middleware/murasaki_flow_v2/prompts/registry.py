# Prompt profile registry for Pipeline V2.

from __future__ import annotations

from typing import Dict

from murasaki_flow_v2.registry.profile_store import ProfileStore


class PromptRegistry:
    def __init__(self, store: ProfileStore):
        self.store = store
        self._cache: Dict[str, dict] = {}

    def get_prompt(self, ref: str) -> dict:
        if ref in self._cache:
            return self._cache[ref]
        profile = self.store.load_profile("prompt", ref)
        self._cache[ref] = profile
        return profile
