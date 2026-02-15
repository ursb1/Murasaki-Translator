# Policy registry for Pipeline V2.

from __future__ import annotations

from typing import Dict

from murasaki_flow_v2.registry.profile_store import ProfileStore
from .line_policy import LinePolicy, StrictLinePolicy, TolerantLinePolicy, LinePolicyError


class PolicyRegistry:
    def __init__(self, store: ProfileStore):
        self.store = store
        self._line_cache: Dict[str, LinePolicy] = {}

    def get_line_policy(self, ref: str) -> LinePolicy:
        if ref in self._line_cache:
            return self._line_cache[ref]
        profile = self.store.load_profile("policy", ref)
        policy_type = str(profile.get("type") or "tolerant")
        if policy_type == "strict":
            policy = StrictLinePolicy(profile)
        elif policy_type == "tolerant":
            policy = TolerantLinePolicy(profile)
        else:
            raise LinePolicyError(f"Unsupported line policy: {policy_type}")
        self._line_cache[ref] = policy
        return policy
