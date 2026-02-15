"""Pipeline V2 runner."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import json
import os

from murasaki_translator.documents.factory import DocumentFactory
from murasaki_translator.core.chunker import TextBlock

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.providers.registry import ProviderRegistry
from murasaki_flow_v2.parsers.registry import ParserRegistry
from murasaki_flow_v2.prompts.registry import PromptRegistry
from murasaki_flow_v2.prompts.builder import build_messages
from murasaki_flow_v2.policies.registry import PolicyRegistry
from murasaki_flow_v2.policies.chunk_registry import ChunkPolicyRegistry
from murasaki_flow_v2.policies.line_policy import LinePolicyError
from murasaki_flow_v2.parsers.base import ParserError
from murasaki_flow_v2.providers.base import ProviderError


class PipelineRunner:
    def __init__(self, store: ProfileStore, pipeline_profile: Dict[str, Any]):
        self.store = store
        self.pipeline = pipeline_profile
        self.providers = ProviderRegistry(store)
        self.parsers = ParserRegistry(store)
        self.prompts = PromptRegistry(store)
        self.line_policies = PolicyRegistry(store)
        self.chunk_policies = ChunkPolicyRegistry(store)

    def _load_glossary(self, glossary_path: Optional[str]) -> str:
        if not glossary_path:
            return ""
        if not os.path.exists(glossary_path):
            return ""
        try:
            with open(glossary_path, "r", encoding="utf-8") as f:
                raw = f.read()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                return raw.strip()
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
            return raw.strip()
        except Exception:
            return ""

    def _extract_source_lines(self, items: List[Dict[str, Any]]) -> List[str]:
        lines: List[str] = []
        for item in items:
            text = str(item.get("text") or "")
            lines.append(text.rstrip("\n"))
        return lines

    def _build_context(
        self,
        source_lines: List[str],
        line_index: int,
        context_cfg: Dict[str, Any],
    ) -> Dict[str, str]:
        before = int(context_cfg.get("before_lines") or 0)
        after = int(context_cfg.get("after_lines") or 0)
        joiner = str(context_cfg.get("joiner") or "\n")
        if before <= 0 and after <= 0:
            return {"before": "", "after": ""}
        start = max(0, line_index - before)
        end = min(len(source_lines), line_index + after + 1)
        before_lines = source_lines[start:line_index]
        after_lines = source_lines[line_index + 1 : end]
        return {
            "before": joiner.join(before_lines).strip(),
            "after": joiner.join(after_lines).strip(),
        }

    def run(self, input_path: str, output_path: Optional[str] = None) -> str:
        pipeline = self.pipeline
        provider_ref = str(pipeline.get("provider") or "")
        prompt_ref = str(pipeline.get("prompt") or "")
        parser_ref = str(pipeline.get("parser") or "")
        line_policy_ref = str(pipeline.get("line_policy") or "")
        chunk_policy_ref = str(pipeline.get("chunk_policy") or "")

        provider = self.providers.get_provider(provider_ref)
        prompt_profile = self.prompts.get_prompt(prompt_ref)
        parser = self.parsers.get_parser(parser_ref)
        line_policy = (
            self.line_policies.get_line_policy(line_policy_ref)
            if line_policy_ref
            else None
        )
        chunk_policy = self.chunk_policies.get_chunk_policy(chunk_policy_ref)

        doc = DocumentFactory.get_document(input_path)
        items = doc.load()
        source_lines = self._extract_source_lines(items)
        blocks = chunk_policy.chunk(items)

        glossary_text = self._load_glossary(pipeline.get("glossary"))

        settings = pipeline.get("settings") or {}
        max_retries = int(settings.get("max_retries") or 0)

        translated_blocks: List[TextBlock] = []

        for block in blocks:
            context_cfg = prompt_profile.get("context") or {}
            line_index = None
            if block.metadata:
                meta = block.metadata[0]
                if isinstance(meta, int):
                    line_index = meta
            context_before = ""
            context_after = ""
            if line_index is not None and source_lines:
                context = self._build_context(source_lines, line_index, context_cfg)
                context_before = context["before"]
                context_after = context["after"]

            messages = build_messages(
                prompt_profile,
                source_text=block.prompt_text,
                context_before=context_before,
                context_after=context_after,
                glossary_text=glossary_text,
                line_index=line_index,
            )

            attempt = 0
            last_error: Optional[str] = None
            while attempt <= max_retries:
                try:
                    request = provider.build_request(messages, settings)
                    response = provider.send(request)
                    parsed = parser.parse(response.text)
                    translated = parsed.text.strip("\n")
                    translated_blocks.append(
                        TextBlock(
                            id=len(translated_blocks) + 1,
                            prompt_text=translated,
                            metadata=block.metadata,
                        )
                    )
                    last_error = None
                    break
                except (ProviderError, ParserError, LinePolicyError) as exc:
                    last_error = str(exc)
                    attempt += 1
                    if attempt > max_retries:
                        raise
            if last_error:
                raise RuntimeError(last_error)

        apply_line_policy = bool(
            pipeline.get("apply_line_policy")
            or str(
                chunk_policy.profile.get("chunk_type")
                or chunk_policy.profile.get("type")
                or ""
            )
            == "line"
        )
        if line_policy and apply_line_policy:
            output_lines = [b.prompt_text for b in translated_blocks]
            aligned_lines = line_policy.apply(source_lines, output_lines)
            rebuilt_blocks: List[TextBlock] = []
            for idx, line in enumerate(aligned_lines):
                meta = items[idx].get("meta") if idx < len(items) else None
                rebuilt_blocks.append(
                    TextBlock(
                        id=len(rebuilt_blocks) + 1,
                        prompt_text=line,
                        metadata=[meta] if meta is not None else [],
                    )
                )
            translated_blocks = rebuilt_blocks

        if not output_path:
            base, ext = os.path.splitext(input_path)
            output_path = f"{base}_translated{ext}"

        doc.save(output_path, translated_blocks)
        return output_path
