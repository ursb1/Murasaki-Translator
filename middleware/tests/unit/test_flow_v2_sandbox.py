import pytest

from murasaki_flow_v2.api.sandbox_tester import SandboxTester
from murasaki_flow_v2.parsers.base import ParseOutput, ParserError
from murasaki_flow_v2.policies.line_policy import StrictLinePolicy
from murasaki_flow_v2.registry.profile_store import ProfileStore


class _Provider:
    def __init__(self, response_text: str):
        self._response_text = response_text

    def build_request(self, messages, settings):
        class _Request:
            model = "sandbox-model"
            extra = {}
            temperature = None
            max_tokens = None

            def __init__(self, request_messages):
                self.messages = request_messages

        return _Request(messages)

    def send(self, request):
        class _Response:
            def __init__(self, text: str):
                self.text = text

        return _Response(self._response_text)


class _ProviderRegistry:
    def __init__(self, provider: _Provider):
        self._provider = provider

    def get_provider(self, ref: str):
        return self._provider


class _PromptRegistry:
    @staticmethod
    def get_prompt(ref: str):
        return {
            "id": ref,
            "context": {"source_format": "auto"},
            "user_template": "{{source}}",
        }


class _Parser:
    @staticmethod
    def parse(text: str):
        return ParseOutput(text=text, lines=text.splitlines())


class _ParserRegistry:
    @staticmethod
    def get_parser(ref: str):
        return _Parser()


class _LinePolicyRegistry:
    def __init__(self, policy):
        self._policy = policy

    def get_line_policy(self, ref: str):
        return self._policy


def _build_tester(tmp_path, response_text: str) -> SandboxTester:
    tester = SandboxTester(ProfileStore(str(tmp_path)))
    tester.providers = _ProviderRegistry(_Provider(response_text))
    tester.prompts = _PromptRegistry()
    tester.parsers = _ParserRegistry()
    tester.line_policies = _LinePolicyRegistry(
        StrictLinePolicy({"type": "strict", "options": {"on_mismatch": "error"}})
    )
    return tester


@pytest.mark.unit
def test_sandbox_applies_line_policy_and_reports_mismatch(tmp_path):
    tester = _build_tester(tmp_path, "dst-1\ndst-2")
    result = tester.run_test(
        "src-one-line",
        {
            "provider": "api_x",
            "prompt": "prompt_x",
            "parser": "parser_x",
            "chunk_type": "line",
            "line_policy": "line_policy_strict",
            "apply_line_policy": True,
        },
    )
    assert result.ok is False
    assert "LinePolicy Error" in result.error


@pytest.mark.unit
def test_sandbox_skips_line_policy_when_disabled(tmp_path):
    tester = _build_tester(tmp_path, "dst-1\ndst-2")
    result = tester.run_test(
        "src-one-line",
        {
            "provider": "api_x",
            "prompt": "prompt_x",
            "parser": "parser_x",
            "chunk_type": "line",
            "line_policy": "line_policy_strict",
            "apply_line_policy": False,
        },
    )
    assert result.ok is True
    assert result.post_processed == "dst-1\ndst-2"


@pytest.mark.unit
def test_sandbox_build_jsonline_payload_matches_runner_format():
    payload = SandboxTester._build_jsonline_payload("L1\nL2")
    assert payload == 'jsonline{"1": "L1"}\njsonline{"2": "L2"}'


@pytest.mark.unit
def test_sandbox_reports_parser_chain_failure_with_structured_stage(tmp_path):
    tester = _build_tester(tmp_path, "raw-response")

    class _FailingParser:
        profile = {"type": "any"}

        @staticmethod
        def parse(_text: str):
            raise ParserError(
                "AnyParser: all parsers failed: jsonl: invalid_jsonl; regex: pattern_not_matched"
            )

    class _FailingParserRegistry:
        @staticmethod
        def get_parser(ref: str):
            return _FailingParser()

    tester.parsers = _FailingParserRegistry()
    result = tester.run_test(
        "src-line",
        {
            "provider": "api_x",
            "prompt": "prompt_x",
            "parser": "parser_x",
            "chunk_type": "line",
            "line_policy": "line_policy_strict",
            "apply_line_policy": False,
        },
    )
    assert result.ok is False
    assert result.error_stage == "parser"
    assert result.error_code == "parser_chain_failed"
    assert result.error_details
    assert result.error_details.get("chain_failed") is True
    assert result.error_details.get("candidates") == [
        "jsonl: invalid_jsonl",
        "regex: pattern_not_matched",
    ]
