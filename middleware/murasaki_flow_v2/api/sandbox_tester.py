"""Sandbox tester for Pipeline V2.

Runs a single input through the same critical stages as the runtime pipeline:
pre-process -> provider -> parser -> post-process -> optional line policy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import json
import os

from murasaki_flow_v2.parsers.registry import ParserRegistry
from murasaki_flow_v2.policies.line_policy import LinePolicyError
from murasaki_flow_v2.policies.registry import PolicyRegistry
from murasaki_flow_v2.prompts.builder import build_messages
from murasaki_flow_v2.prompts.registry import PromptRegistry
from murasaki_flow_v2.providers.registry import ProviderRegistry
from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.utils import processing as v2_processing
from murasaki_flow_v2.utils.line_format import parse_jsonl_entries
from murasaki_translator.core.chunker import TextBlock


@dataclass
class SandboxResult:
    ok: bool
    source_text: str
    pre_processed: str = ""
    raw_request: str = ""
    raw_response: str = ""
    parsed_result: str = ""
    post_processed: str = ""
    pre_traces: Optional[List[Dict[str, Any]]] = None
    post_traces: Optional[List[Dict[str, Any]]] = None
    pre_rules_count: int = 0
    post_rules_count: int = 0
    error: str = ""


class SandboxTester:
    def __init__(self, store: ProfileStore):
        self.store = store
        self.providers = ProviderRegistry(store)
        self.prompts = PromptRegistry(store)
        self.parsers = ParserRegistry(store)
        self.line_policies = PolicyRegistry(store)

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
            resolved: List[Dict[str, Any]] = []
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
                        continue
            return resolved
        return []

    @staticmethod
    def _normalize_chunk_type(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw == "legacy":
            return "block"
        if raw in {"line", "block"}:
            return raw
        return ""

    def _resolve_chunk_type(self, pipeline_config: Dict[str, Any]) -> str:
        explicit = self._normalize_chunk_type(
            pipeline_config.get("chunk_type") or pipeline_config.get("chunkType")
        )
        if explicit:
            return explicit

        chunk_ref = str(pipeline_config.get("chunk_policy") or "").strip()
        if chunk_ref:
            try:
                chunk_profile = self.store.load_profile("chunk", chunk_ref)
                from_profile = self._normalize_chunk_type(
                    chunk_profile.get("chunk_type") or chunk_profile.get("type")
                )
                if from_profile:
                    return from_profile
            except Exception:
                pass

        if pipeline_config.get("line_policy"):
            return "line"
        return "block"

    @staticmethod
    def _should_apply_line_policy(
        pipeline_config: Dict[str, Any],
        line_policy: Optional[Any],
        chunk_type: str,
    ) -> bool:
        if not line_policy or chunk_type != "line":
            return False
        if pipeline_config.get("apply_line_policy") is False:
            return False
        return True

    @staticmethod
    def _build_jsonline_payload(text: str) -> str:
        lines = text.splitlines()
        if not lines:
            lines = [text]
        payload = {str(idx + 1): value for idx, value in enumerate(lines)}
        return f"jsonline{json.dumps(payload, ensure_ascii=False)}"

    @staticmethod
    def _extract_jsonl_text(raw_response: str, fallback_text: str) -> str:
        entries, ordered = parse_jsonl_entries(raw_response)
        if entries:
            try:
                ordered_pairs = sorted(entries.items(), key=lambda item: int(item[0]))
                return "\n".join(str(value) for _, value in ordered_pairs)
            except (TypeError, ValueError):
                return "\n".join(str(value) for value in entries.values())
        if ordered:
            return "\n".join(str(value) for value in ordered)
        return fallback_text

    def run_test(
        self,
        text: str,
        pipeline_config: Dict[str, Any],
    ) -> SandboxResult:
        """Run a single text input through the provided pipeline config."""
        from murasaki_translator.core.text_protector import TextProtector

        source_text = str(text or "")
        provider_ref = str(pipeline_config.get("provider") or "").strip()
        prompt_ref = str(pipeline_config.get("prompt") or "").strip()
        parser_ref = str(pipeline_config.get("parser") or "").strip()
        line_policy_ref = str(pipeline_config.get("line_policy") or "").strip()

        if not provider_ref:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                error="Missing provider config.",
            )
        if not prompt_ref:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                error="Missing prompt config.",
            )
        if not parser_ref:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                error="Missing parser config.",
            )

        try:
            provider = self.providers.get_provider(provider_ref)
        except Exception:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                error=f"Provider '{provider_ref}' not found.",
            )
        try:
            prompt = self.prompts.get_prompt(prompt_ref)
        except Exception:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                error=f"Prompt '{prompt_ref}' not found.",
            )
        try:
            parser = self.parsers.get_parser(parser_ref)
        except Exception:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                error=f"Parser '{parser_ref}' not found.",
            )

        line_policy = None
        if line_policy_ref:
            try:
                line_policy = self.line_policies.get_line_policy(line_policy_ref)
            except Exception:
                return SandboxResult(
                    ok=False,
                    source_text=source_text,
                    error=f"Line policy '{line_policy_ref}' not found.",
                )

        chunk_type = self._resolve_chunk_type(pipeline_config)
        apply_line_policy = self._should_apply_line_policy(
            pipeline_config,
            line_policy,
            chunk_type,
        )

        processing_cfg = pipeline_config.get("processing") or {}
        if not isinstance(processing_cfg, dict):
            processing_cfg = {}
        resolved_pre_rules = self._resolve_rules(processing_cfg.get("rules_pre"))
        resolved_post_rules = self._resolve_rules(processing_cfg.get("rules_post"))
        proc_options = v2_processing.ProcessingOptions(
            rules_pre=resolved_pre_rules,
            rules_post=resolved_post_rules,
            glossary=v2_processing.load_glossary(processing_cfg.get("glossary")),
            source_lang=str(processing_cfg.get("source_lang") or "ja"),
            enable_text_protect=bool(processing_cfg.get("text_protect", True)),
        )
        processor = v2_processing.ProcessingProcessor(proc_options)
        protector: Optional[TextProtector] = processor.create_protector()

        pre_traces: List[Dict[str, Any]] = []
        post_traces: List[Dict[str, Any]] = []
        pre_processed = ""
        raw_request = ""
        raw_response = ""
        parsed_result = ""
        post_processed = ""

        try:
            pre_processed = processor.apply_pre(source_text, traces=pre_traces)
            if protector:
                pre_processed = protector.protect(pre_processed)

            context_cfg = prompt.get("context") or {}
            source_format = str(context_cfg.get("source_format") or "auto").strip().lower()
            use_jsonl = source_format == "jsonl" and chunk_type == "line"
            text_to_translate = (
                self._build_jsonline_payload(pre_processed)
                if use_jsonl
                else pre_processed
            )

            block = TextBlock(id=1, prompt_text=text_to_translate)
            glossary_text = "\n".join(
                [f"{k}: {v}" for k, v in proc_options.glossary.items()]
            )
            messages = build_messages(
                prompt,
                source_text=block.prompt_text,
                context_before="",
                context_after="",
                glossary_text=glossary_text,
                line_index=None,
            )

            settings = pipeline_config.get("settings") or {}
            request = provider.build_request(messages, settings)
            try:
                req_dict: Dict[str, Any] = {
                    "model": request.model,
                    "messages": request.messages,
                }
                if request.extra:
                    req_dict.update(request.extra)
                if request.temperature is not None:
                    req_dict["temperature"] = request.temperature
                if request.max_tokens is not None:
                    req_dict["max_tokens"] = request.max_tokens
                raw_request = json.dumps(req_dict, ensure_ascii=False, indent=2)
            except Exception:
                raw_request = str(request)

            response = provider.send(request)
            raw_response = response.text

            parsed = parser.parse(raw_response)
            parsed_result = parsed.text.strip("\n")
            if source_format == "jsonl":
                parsed_result = self._extract_jsonl_text(raw_response, parsed_result)

            post_processed = processor.apply_post(
                parsed_result,
                src_text=source_text,
                protector=protector,
                traces=post_traces,
            )

            if apply_line_policy and line_policy:
                source_lines = source_text.splitlines() or [source_text]
                output_lines = post_processed.splitlines()
                checked = line_policy.apply(source_lines, output_lines)
                post_processed = "\n".join(checked)

            return SandboxResult(
                ok=True,
                source_text=source_text,
                pre_processed=pre_processed,
                raw_request=raw_request,
                raw_response=raw_response,
                parsed_result=parsed_result,
                post_processed=post_processed,
                pre_traces=pre_traces,
                post_traces=post_traces,
                pre_rules_count=len(proc_options.rules_pre),
                post_rules_count=len(proc_options.rules_post),
            )
        except LinePolicyError as exc:
            return SandboxResult(
                ok=False,
                source_text=source_text,
                pre_processed=pre_processed,
                raw_request=raw_request,
                raw_response=raw_response,
                parsed_result=parsed_result,
                post_processed=post_processed,
                pre_traces=pre_traces,
                post_traces=post_traces,
                pre_rules_count=len(proc_options.rules_pre),
                post_rules_count=len(proc_options.rules_post),
                error=f"LinePolicy Error: {exc}",
            )
        except Exception as exc:
            stage = "Sandbox Execution Error"
            if not raw_response:
                stage = "Provider Error"
            elif not parsed_result and raw_response:
                stage = "Parser Error"
            elif not post_processed and parsed_result:
                stage = "Post-process Error"
            return SandboxResult(
                ok=False,
                source_text=source_text,
                pre_processed=pre_processed,
                raw_request=raw_request,
                raw_response=raw_response,
                parsed_result=parsed_result,
                post_processed=post_processed,
                pre_traces=pre_traces,
                post_traces=post_traces,
                pre_rules_count=len(proc_options.rules_pre),
                post_rules_count=len(proc_options.rules_post),
                error=f"{stage}: {exc}",
            )
