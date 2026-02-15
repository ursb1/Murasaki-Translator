# Validation helpers for Pipeline V2 profiles.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from murasaki_flow_v2.registry.profile_store import ProfileStore


@dataclass
class ValidationResult:
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _ensure_field(data: Dict[str, Any], field: str, result: ValidationResult) -> None:
    if not data.get(field):
        result.errors.append(f"missing_field:{field}")


def _warn_unknown_type(value: str, result: ValidationResult) -> None:
    if value:
        result.warnings.append(f"unsupported_type:{value}")


def _warn_missing_ref(kind: str, ref: str, result: ValidationResult) -> None:
    result.warnings.append(f"missing_reference:{kind}:{ref}")


def _exists(store: Optional[ProfileStore], kind: str, ref: str) -> bool:
    if not store or not ref:
        return False
    return bool(store.resolve_profile_path(kind, ref))


def validate_profile(
    kind: str,
    data: Dict[str, Any],
    store: Optional[ProfileStore] = None,
) -> ValidationResult:
    result = ValidationResult()
    if not isinstance(data, dict):
        result.errors.append("invalid_yaml")
        return result

    if not data.get("id"):
        result.errors.append("missing_id")

    if kind == "api":
        api_type = str(data.get("type") or data.get("provider") or "openai_compat")
        if api_type == "openai_compat":
            if not data.get("base_url"):
                result.errors.append("missing_base_url")
            if not data.get("model"):
                result.errors.append("missing_model")
        elif api_type == "pool":
            members = data.get("members")
            if not isinstance(members, list) or not members:
                result.errors.append("missing_members")
        else:
            _warn_unknown_type(api_type, result)

    if kind == "parser":
        parser_type = str(data.get("type") or "")
        if not parser_type:
            result.errors.append("missing_field:type")
        if parser_type == "regex":
            pattern = (data.get("options") or {}).get("pattern")
            if not pattern:
                result.errors.append("missing_pattern")
        if parser_type == "json_object":
            options = data.get("options") or {}
            if not options.get("path") and not options.get("key"):
                result.errors.append("missing_json_path")

    if kind == "policy":
        policy_type = str(data.get("type") or "")
        if not policy_type:
            result.errors.append("missing_field:type")
        if policy_type and policy_type not in {"strict", "tolerant"}:
            _warn_unknown_type(policy_type, result)

    if kind == "chunk":
        chunk_type = str(data.get("chunk_type") or data.get("type") or "")
        if not chunk_type:
            result.errors.append("missing_field:chunk_type")
        if chunk_type and chunk_type not in {"legacy", "line"}:
            _warn_unknown_type(chunk_type, result)

    if kind == "pipeline":
        for field in ("provider", "prompt", "parser", "chunk_policy"):
            _ensure_field(data, field, result)
        if data.get("apply_line_policy") and not data.get("line_policy"):
            result.errors.append("missing_field:line_policy")

        if store:
            ref_map = {
                "provider": "api",
                "prompt": "prompt",
                "parser": "parser",
                "line_policy": "policy",
                "chunk_policy": "chunk",
            }
            for field, ref_kind in ref_map.items():
                ref_id = str(data.get(field) or "")
                if ref_id and not _exists(store, ref_kind, ref_id):
                    _warn_missing_ref(ref_kind, ref_id, result)

    return result
