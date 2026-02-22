"""Pipeline V2 runner."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple
import hashlib
import json
import os
import threading
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from murasaki_translator.documents.factory import DocumentFactory
from murasaki_translator.documents.txt import TxtDocument
from murasaki_translator.documents.srt import SrtDocument
from murasaki_translator.documents.ass import AssDocument
from murasaki_translator.core.cache import TranslationCache
from murasaki_translator.core.chunker import TextBlock

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.providers.registry import ProviderRegistry
from murasaki_flow_v2.parsers.registry import ParserRegistry
from murasaki_flow_v2.prompts.registry import PromptRegistry
from murasaki_flow_v2.prompts.builder import build_messages
from murasaki_flow_v2.policies.registry import PolicyRegistry
from murasaki_flow_v2.policies.chunk_registry import ChunkPolicyRegistry
from murasaki_flow_v2.policies.chunk_policy import LineChunkPolicy
from murasaki_flow_v2.policies.line_policy import LinePolicyError
from murasaki_flow_v2.parsers.base import ParserError
from murasaki_flow_v2.providers.base import ProviderError
from murasaki_flow_v2.utils.adaptive_concurrency import AdaptiveConcurrency
from murasaki_flow_v2.utils.line_format import extract_line_for_policy, parse_jsonl_entries
from murasaki_flow_v2.utils import processing as v2_processing
from murasaki_flow_v2.utils.log_protocol import (
    ProgressTracker, emit_output_path, emit_cache_path, emit_retry, emit_error, emit_warning,
)
from murasaki_flow_v2.utils.api_stats_protocol import (
    emit_api_stats_event,
    generate_request_id,
)

MAX_CONCURRENCY = 256


class PipelineStopRequested(RuntimeError):
    """Raised when an external stop request asks runner to end gracefully."""


class PipelineRunner:
    def __init__(
        self,
        store: ProfileStore,
        pipeline_profile: Dict[str, Any],
        run_id: Optional[str] = None,
    ):
        self.store = store
        self.pipeline = pipeline_profile
        self.providers = ProviderRegistry(store)
        self.parsers = ParserRegistry(store)
        self.prompts = PromptRegistry(store)
        self.line_policies = PolicyRegistry(store)
        self.chunk_policies = ChunkPolicyRegistry(store)
        self.run_id = str(run_id or "").strip()

    @staticmethod
    def _emit_api_stats_safe(payload: Dict[str, Any]) -> None:
        try:
            emit_api_stats_event(payload)
        except Exception:
            # Stats telemetry should never break the translation flow.
            pass

    def _resolve_rules(self, spec: Any) -> List[Dict[str, Any]]:
        if not spec:
            return []
        if isinstance(spec, str):
            normalized = spec.strip()
            if not normalized:
                return []
            if os.path.exists(normalized):
                return v2_processing.load_rules(normalized)
            try:
                profile = self.store.load_profile("rule", normalized)
                return profile.get("rules", [])
            except Exception:
                return []
        if isinstance(spec, list):
            resolved = []
            for item in spec:
                if isinstance(item, dict):
                    resolved.append(item)
                elif isinstance(item, str):
                    normalized = item.strip()
                    if not normalized:
                        continue
                    if os.path.exists(normalized):
                        resolved.extend(v2_processing.load_rules(normalized))
                        continue
                    try:
                        profile = self.store.load_profile("rule", normalized)
                        resolved.extend(profile.get("rules", []))
                    except Exception:
                        pass
            return resolved
        return []

    def _format_glossary_text(self, data: Any) -> str:
        if isinstance(data, dict):
            return "\n".join([f"{k}: {v}" for k, v in data.items()])
        if isinstance(data, list):
            lines = []
            for item in data:
                if isinstance(item, dict):
                    src = item.get("src") or item.get("source") or ""
                    dst = item.get("dst") or item.get("target") or ""
                    if src or dst:
                        lines.append(f"{src}: {dst}")
                else:
                    lines.append(str(item))
            return "\n".join(lines)
        return str(data).strip()

    def _load_glossary(self, glossary_spec: Any) -> str:
        if glossary_spec is None:
            return ""
        if isinstance(glossary_spec, (dict, list)):
            return self._format_glossary_text(glossary_spec)
        if isinstance(glossary_spec, str):
            raw = glossary_spec.strip()
            if not raw:
                return ""
            if os.path.exists(raw):
                try:
                    with open(raw, "r", encoding="utf-8") as f:
                        content = f.read()
                    try:
                        data = json.loads(content)
                        return self._format_glossary_text(data)
                    except json.JSONDecodeError:
                        return content.strip()
                except Exception:
                    return ""
            try:
                data = json.loads(raw)
                return self._format_glossary_text(data)
            except json.JSONDecodeError:
                return raw
        return ""

    def _extract_source_lines(self, items: List[Dict[str, Any]]) -> List[str]:
        lines: List[str] = []
        for item in items:
            text = str(item.get("text") or "")
            lines.append(text.rstrip("\n"))
        return lines

    @staticmethod
    def _block_line_range(block: TextBlock) -> Tuple[int, int]:
        """Return (first_line_index, last_line_index+1) covered by *block*."""
        indices = [
            m for m in (block.metadata or []) if isinstance(m, int)
        ]
        if not indices:
            return (0, 0)
        return (min(indices), max(indices) + 1)

    @staticmethod
    def _build_block_fallback_text(
        source_lines: List[str],
        block: TextBlock,
        *,
        line_index: Optional[int] = None,
        target_line_ids: Optional[List[int]] = None,
    ) -> str:
        if source_lines:
            if target_line_ids:
                safe_ids = [
                    i
                    for i in target_line_ids
                    if isinstance(i, int) and 0 <= i < len(source_lines)
                ]
                if safe_ids:
                    return "\n".join(source_lines[i] for i in safe_ids)

            blk_start, blk_end = PipelineRunner._block_line_range(block)
            if blk_end > blk_start:
                safe_start = max(0, blk_start)
                safe_end = min(len(source_lines), blk_end)
                if safe_end > safe_start:
                    return "\n".join(source_lines[safe_start:safe_end])

            if line_index is not None and 0 <= line_index < len(source_lines):
                return source_lines[line_index]

        return str(getattr(block, "prompt_text", "") or "")

    @staticmethod
    def _resolve_warning_block(blocks: List[TextBlock], line_number: int) -> int:
        """Map global 1-based line number to 1-based block index."""
        if line_number <= 0:
            return 0
        target_line_index = line_number - 1
        for idx, block in enumerate(blocks):
            metadata = block.metadata or []
            int_meta = [meta for meta in metadata if isinstance(meta, int)]
            if int_meta and target_line_index in int_meta:
                return idx + 1
        if 0 <= target_line_index < len(blocks):
            return target_line_index + 1
        return 0

    @staticmethod
    def _filter_target_line_ids(
        metadata: List[Any], start: int, end: int
    ) -> List[int]:
        ids: List[int] = []
        seen: set[int] = set()
        for item in metadata:
            if not isinstance(item, int):
                continue
            if item < start or item >= end:
                continue
            if item in seen:
                continue
            seen.add(item)
            ids.append(item)
        return ids

    @staticmethod
    def _normalize_txt_blocks(blocks: List[TextBlock]) -> None:
        for block in blocks:
            text = str(getattr(block, "prompt_text", "") or "")
            block.prompt_text = text.rstrip("\r\n")

    @staticmethod
    def _should_filter_blank_line_blocks(doc: object, chunk_type: str) -> bool:
        return isinstance(doc, TxtDocument) and chunk_type == "line"

    @staticmethod
    def _collect_blank_line_block_indices(blocks: List[TextBlock]) -> Set[int]:
        blank_indices: Set[int] = set()
        for idx, block in enumerate(blocks):
            text = str(getattr(block, "prompt_text", "") or "")
            if text.strip():
                continue
            blank_indices.add(idx)
        return blank_indices

    @staticmethod
    def _sanitize_post_rules_for_input(
        post_rules: List[Dict[str, Any]],
        input_path: str,
    ) -> List[Dict[str, Any]]:
        lower_input = str(input_path or "").lower()
        if not lower_input.endswith((".srt", ".ass", ".ssa")):
            return list(post_rules or [])
        melt_patterns = {
            "ensure_single_newline",
            "ensure_double_newline",
            "clean_empty_lines",
            "merge_short_lines",
        }
        sanitized: List[Dict[str, Any]] = []
        for rule in post_rules or []:
            if not isinstance(rule, dict):
                continue
            pattern = str(rule.get("pattern") or "").strip().lower()
            if pattern in melt_patterns:
                continue
            sanitized.append(rule)
        return sanitized

    @staticmethod
    def _resolve_protect_patterns_base(input_path: str) -> Optional[List[str]]:
        lower_input = str(input_path or "").lower()
        if lower_input.endswith((".srt", ".ass", ".ssa")):
            from murasaki_translator.core.text_protector import TextProtector

            return list(TextProtector.SUBTITLE_PATTERNS)
        if lower_input.endswith(".epub"):
            return [r"@id=\d+@", r"@end=\d+@", r"<[^>]+>"]
        return None

    @staticmethod
    def _should_use_double_newline_separator(
        post_rules: List[Dict[str, Any]],
    ) -> bool:
        for rule in post_rules or []:
            if not isinstance(rule, dict):
                continue
            if not rule.get("active", True):
                continue
            pattern = str(rule.get("pattern") or "").strip().lower()
            if pattern == "ensure_double_newline":
                return True
        return False

    @staticmethod
    def _save_txt_blocks(
        output_path: str,
        blocks: List[TextBlock],
        *,
        separator: str,
        skip_blank_indices: Optional[Set[int]] = None,
    ) -> None:
        normalized_separator = "\n\n" if separator == "\n\n" else "\n"
        skip_lookup = skip_blank_indices or set()
        output_lines: List[str] = []
        for idx, block in enumerate(blocks):
            if normalized_separator == "\n\n" and idx in skip_lookup:
                continue
            text = str(getattr(block, "prompt_text", "") or "").rstrip("\r\n")
            output_lines.append(text)
        with open(output_path, "w", encoding="utf-8") as f:
            if not output_lines:
                return
            f.write(normalized_separator.join(output_lines))
            f.write(normalized_separator)

    @staticmethod
    def _write_interrupted_preview(
        output_path: str,
        translated_blocks: List[Optional[TextBlock]],
        *,
        separator: str = "\n",
        skip_indices: Optional[Set[int]] = None,
    ) -> Optional[str]:
        if not output_path:
            return None
        preview_path = f"{output_path}.interrupted.txt"
        normalized_separator = "\n\n" if separator == "\n\n" else "\n"
        skip_lookup = skip_indices or set()
        output_lines: List[str] = []
        for idx, block in enumerate(translated_blocks):
            if idx in skip_lookup or block is None:
                continue
            text = str(getattr(block, "prompt_text", "") or "").rstrip("\r\n")
            output_lines.append(text)
        if not output_lines:
            return None
        try:
            with open(preview_path, "w", encoding="utf-8") as f:
                f.write(normalized_separator.join(output_lines))
                f.write(normalized_separator)
        except Exception:
            return None
        return preview_path

    @staticmethod
    def _resolve_output_path(
        input_path: str,
        output_path: Optional[str],
        provider: Any,
        provider_ref: str,
        pipeline_id: str,
    ) -> str:
        if output_path:
            return output_path
        base, ext = os.path.splitext(input_path)
        provider_model = str(
            (getattr(provider, "profile", {}) or {}).get("model") or ""
        ).strip()
        model_name = provider_model or provider_ref or pipeline_id or "translated"
        safe_model_name = re.sub(r'[\\/*?:"<>|]', "_", model_name)
        return f"{base}_{safe_model_name}{ext}"

    @staticmethod
    def _collect_quality_output_lines(blocks: List[TextBlock]) -> List[str]:
        lines: List[str] = []
        for block in blocks:
            text = str(getattr(block, "prompt_text", "") or "")
            split_lines = text.splitlines()
            if split_lines:
                lines.extend(split_lines)
            else:
                lines.append(text)
        return lines

    @staticmethod
    def _ensure_line_chunk_keeps_empty(doc: object, chunk_policy: Any) -> None:
        if not isinstance(chunk_policy, LineChunkPolicy):
            return
        if not isinstance(doc, (SrtDocument, AssDocument)):
            return
        options = (
            chunk_policy.profile.get("options")
            if isinstance(chunk_policy.profile.get("options"), dict)
            else {}
        )
        if "keep_empty" not in options:
            options["keep_empty"] = True
            chunk_policy.profile["options"] = options

    @staticmethod
    def _load_resume_file(
        path: str,
        expected: Optional[Dict[str, Any]] = None,
    ) -> Tuple[Dict[int, Dict[str, str]], bool]:
        entries: Dict[int, Dict[str, str]] = {}
        if not os.path.exists(path):
            return entries, False
        matched = False
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = [line.strip() for line in f.readlines() if line.strip()]
        except Exception:
            return entries, False

        start_idx = 0
        if lines:
            try:
                header = json.loads(lines[0])
            except Exception:
                header = None
            if isinstance(header, dict) and header.get("type") == "fingerprint":
                start_idx = 1
                matched = True
                if expected:
                    for key, value in expected.items():
                        if value is None or value == "":
                            continue
                        if header.get(key) != value:
                            return {}, False
            elif expected:
                # With expected fingerprint constraints we must reject legacy
                # temp files without fingerprint header to avoid mixed resumes.
                return {}, False

        for raw in lines[start_idx:]:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            idx = data.get("index")
            if idx is None:
                idx = data.get("block_idx") or data.get("block")
            if idx is None:
                continue
            try:
                idx = int(idx)
            except (TypeError, ValueError):
                continue
            dst = (
                data.get("dst")
                if data.get("dst") is not None
                else data.get("output")
                if data.get("output") is not None
                else data.get("preview_text")
                if data.get("preview_text") is not None
                else data.get("out_text")
            )
            if dst is None:
                continue
            src = data.get("src") if data.get("src") is not None else data.get("src_text")
            entries[idx] = {"src": str(src or ""), "dst": str(dst or "")}

        if entries and start_idx == 0:
            matched = True
        return entries, matched

    @staticmethod
    def _stable_hash(payload: Any) -> str:
        try:
            raw = json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            )
        except Exception:
            raw = json.dumps(str(payload), ensure_ascii=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _build_resume_fingerprint(
        self,
        *,
        input_path: str,
        pipeline_id: str,
        chunk_type: str,
        pipeline: Dict[str, Any],
        provider_profile: Dict[str, Any],
        prompt_profile: Dict[str, Any],
        parser_profile: Dict[str, Any],
        line_policy_profile: Optional[Dict[str, Any]],
        chunk_policy_profile: Dict[str, Any],
        settings: Dict[str, Any],
        processing_cfg: Dict[str, Any],
        pre_rules: List[Dict[str, Any]],
        post_rules: List[Dict[str, Any]],
        source_format: str,
    ) -> Dict[str, Any]:
        config_payload = {
            "pipeline": pipeline or {},
            "provider_profile": provider_profile or {},
            "prompt_profile": prompt_profile or {},
            "parser_profile": parser_profile or {},
            "line_policy_profile": line_policy_profile or {},
            "chunk_policy_profile": chunk_policy_profile or {},
            "settings": settings or {},
            "processing": processing_cfg or {},
            "rules_pre": pre_rules or [],
            "rules_post": post_rules or [],
            "source_format": source_format,
        }
        return {
            "type": "fingerprint",
            "version": 2,
            "input": input_path,
            "pipeline": pipeline_id,
            "chunk_type": chunk_type,
            "config_hash": self._stable_hash(config_payload),
        }

    @staticmethod
    def _load_resume_cache(
        output_path: str,
        cache_dir: Optional[str] = None,
    ) -> Dict[int, Dict[str, str]]:
        resolved_cache_dir = cache_dir if cache_dir and os.path.isdir(cache_dir) else None
        cache = TranslationCache(output_path, custom_cache_dir=resolved_cache_dir, source_path="")
        if not cache.load():
            return {}
        entries: Dict[int, Dict[str, str]] = {}
        for block in cache.blocks:
            entries[block.index] = {"src": block.src, "dst": block.dst}
        return entries

    def _load_resume_output(
        self,
        output_path: str,
        blocks: List[TextBlock],
        chunk_policy: Any,
        *,
        chunk_type: str,
        skip_indices: Optional[Set[int]] = None,
    ) -> Dict[int, Dict[str, str]]:
        # 仅在 line 模式启用，避免 block 模式发生错位恢复。
        if chunk_type != "line":
            return {}
        if not output_path or not os.path.exists(output_path):
            return {}
        try:
            output_doc = DocumentFactory.get_document(output_path)
            self._ensure_line_chunk_keeps_empty(output_doc, chunk_policy)
            output_items = output_doc.load()
            output_blocks = chunk_policy.chunk(output_items)
        except Exception:
            return {}
        if not output_blocks:
            return {}

        source_count = len(blocks)
        if source_count <= 0:
            return {}
        skip_lookup = skip_indices or set()
        candidate_indices = [
            idx for idx in range(source_count) if idx not in skip_lookup
        ]
        entries: Dict[int, Dict[str, str]] = {}
        used_indices: Set[int] = set()
        sequential_pos = 0

        for output_block in output_blocks:
            dst_text = str(getattr(output_block, "prompt_text", "") or "")
            mapped_idx: Optional[int] = None
            for meta in getattr(output_block, "metadata", None) or []:
                if not isinstance(meta, int):
                    continue
                if meta < 0 or meta >= source_count:
                    continue
                if meta in skip_lookup or meta in used_indices:
                    continue
                mapped_idx = meta
                break
            if mapped_idx is None:
                while sequential_pos < len(candidate_indices):
                    candidate = candidate_indices[sequential_pos]
                    sequential_pos += 1
                    if candidate in used_indices:
                        continue
                    mapped_idx = candidate
                    break
            if mapped_idx is None:
                break
            src_text = str(getattr(blocks[mapped_idx], "prompt_text", "") or "")
            entries[mapped_idx] = {"src": src_text, "dst": dst_text}
            used_indices.add(mapped_idx)
        return entries

    @staticmethod
    def _should_apply_line_policy(
        pipeline: Dict[str, Any],
        line_policy: Optional[Any],
        chunk_type: str,
    ) -> bool:
        if not line_policy or chunk_type != "line":
            return False
        apply_flag = pipeline.get("apply_line_policy")
        if apply_flag is False:
            return False
        return True

    @staticmethod
    def _apply_protection_to_lines(
        lines: List[str],
        start: int,
        end: int,
        protector: Optional[Any],
    ) -> Tuple[List[str], Optional[Any]]:
        if not protector or start >= end:
            return lines, protector
        segment = "\n".join(lines[start:end])
        if segment:
            protected_segment = protector.protect(segment)
            protected_lines = protected_segment.split("\n")
        else:
            protected_lines = []
        if len(protected_lines) != (end - start):
            return lines, None
        merged = list(lines)
        merged[start:end] = protected_lines
        return merged, protector

    def _build_context(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
        *,
        block_end: Optional[int] = None,
    ) -> Dict[str, str]:
        before = int(context_cfg.get("before_lines") or 0)
        after = int(context_cfg.get("after_lines") or 0)
        joiner = str(context_cfg.get("joiner") or "\n")
        if before <= 0 and after <= 0:
            return {"before": "", "after": ""}
        # block_end 鏍囪瘑鍧楃殑缁撴潫琛岋紙涓嶅惈锛夛紝鐢ㄤ簬鍒嗗潡妯″紡 context
        content_end = block_end if block_end is not None else line_index + 1
        start = max(0, line_index - before)
        end = min(len(source_lines), content_end + after)
        before_lines = source_lines[start:line_index]
        after_lines = source_lines[content_end:end]
        return {
            "before": joiner.join(before_lines).strip(),
            "after": joiner.join(after_lines).strip(),
        }

    def _resolve_source_window(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
    ) -> Tuple[int, int]:
        total = int(context_cfg.get("source_lines") or 0)
        if total <= 0:
            total = 1
        start = max(0, line_index)
        end = min(len(source_lines), start + total)
        return start, end

    def _build_jsonl_source(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
    ) -> str:
        start, end = self._resolve_source_window(source_lines, line_index, context_cfg)
        rows: List[str] = []
        for idx in range(start, end):
            payload = {str(idx + 1): source_lines[idx]}
            rows.append(f"jsonline{json.dumps(payload, ensure_ascii=False)}")
        return "\n".join(rows).strip()

    def _build_jsonl_range(
        self,
        source_lines: List[str],
        start: int,
        end: int,
    ) -> str:
        if start >= end:
            return ""
        rows: List[str] = []
        for idx in range(start, end):
            payload = {str(idx + 1): source_lines[idx]}
            rows.append(f"jsonline{json.dumps(payload, ensure_ascii=False)}")
        return "\n".join(rows).strip()

    def _parse_jsonl_response(
        self,
        text: str,
        expected_line_ids: List[int],
    ) -> str:
        entries, ordered = parse_jsonl_entries(text)
        if not entries and not ordered:
            raise ParserError("JsonlParser: empty output")
        if expected_line_ids:
            missing: List[str] = []
            lines: List[str] = []
            for i, line_id in enumerate(expected_line_ids):
                key = str(line_id + 1)
                if key in entries:
                    lines.append(entries[key])
                    continue
                if i < len(ordered):
                    lines.append(ordered[i])
                    continue
                missing.append(key)
            if missing:
                raise ParserError(
                    f"JsonlParser: missing lines {','.join(missing)}"
                )
            return "\n".join(lines).strip("\n")
        if entries:
            try:
                ordered_entries = sorted(entries.items(), key=lambda item: int(item[0]))
                return "\n".join([value for _, value in ordered_entries]).strip("\n")
            except (TypeError, ValueError):
                return "\n".join(entries.values()).strip("\n")
        return "\n".join(ordered).strip("\n")

    def run(
        self,
        input_path: str,
        output_path: Optional[str] = None,
        *,
        resume: bool = False,
        save_cache: bool = True,
        cache_dir: Optional[str] = None,
        stop_flag_path: Optional[str] = None,
    ) -> str:
        resolved_stop_flag = str(stop_flag_path or "").strip()

        def stop_requested() -> bool:
            return bool(resolved_stop_flag) and os.path.exists(resolved_stop_flag)

        pipeline = self.pipeline
        run_id = self.run_id
        pipeline_id = str(pipeline.get("id") or "")
        provider_ref = str(pipeline.get("provider") or "")
        prompt_ref = str(pipeline.get("prompt") or "")
        parser_ref = str(pipeline.get("parser") or "")
        line_policy_ref = str(pipeline.get("line_policy") or "")
        chunk_policy_ref = str(pipeline.get("chunk_policy") or "")

        provider = self.providers.get_provider(provider_ref)
        stats_api_profile_id = str(
            provider.profile.get("id") or provider_ref or ""
        ).strip()
        prompt_profile = self.prompts.get_prompt(prompt_ref)
        parser = self.parsers.get_parser(parser_ref)
        line_policy = (
            self.line_policies.get_line_policy(line_policy_ref)
            if line_policy_ref
            else None
        )
        chunk_policy = self.chunk_policies.get_chunk_policy(chunk_policy_ref)
        chunk_type = str(
            chunk_policy.profile.get("chunk_type")
            or chunk_policy.profile.get("type")
            or ""
        )
        output_path = self._resolve_output_path(
            input_path,
            output_path,
            provider,
            provider_ref,
            pipeline_id,
        )
        emit_output_path(output_path)
        context_cfg = prompt_profile.get("context") or {}
        source_format = str(context_cfg.get("source_format") or "").strip().lower()
        parser_type = ""
        if parser is not None:
            parser_type = str(parser.profile.get("type") or "").strip().lower()
        if source_format == "jsonl" and chunk_type == "line":
            if parser_type and parser_type != "jsonl":
                emit_warning(
                    0,
                    "source_format=jsonl forces JSONL parsing; selected parser will be ignored.",
                    "quality",
                )
        apply_line_policy = self._should_apply_line_policy(
            pipeline, line_policy, chunk_type
        )
        failed_line_entries: List[Dict[str, Any]] = []
        _failed_line_lock = threading.Lock()

        doc = DocumentFactory.get_document(input_path)
        self._ensure_line_chunk_keeps_empty(doc, chunk_policy)
        items = doc.load()
        source_lines = self._extract_source_lines(items)
        blocks = chunk_policy.chunk(items)
        filter_blank_line_blocks = self._should_filter_blank_line_blocks(
            doc, chunk_type
        )
        blank_line_block_indices: Set[int] = set()
        if filter_blank_line_blocks and blocks:
            blank_line_block_indices = self._collect_blank_line_block_indices(blocks)

        temp_progress_path = f"{output_path}.temp.jsonl"
        resume_entries: Dict[int, Dict[str, str]] = {}
        resume_matched = False

        processing_cfg = pipeline.get("processing") or {}
        if not isinstance(processing_cfg, dict):
            processing_cfg = {}
        processing_enabled = bool(processing_cfg)
        glossary_spec = processing_cfg.get("glossary")
        if glossary_spec is None:
            glossary_spec = pipeline.get("glossary")
        glossary_text = self._load_glossary(glossary_spec)
        resolved_cache_dir = (
            cache_dir if cache_dir and os.path.isdir(cache_dir) else None
        )
        realtime_cache: Optional[TranslationCache] = (
            TranslationCache(
                output_path,
                custom_cache_dir=resolved_cache_dir,
                source_path=input_path,
            )
            if save_cache
            else None
        )
        realtime_cache_lock = threading.Lock()
        realtime_model_name = (
            str(provider.profile.get("model") or "").strip()
            or provider_ref
            or pipeline_id
            or "unknown"
        )
        realtime_glossary_path = (
            str(glossary_spec)
            if isinstance(glossary_spec, str)
            else ""
        )
        if realtime_cache and getattr(realtime_cache, "cache_path", ""):
            emit_cache_path(realtime_cache.cache_path)

        def flush_realtime_cache_locked() -> None:
            if not realtime_cache:
                return
            realtime_cache.save(
                model_name=realtime_model_name,
                glossary_path=realtime_glossary_path,
                concurrency=1,
            )

        def upsert_realtime_cache(
            idx: int,
            src_text: str,
            dst_text: str,
            *,
            warnings: Optional[List[str]] = None,
            flush: bool = True,
        ) -> None:
            if not realtime_cache:
                return
            with realtime_cache_lock:
                realtime_cache.add_block(
                    idx,
                    src_text,
                    dst_text,
                    warnings=warnings or [],
                )
                if warnings:
                    realtime_cache.update_block(
                        idx,
                        status="none",
                        warnings=warnings,
                    )
                if flush:
                    flush_realtime_cache_locked()

        settings = pipeline.get("settings") or {}
        try:
            raw_max_retries = settings.get("max_retries")
            if raw_max_retries is None or raw_max_retries == "":
                raw_max_retries = provider.profile.get("max_retries")
            if raw_max_retries is None or str(raw_max_retries).strip() == "":
                max_retries = 3
            else:
                max_retries = int(raw_max_retries)
        except (ValueError, TypeError):
            max_retries = 3
        adaptive: Optional[AdaptiveConcurrency] = None

        processing_processor = None
        pre_rules: List[Dict[str, Any]] = []
        post_rules: List[Dict[str, Any]] = []
        rules_pre_spec = processing_cfg.get("rules_pre")
        rules_post_spec = processing_cfg.get("rules_post")
        if rules_pre_spec is None:
            rules_pre_spec = pipeline.get("rules_pre")
        if rules_post_spec is None:
            rules_post_spec = pipeline.get("rules_post")
        if rules_pre_spec or rules_post_spec:
            processing_enabled = True
        source_lang = (
            str(processing_cfg.get("source_lang") or "ja").strip() or "ja"
        )
        # 默认关闭质量检查，需要在 Pipeline YAML processing.enable_quality
        # 或 CLI --enable-quality 中显式启用。
        enable_quality = processing_cfg.get("enable_quality")
        if enable_quality is None:
            enable_quality = False
        # 默认关闭文本保护，需要在 Pipeline YAML processing.text_protect
        # 或 CLI --text-protect 中显式启用。
        enable_text_protect = processing_cfg.get("text_protect")
        if enable_text_protect is None:
            enable_text_protect = False
        strict_line_count = bool(processing_cfg.get("strict_line_count"))

        if processing_enabled:
            pre_rules = self._resolve_rules(rules_pre_spec)
            post_rules = self._resolve_rules(rules_post_spec)
            post_rules = self._sanitize_post_rules_for_input(post_rules, input_path)
            protect_patterns_base = self._resolve_protect_patterns_base(input_path)
            glossary_dict = v2_processing.load_glossary(glossary_spec)
            if (
                pre_rules
                or post_rules
                or glossary_dict
                or enable_text_protect
                or enable_quality
            ):
                processing_processor = v2_processing.ProcessingProcessor(
                    v2_processing.ProcessingOptions(
                        rules_pre=pre_rules,
                        rules_post=post_rules,
                        glossary=glossary_dict,
                        source_lang=source_lang,
                        strict_line_count=strict_line_count,
                        enable_quality=bool(enable_quality),
                        enable_text_protect=bool(enable_text_protect),
                        protect_patterns_base=protect_patterns_base,
                    )
                )

        fingerprint = self._build_resume_fingerprint(
            input_path=input_path,
            pipeline_id=pipeline_id,
            chunk_type=chunk_type,
            pipeline=pipeline,
            provider_profile=dict(getattr(provider, "profile", {}) or {}),
            prompt_profile=dict(prompt_profile or {}),
            parser_profile=dict(getattr(parser, "profile", {}) or {}),
            line_policy_profile=(
                dict(getattr(line_policy, "profile", {}) or {})
                if line_policy is not None
                else None
            ),
            chunk_policy_profile=dict(getattr(chunk_policy, "profile", {}) or {}),
            settings=dict(settings or {}),
            processing_cfg=dict(processing_cfg or {}),
            pre_rules=pre_rules,
            post_rules=post_rules,
            source_format=source_format,
        )
        expected_fingerprint = {
            "input": input_path,
            "pipeline": pipeline_id,
            "chunk_type": chunk_type,
            "config_hash": fingerprint.get("config_hash"),
        }
        temp_resume_exists = os.path.exists(temp_progress_path)
        if resume:
            resume_entries, resume_matched = self._load_resume_file(
                temp_progress_path, expected=expected_fingerprint
            )
            if not resume_entries and not temp_resume_exists:
                resume_entries = self._load_resume_cache(output_path, cache_dir)
                resume_matched = False
            if not resume_entries and not temp_resume_exists:
                resume_entries = self._load_resume_output(
                    output_path,
                    blocks,
                    chunk_policy,
                    chunk_type=chunk_type,
                    skip_indices=(
                        blank_line_block_indices if filter_blank_line_blocks else None
                    ),
                )
                resume_matched = False
            if temp_resume_exists and not resume_matched:
                emit_warning(
                    0,
                    "resume_fingerprint_mismatch_skip_cache",
                    "quality",
                )

        prompt_source_lines = source_lines
        if (
            processing_processor
            and processing_processor.has_pre_rules
            and source_lines
        ):
            prompt_source_lines = [
                processing_processor.apply_pre(line) for line in source_lines
            ]

        # --- Dashboard 鏃ュ織鍗忚 ---
        temp_progress_file = None
        temp_lock = threading.Lock()
        try:
            temp_mode = "a" if resume and resume_entries and resume_matched else "w"
            temp_progress_file = open(
                temp_progress_path, temp_mode, encoding="utf-8", buffering=1
            )
            if temp_mode == "w":
                temp_progress_file.write(
                    json.dumps(fingerprint, ensure_ascii=False) + "\n"
                )
                temp_progress_file.flush()
        except Exception:
            temp_progress_file = None

        def write_temp_entry(
            idx: int,
            src_text: str,
            dst_text: str,
            *,
            warnings: Optional[List[str]] = None,
        ) -> None:
            upsert_realtime_cache(
                idx,
                src_text,
                dst_text,
                warnings=warnings,
                flush=True,
            )
            if not temp_progress_file:
                return
            payload = {
                "type": "block",
                "index": idx,
                "src": src_text,
                "dst": dst_text,
            }
            with temp_lock:
                temp_progress_file.write(
                    json.dumps(payload, ensure_ascii=False) + "\n"
                )
                temp_progress_file.flush()

        _p_profile = provider.profile if provider else {}
        _provider_url = str(_p_profile.get("url") or _p_profile.get("api_base") or _p_profile.get("base_url") or "")
        tracker_source_lines = len(source_lines)
        tracker_source_chars = sum(len(l) for l in source_lines)
        tracker_total_blocks = len(blocks)
        if filter_blank_line_blocks:
            non_empty_source_lines = [line for line in source_lines if line.strip()]
            tracker_source_lines = len(non_empty_source_lines)
            tracker_source_chars = sum(len(line) for line in non_empty_source_lines)
            tracker_total_blocks = max(0, len(blocks) - len(blank_line_block_indices))

        tracker = ProgressTracker(
            total_blocks=tracker_total_blocks,
            total_source_lines=tracker_source_lines,
            total_source_chars=tracker_source_chars,
            api_url=_provider_url if _provider_url else None,
        )
        # V2 API 模式采用后台心跳持续上报，避免仅在 block 完成时刷新导致“实时曲线卡住”。
        progress_heartbeat_stop = threading.Event()
        progress_heartbeat_thread: Optional[threading.Thread] = None

        def _progress_heartbeat() -> None:
            while not progress_heartbeat_stop.wait(0.5):
                try:
                    tracker.emit_progress_snapshot(force=False)
                except Exception:
                    # 进度上报失败不应影响主翻译流程
                    pass

        progress_heartbeat_thread = threading.Thread(
            target=_progress_heartbeat,
            name="flow-v2-progress-heartbeat",
            daemon=True,
        )
        progress_heartbeat_thread.start()
        tracker.emit_progress_snapshot(force=True)

        translated_blocks: List[Optional[TextBlock]] = [None] * len(blocks)
        if blank_line_block_indices:
            for idx in blank_line_block_indices:
                passthrough_block = blocks[idx]
                translated_blocks[idx] = TextBlock(
                    id=idx + 1,
                    prompt_text=str(getattr(passthrough_block, "prompt_text", "") or ""),
                    metadata=passthrough_block.metadata,
                )
        resume_completed = 0
        resume_output_lines = 0
        resume_output_chars = 0
        if resume_entries:
            for idx, block in enumerate(blocks):
                if translated_blocks[idx] is not None:
                    continue
                entry = resume_entries.get(idx)
                if not entry:
                    continue
                dst_text = str(entry.get("dst") or "")
                translated_blocks[idx] = TextBlock(
                    id=idx + 1,
                    prompt_text=dst_text,
                    metadata=block.metadata,
                )
                upsert_realtime_cache(
                    idx,
                    block.prompt_text,
                    dst_text,
                    flush=False,
                )
                resume_completed += 1
                if dst_text:
                    resume_output_lines += dst_text.count("\n") + 1
                    resume_output_chars += len(dst_text)
            if resume_completed > 0:
                if realtime_cache:
                    with realtime_cache_lock:
                        flush_realtime_cache_locked()
                tracker.seed_progress(
                    completed_blocks=resume_completed,
                    output_lines=resume_output_lines,
                    output_chars=resume_output_chars,
                )

        def translate_block(idx: int, block: TextBlock) -> Tuple[int, TextBlock]:
            if stop_requested():
                raise PipelineStopRequested("stop_requested")
            context_cfg = prompt_profile.get("context") or {}
            line_index = None
            if block.metadata:
                for meta in block.metadata:
                    if isinstance(meta, int):
                        line_index = meta
                        break
                        
            # 瀵逛簬鍧楁ā寮忔垨缂哄け鐪熷疄琛屽彿鐨勭粨鏋勫寲妯″紡锛屾垜浠笉鑳戒吉閫?line_index
            fallback_index = line_index if line_index is not None else idx
                
            # 分块模式的 context 以整块行范围为准，而不是仅使用首行。
            blk_start, blk_end = self._block_line_range(block)
            if blk_start == 0 and blk_end == 0:
                blk_start, blk_end = fallback_index, fallback_index + 1
            context_before = ""
            context_after = ""
            target_line_ids: List[int] = []
            active_source_lines = prompt_source_lines if prompt_source_lines else source_lines
            if active_source_lines:
                context_anchor = (
                    line_index
                    if line_index is not None
                    else max(0, min(blk_start, len(active_source_lines) - 1))
                )
                safe_block_end = blk_end if blk_end > context_anchor else context_anchor + 1
                safe_block_end = min(len(active_source_lines), safe_block_end)
                context = self._build_context(
                    active_source_lines,
                    context_anchor,
                    context_cfg,
                    block_end=safe_block_end,
                )
                context_before = context["before"]
                context_after = context["after"]

            source_text = block.prompt_text
            source_format = str(context_cfg.get("source_format") or "").strip().lower()
            use_jsonl = source_format == "jsonl" and chunk_type == "line"
            if not use_jsonl and processing_processor:
                source_text = processing_processor.apply_pre(source_text)

            protector = (
                processing_processor.create_protector()
                if processing_processor
                else None
            )
            if protector and not use_jsonl:
                source_text = protector.protect(source_text)

            if use_jsonl and active_source_lines:
                if block.metadata:
                    target_line_ids = self._filter_target_line_ids(
                        block.metadata,
                        0,
                        len(active_source_lines),
                    )
                if target_line_ids:
                    target_line_ids = sorted(set(target_line_ids))
                else:
                    safe_fallback = min(
                        max(fallback_index, 0),
                        len(active_source_lines) - 1,
                    )
                    target_line_ids = [safe_fallback]

                start = max(0, min(target_line_ids))
                end = min(len(active_source_lines), max(target_line_ids) + 1)
                before_count = max(0, int(context_cfg.get("before_lines") or 0))
                after_count = max(0, int(context_cfg.get("after_lines") or 0))
                before_start = max(0, start - before_count)
                after_end = min(len(active_source_lines), end + after_count)
                context_before = self._build_jsonl_range(
                    active_source_lines, before_start, start
                )
                context_after = self._build_jsonl_range(
                    active_source_lines, end, after_end
                )
                protected_lines, protector = self._apply_protection_to_lines(
                    active_source_lines, start, end, protector
                )
                source_text = self._build_jsonl_range(protected_lines, start, end)

            messages = build_messages(
                prompt_profile,
                source_text=source_text,
                context_before=context_before,
                context_after=context_after,
                glossary_text=glossary_text,
                line_index=line_index,
            )

            def fallback_to_source(
                error_message: Optional[str],
                error_type: str,
                *,
                warning_message: str,
                status_code: Optional[int] = None,
            ) -> Tuple[int, TextBlock]:
                blk_start, _ = self._block_line_range(block)
                fallback_line = (
                    line_index + 1
                    if line_index is not None and line_index < len(source_lines)
                    else blk_start + 1
                    if source_lines and 0 <= blk_start < len(source_lines)
                    else None
                )
                fallback_text = self._build_block_fallback_text(
                    source_lines,
                    block,
                    line_index=line_index,
                    target_line_ids=target_line_ids,
                )
                with _failed_line_lock:
                    failed_line_entries.append(
                        {
                            "index": idx,
                            "line": fallback_line,
                            "error": error_message or "",
                            "type": error_type,
                            "status": "untranslated_fallback",
                        }
                    )
                try:
                    emit_warning(
                        idx + 1,
                        warning_message,
                        "untranslated_fallback",
                        line=fallback_line,
                    )
                except Exception:
                    pass
                tracker.note_error(status_code)
                write_temp_entry(
                    idx,
                    block.prompt_text,
                    fallback_text,
                    warnings=["untranslated_fallback"],
                )
                return idx, TextBlock(
                    id=idx + 1,
                    prompt_text=fallback_text,
                    metadata=block.metadata,
                )

            attempt = 0
            last_error: Optional[str] = None
            while attempt <= max_retries:
                if stop_requested():
                    raise PipelineStopRequested("stop_requested")
                current_request_id: Optional[str] = None
                current_request_meta: Dict[str, Any] = {}
                current_endpoint_id: Optional[str] = None
                current_endpoint_label: Optional[str] = None
                current_model: Optional[str] = None
                current_request_payload: Dict[str, Any] = {}
                current_request_headers: Dict[str, str] | None = None
                current_request_url: Optional[str] = None
                attempt_no = attempt + 1
                common_event_meta = {
                    "blockIndex": idx,
                    "lineIndex": line_index,
                    "chunkType": chunk_type,
                    "sourceFormat": source_format or "plain",
                    "parserType": parser_type or "",
                    "providerRef": provider_ref,
                    "providerType": str(
                        provider.profile.get("type")
                        or provider.profile.get("provider")
                        or "openai_compat"
                    ),
                }
                try:
                    request_settings = dict(settings or {})
                    request_settings["_stats"] = {
                        "run_id": run_id,
                        "pipeline_id": pipeline_id,
                        "api_profile_id": stats_api_profile_id,
                        "block_index": idx,
                        "line_index": line_index,
                        "attempt": attempt_no,
                        "source": "translation_run",
                    }
                    request = provider.build_request(messages, request_settings)
                    request_meta_raw = getattr(request, "meta", None)
                    current_request_meta = (
                        dict(request_meta_raw)
                        if isinstance(request_meta_raw, dict)
                        else {}
                    )
                    current_request_id = str(
                        getattr(request, "request_id", None)
                        or current_request_meta.get("request_id")
                        or generate_request_id()
                    ).strip() or generate_request_id()
                    try:
                        setattr(request, "request_id", current_request_id)
                    except Exception:
                        pass
                    current_endpoint_id = str(
                        current_request_meta.get("endpoint_id")
                        or getattr(request, "provider_id", None)
                        or ""
                    ).strip() or None
                    current_endpoint_label = (
                        str(current_request_meta.get("endpoint_label") or "").strip()
                        or None
                    )
                    current_model = str(getattr(request, "model", "") or "").strip() or None
                    current_request_payload = {
                        "model": getattr(request, "model", None),
                        "messages": getattr(request, "messages", None),
                        "temperature": getattr(request, "temperature", None),
                        "max_tokens": getattr(request, "max_tokens", None),
                        "extra": getattr(request, "extra", None),
                    }
                    request_headers_raw = getattr(request, "headers", None)
                    current_request_headers = (
                        {str(k): str(v) for k, v in request_headers_raw.items()}
                        if isinstance(request_headers_raw, dict)
                        else None
                    )
                    current_request_url = (
                        str(provider.profile.get("base_url") or "").strip() or None
                    )

                    self._emit_api_stats_safe(
                        {
                            "phase": "request_start",
                            "requestId": current_request_id,
                            "apiProfileId": stats_api_profile_id,
                            "source": "translation_run",
                            "origin": "pipeline_v2_runner",
                            "runId": run_id or None,
                            "pipelineId": pipeline_id or None,
                            "endpointId": current_endpoint_id,
                            "endpointLabel": current_endpoint_label,
                            "model": current_model,
                            "method": "POST",
                            "url": current_request_url,
                            "requestPayload": current_request_payload,
                            "requestHeaders": current_request_headers,
                            "meta": {
                                **common_event_meta,
                                **current_request_meta,
                                "attempt": attempt_no,
                            },
                        }
                    )

                    _t0 = time.perf_counter()
                    response = provider.send(request)
                    _ping_ms = int((time.perf_counter() - _t0) * 1000)
                    if response.duration_ms is not None and response.duration_ms > 0:
                        _ping_ms = int(response.duration_ms)

                    raw_dict = response.raw if isinstance(response.raw, dict) else {}
                    raw_data = raw_dict.get("data")
                    raw_usage = raw_dict.get("usage")
                    if not isinstance(raw_usage, dict):
                        raw_usage = (
                            raw_data.get("usage")
                            if isinstance(raw_data, dict)
                            else {}
                        )
                    _usage = raw_usage if isinstance(raw_usage, dict) else {}
                    _input_tokens = int(_usage.get("prompt_tokens", 0) or 0)
                    _output_tokens = int(_usage.get("completion_tokens", 0) or 0)
                    tracker.note_request(
                        input_tokens=_input_tokens,
                        output_tokens=_output_tokens,
                        ping=_ping_ms,
                    )

                    status_code: Optional[int] = response.status_code
                    if status_code is None:
                        raw_status: Any = raw_dict.get("status_code")
                        if (
                            raw_status is None
                            and isinstance(raw_dict.get("response"), dict)
                        ):
                            raw_status = raw_dict.get("response", {}).get(
                                "status_code"
                            )
                        try:
                            status_code = (
                                int(raw_status) if raw_status is not None else None
                            )
                        except (TypeError, ValueError):
                            status_code = None

                    raw_request = (
                        raw_dict.get("request")
                        if isinstance(raw_dict.get("request"), dict)
                        else {}
                    )
                    raw_response = (
                        raw_dict.get("response")
                        if isinstance(raw_dict.get("response"), dict)
                        else {}
                    )
                    request_headers_for_event = response.request_headers
                    if request_headers_for_event is None:
                        request_headers_for_event = (
                            raw_request.get("headers")
                            if isinstance(raw_request.get("headers"), dict)
                            else current_request_headers
                        )
                    response_headers_for_event = response.response_headers
                    if response_headers_for_event is None:
                        response_headers_for_event = (
                            raw_response.get("headers")
                            if isinstance(raw_response.get("headers"), dict)
                            else None
                        )
                    response_url = (
                        response.url
                        or str(raw_request.get("url") or "").strip()
                        or current_request_url
                    )
                    response_payload = raw_data if raw_data is not None else response.raw

                    self._emit_api_stats_safe(
                        {
                            "phase": "request_end",
                            "requestId": current_request_id,
                            "apiProfileId": stats_api_profile_id,
                            "source": "translation_run",
                            "origin": "pipeline_v2_runner",
                            "runId": run_id or None,
                            "pipelineId": pipeline_id or None,
                            "endpointId": current_endpoint_id,
                            "endpointLabel": current_endpoint_label,
                            "model": current_model,
                            "method": "POST",
                            "url": response_url,
                            "statusCode": status_code,
                            "durationMs": _ping_ms,
                            "inputTokens": _input_tokens,
                            "outputTokens": _output_tokens,
                            "requestPayload": current_request_payload,
                            "responsePayload": response_payload,
                            "requestHeaders": request_headers_for_event,
                            "responseHeaders": response_headers_for_event,
                            "meta": {
                                **common_event_meta,
                                **current_request_meta,
                                "attempt": attempt_no,
                                "providerId": getattr(request, "provider_id", None),
                            },
                        }
                    )

                    if use_jsonl and target_line_ids:
                        translated = self._parse_jsonl_response(
                            response.text, target_line_ids
                        )
                    else:
                        parsed = parser.parse(response.text)
                        translated = parsed.text.strip("\n")
                    if processing_processor:
                        translated = processing_processor.apply_post(
                            translated,
                            src_text=block.prompt_text,
                            protector=protector,
                        )
                    if (
                        apply_line_policy
                        and line_policy
                        and line_index is not None
                        and line_index < len(source_lines)
                    ):
                        compat_line = extract_line_for_policy(translated, line_index)
                        if compat_line is not None:
                            translated = compat_line
                        if "\n" in translated:
                            raise LinePolicyError("LinePolicy: line count mismatch")
                        checked = line_policy.apply(
                            [source_lines[line_index]],
                            [translated],
                        )
                        if not checked:
                            raise LinePolicyError("LinePolicy: empty output")
                        if len(checked) != 1:
                            raise LinePolicyError(
                                "LinePolicy: unexpected line count"
                            )
                        translated = checked[0]
                    write_temp_entry(idx, block.prompt_text, translated)
                    return idx, TextBlock(
                        id=idx + 1,
                        prompt_text=translated,
                        metadata=block.metadata,
                    )
                except PipelineStopRequested:
                    raise
                except (ProviderError, ParserError, LinePolicyError) as exc:
                    last_error = str(exc)
                    if adaptive is not None and isinstance(exc, ProviderError):
                        adaptive.note_error(last_error)
                    error_type = (
                        "line_mismatch" if isinstance(exc, LinePolicyError)
                        else "empty" if isinstance(exc, ParserError)
                        else "provider_error"
                    )
                    _status_code = None
                    _duration_ms: Optional[int] = None
                    _provider_error_type = error_type
                    if isinstance(exc, ProviderError):
                        _status_code = exc.status_code
                        _duration_ms = exc.duration_ms
                        _provider_error_type = exc.error_type or error_type
                        if _status_code is None:
                            import re as _re

                            _m = _re.search(r"HTTP (\d{3})", str(exc))
                            if _m:
                                _status_code = int(_m.group(1))

                        self._emit_api_stats_safe(
                            {
                                "phase": "request_error",
                                "requestId": current_request_id or generate_request_id(),
                                "apiProfileId": stats_api_profile_id,
                                "source": "translation_run",
                                "origin": "pipeline_v2_runner",
                                "runId": run_id or None,
                                "pipelineId": pipeline_id or None,
                                "endpointId": current_endpoint_id,
                                "endpointLabel": current_endpoint_label,
                                "model": current_model,
                                "method": "POST",
                                "url": exc.url or current_request_url,
                                "statusCode": _status_code,
                                "durationMs": _duration_ms,
                                "errorType": _provider_error_type,
                                "errorMessage": str(exc),
                                "requestPayload": current_request_payload,
                                "requestHeaders": current_request_headers,
                                "meta": {
                                    **common_event_meta,
                                    **current_request_meta,
                                    "attempt": attempt_no,
                                },
                            }
                        )

                    attempt += 1
                    tracker.note_retry(_status_code)
                    emit_retry(idx + 1, attempt, error_type)
                    if attempt <= max_retries:
                        self._emit_api_stats_safe(
                            {
                                "phase": "request_retry",
                                "requestId": current_request_id or generate_request_id(),
                                "apiProfileId": stats_api_profile_id,
                                "source": "translation_run",
                                "origin": "pipeline_v2_runner",
                                "runId": run_id or None,
                                "pipelineId": pipeline_id or None,
                                "endpointId": current_endpoint_id,
                                "endpointLabel": current_endpoint_label,
                                "model": current_model,
                                "method": "POST",
                                "url": current_request_url,
                                "statusCode": _status_code,
                                "durationMs": _duration_ms,
                                "retryAttempt": attempt,
                                "errorType": _provider_error_type,
                                "errorMessage": last_error,
                                "meta": {
                                    **common_event_meta,
                                    **current_request_meta,
                                    "attempt": attempt_no,
                                },
                            }
                        )
                    if attempt > max_retries:
                        return fallback_to_source(
                            last_error,
                            error_type,
                            warning_message="fallback_to_source_after_max_retries",
                            status_code=_status_code,
                        )
                except Exception as exc:
                    unexpected_error = f"{type(exc).__name__}: {exc}"
                    return fallback_to_source(
                        unexpected_error,
                        "unknown_error",
                        warning_message="fallback_to_source_unexpected_error",
                    )
            if last_error:
                return fallback_to_source(
                    last_error,
                    "unknown_error",
                    warning_message="fallback_to_source_unknown_error",
                )
            return fallback_to_source(
                "unknown_error",
                "unknown_error",
                warning_message="fallback_to_source_unknown_error",
            )
        try:
            raw_concurrency = settings.get("concurrency")
            if raw_concurrency is None or raw_concurrency == "":
                raw_concurrency = provider.profile.get("concurrency")
            if raw_concurrency is None or raw_concurrency == "":
                concurrency = 1
            else:
                concurrency = int(raw_concurrency)
        except (TypeError, ValueError):
            concurrency = 1

        if concurrency == 0:
            adaptive = AdaptiveConcurrency(max_limit=max(1, min(len(blocks), 128)))
        else:
            concurrency = max(1, min(concurrency, MAX_CONCURRENCY))

        pending_indices = [
            idx for idx, block in enumerate(blocks) if translated_blocks[idx] is None
        ]

        stop_triggered = False
        try:
            try:
                if stop_requested():
                    raise PipelineStopRequested("stop_requested")
                if adaptive is not None and len(pending_indices) > 1:
                    with ThreadPoolExecutor(max_workers=adaptive.max_limit) as executor:
                        next_pos = 0
                        futures: Dict[Any, int] = {}
                        while next_pos < len(pending_indices) or futures:
                            if stop_requested():
                                for pending in futures:
                                    pending.cancel()
                                raise PipelineStopRequested("stop_requested")
                            limit = adaptive.get_limit()
                            tracker.current_concurrency = limit
                            while next_pos < len(pending_indices) and len(futures) < limit:
                                if stop_requested():
                                    break
                                idx = pending_indices[next_pos]
                                futures[executor.submit(translate_block, idx, blocks[idx])] = idx
                                next_pos += 1
                            if not futures:
                                continue
                            for future in as_completed(futures):
                                idx = futures.pop(future)
                                try:
                                    _, translated_block = future.result()
                                    translated_blocks[idx] = translated_block
                                    adaptive.note_success()
                                    valid_meta = [m for m in (blocks[idx].metadata or []) if isinstance(m, int)]
                                    lines_done = len(valid_meta) if valid_meta else None
                                    tracker.block_done(
                                        idx, blocks[idx].prompt_text, translated_block.prompt_text,
                                        lines_done=lines_done
                                    )
                                except PipelineStopRequested:
                                    for pending in futures:
                                        pending.cancel()
                                    raise
                                except Exception:
                                    for pending in futures:
                                        pending.cancel()
                                    raise
                                if stop_requested():
                                    for pending in futures:
                                        pending.cancel()
                                    raise PipelineStopRequested("stop_requested")
                                break
                elif pending_indices:
                    tracker.current_concurrency = concurrency
                    if concurrency <= 1 or len(pending_indices) <= 1:
                        for idx in pending_indices:
                            if stop_requested():
                                raise PipelineStopRequested("stop_requested")
                            _, translated_block = translate_block(idx, blocks[idx])
                            translated_blocks[idx] = translated_block
                            valid_meta = [m for m in (blocks[idx].metadata or []) if isinstance(m, int)]
                            lines_done = len(valid_meta) if valid_meta else None
                            tracker.block_done(
                                idx, blocks[idx].prompt_text, translated_block.prompt_text,
                                lines_done=lines_done
                            )
                    else:
                        with ThreadPoolExecutor(max_workers=concurrency) as executor:
                            next_pos = 0
                            futures: Dict[Any, int] = {}
                            while next_pos < len(pending_indices) or futures:
                                if stop_requested():
                                    for pending in futures:
                                        pending.cancel()
                                    break
                                while next_pos < len(pending_indices) and len(futures) < concurrency:
                                    if stop_requested():
                                        break
                                    idx = pending_indices[next_pos]
                                    futures[executor.submit(translate_block, idx, blocks[idx])] = idx
                                    next_pos += 1
                                if not futures:
                                    continue
                                for future in as_completed(futures):
                                    idx = futures.pop(future)
                                    try:
                                        _ , translated_block = future.result()
                                        translated_blocks[idx] = translated_block
                                        valid_meta = [m for m in (blocks[idx].metadata or []) if isinstance(m, int)]
                                        lines_done = len(valid_meta) if valid_meta else None
                                        tracker.block_done(
                                            idx, blocks[idx].prompt_text, translated_block.prompt_text,
                                            lines_done=lines_done
                                        )
                                    except PipelineStopRequested:
                                        for pending in futures:
                                            pending.cancel()
                                        raise
                                    except Exception:
                                        for pending in futures:
                                            pending.cancel()
                                        raise
                                    if stop_requested():
                                        for pending in futures:
                                            pending.cancel()
                                        raise PipelineStopRequested("stop_requested")
                                    break
            except PipelineStopRequested:
                stop_triggered = True
        finally:
            progress_heartbeat_stop.set()
            if progress_heartbeat_thread and progress_heartbeat_thread.is_alive():
                try:
                    progress_heartbeat_thread.join(timeout=1.0)
                except Exception:
                    pass
            if temp_progress_file:
                try:
                    temp_progress_file.close()
                except Exception:
                    pass
            if realtime_cache:
                try:
                    with realtime_cache_lock:
                        flush_realtime_cache_locked()
                except Exception:
                    pass

        if stop_triggered or stop_requested():
            temp_resume_entries, _ = self._load_resume_file(temp_progress_path)
            if temp_resume_entries:
                for idx, entry in temp_resume_entries.items():
                    if idx < 0 or idx >= len(translated_blocks):
                        continue
                    if translated_blocks[idx] is not None:
                        continue
                    translated_blocks[idx] = TextBlock(
                        id=idx + 1,
                        prompt_text=str(entry.get("dst") or ""),
                        metadata=blocks[idx].metadata,
                    )
            interrupted_separator = (
                "\n\n"
                if (
                    chunk_type == "chunk"
                    or self._should_use_double_newline_separator(post_rules)
                )
                else "\n"
            )
            preview_path = self._write_interrupted_preview(
                output_path,
                translated_blocks,
                separator=interrupted_separator,
                skip_indices=(
                    blank_line_block_indices if filter_blank_line_blocks else None
                ),
            )
            if preview_path:
                print(f"[FlowV2] Partial translation preview saved to: {preview_path}")
            raise PipelineStopRequested("stop_requested")

        if any(block is None for block in translated_blocks):
            raise RuntimeError("translation_incomplete")

        translated_blocks = [block for block in translated_blocks if block is not None]

        if processing_processor and processing_processor.options.enable_quality:
            output_lines = self._collect_quality_output_lines(translated_blocks)
            if source_lines:
                warnings = processing_processor.check_quality(
                    source_lines, output_lines
                )
                if warnings:
                    warn_path = f"{output_path}.quality_warnings.jsonl"
                    try:
                        with open(warn_path, "w", encoding="utf-8") as f:
                            for entry in warnings:
                                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                        print(
                            f"[QualityCheck] {len(warnings)} warnings. Saved to {warn_path}"
                        )
                    except Exception:
                        pass
                    for entry in warnings:
                        try:
                            warning_line = int(entry.get("line", 0) or 0)
                            warning_block = self._resolve_warning_block(
                                blocks,
                                warning_line,
                            )
                            emit_warning(
                                warning_block,
                                str(entry.get("message", "")),
                                str(entry.get("type", "quality") or "quality"),
                                line=warning_line if warning_line > 0 else None,
                            )
                        except Exception:
                            continue

        if failed_line_entries:
            error_path = f"{output_path}.line_errors.jsonl"
            try:
                with open(error_path, "w", encoding="utf-8") as f:
                    for entry in failed_line_entries:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                print(
                    f"[LineFallback] {len(failed_line_entries)} lines fell back to source text. Saved to {error_path}"
                )
            except Exception:
                pass

        if isinstance(doc, TxtDocument):
            self._normalize_txt_blocks(translated_blocks)
            separator = (
                "\n\n"
                if (
                    chunk_type == "chunk"
                    or self._should_use_double_newline_separator(post_rules)
                )
                else "\n"
            )
            self._save_txt_blocks(
                output_path,
                translated_blocks,
                separator=separator,
                skip_blank_indices=(
                    blank_line_block_indices if filter_blank_line_blocks else None
                ),
            )
        else:
            doc.save(output_path, translated_blocks)

        if save_cache:
            resolved_cache_dir = (
                cache_dir if cache_dir and os.path.isdir(cache_dir) else None
            )
            fallback_indices = {
                int(entry.get("index"))
                for entry in failed_line_entries
                if entry.get("status") == "untranslated_fallback"
                and entry.get("index") is not None
            }
            translation_cache = TranslationCache(
                output_path,
                custom_cache_dir=resolved_cache_dir,
                source_path=input_path,
            )
            for idx, block in enumerate(blocks):
                translated_block = translated_blocks[idx]
                if translated_block is None:
                    continue
                warnings = (
                    ["untranslated_fallback"] if idx in fallback_indices else None
                )
                translation_cache.add_block(
                    idx,
                    block.prompt_text,
                    translated_block.prompt_text,
                    warnings=warnings,
                )
                if idx in fallback_indices:
                    translation_cache.update_block(
                        idx,
                        status="none",
                        warnings=["untranslated_fallback"],
                    )
            provider_model = str(provider.profile.get("model") or "").strip()
            model_name = (
                provider_model or provider_ref or pipeline_id or "unknown"
            )
            glossary_path = (
                glossary_spec if isinstance(glossary_spec, str) else ""
            )
            translation_cache.save(
                model_name=model_name,
                glossary_path=glossary_path,
                concurrency=concurrency,
                engine_mode="v2",
                chunk_type=chunk_type,
                pipeline_id=pipeline_id,
            )
            if hasattr(translation_cache, 'cache_path') and translation_cache.cache_path:
                emit_cache_path(translation_cache.cache_path)

        tracker.emit_final_stats()
        try:
            if os.path.exists(temp_progress_path):
                os.remove(temp_progress_path)
        except Exception:
            pass
        return output_path
