"""Profile Store for Pipeline V2 (YAML-based)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import os

import yaml


@dataclass
class ProfileRef:
    kind: str
    profile_id: str
    path: str
    name: str


class ProfileStore:
    def __init__(self, base_dir: str):
        self.base_dir = base_dir

    def _kind_dir(self, kind: str) -> str:
        return os.path.join(self.base_dir, kind)

    def ensure_dirs(self, kinds: List[str]) -> None:
        for kind in kinds:
            os.makedirs(self._kind_dir(kind), exist_ok=True)

    def list_profiles(self, kind: str) -> List[ProfileRef]:
        result: List[ProfileRef] = []
        kind_dir = self._kind_dir(kind)
        if not os.path.isdir(kind_dir):
            return result
        for name in sorted(os.listdir(kind_dir)):
            if not name.endswith((".yaml", ".yml")):
                continue
            path = os.path.join(kind_dir, name)
            data = self.load_profile_by_path(path)
            if not isinstance(data, dict):
                continue
            profile_id = str(data.get("id") or os.path.splitext(name)[0])
            display_name = str(data.get("name") or profile_id)
            result.append(
                ProfileRef(
                    kind=kind,
                    profile_id=profile_id,
                    path=path,
                    name=display_name,
                )
            )
        return result

    def load_profile(self, kind: str, ref: str) -> Dict[str, Any]:
        path = self.resolve_profile_path(kind, ref)
        if not path:
            raise FileNotFoundError(f"Profile not found: {kind}:{ref}")
        return self.load_profile_by_path(path)

    def load_profile_by_path(self, path: str) -> Dict[str, Any]:
        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if not isinstance(data, dict):
            raise ValueError(f"Invalid profile YAML: {path}")
        data.setdefault("id", os.path.splitext(os.path.basename(path))[0])
        data.setdefault("name", data.get("id"))
        data.setdefault("_path", path)
        return data

    def resolve_profile_path(self, kind: str, ref: str) -> Optional[str]:
        if not ref:
            return None
        if os.path.isabs(ref) and os.path.exists(ref):
            return ref
        if ref.endswith((".yaml", ".yml")):
            candidate = os.path.join(self._kind_dir(kind), ref)
            if os.path.exists(candidate):
                return candidate
        candidate = os.path.join(self._kind_dir(kind), f"{ref}.yaml")
        if os.path.exists(candidate):
            return candidate
        for profile in self.list_profiles(kind):
            if profile.profile_id == ref:
                return profile.path
        return None
