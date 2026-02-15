import pytest

from murasaki_flow_v2.prompts.builder import build_messages


@pytest.mark.unit
def test_flow_v2_prompt_line_number():
    profile = {
        "system_template": "Translate",
        "user_template": "@@{{line_number}}@@{{source}}",
    }
    messages = build_messages(
        profile,
        source_text="hello",
        context_before="",
        context_after="",
        glossary_text="",
        line_index=4,
    )
    assert messages[-1]["content"] == "@@5@@hello"
