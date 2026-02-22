import pytest

from murasaki_flow_v2.utils.line_format import (
    extract_line_for_policy,
    parse_jsonl_entries,
)


@pytest.mark.unit
def test_parse_jsonl_entries_single_key():
    entries, ordered = parse_jsonl_entries('jsonline{"1":"A"}')
    assert entries == {"1": "A"}
    assert ordered == []


@pytest.mark.unit
def test_parse_jsonl_entries_id_text():
    entries, ordered = parse_jsonl_entries('{"id": 2, "text": "B"}')
    assert entries == {"2": "B"}
    assert ordered == []

@pytest.mark.unit
def test_parse_jsonl_entries_id_translation():
    entries, ordered = parse_jsonl_entries('{"id": 3, "translation": "C"}')
    assert entries == {"3": "C"}
    assert ordered == []


@pytest.mark.unit
def test_parse_jsonl_entries_translation_only():
    entries, ordered = parse_jsonl_entries('{"translation": "C"}')
    assert entries == {}
    assert ordered == ["C"]


@pytest.mark.unit
def test_extract_line_for_policy_jsonl():
    text = 'jsonline{"1":"A"}\njsonline{"2":"B"}'
    assert extract_line_for_policy(text, 0) == "A"
    assert extract_line_for_policy(text, 1) == "B"


@pytest.mark.unit
def test_extract_line_for_policy_tagged():
    text = "@@1@@LineA\n@@2@@LineB"
    assert extract_line_for_policy(text, 0) == "LineA"
    assert extract_line_for_policy(text, 1) == "LineB"


@pytest.mark.unit
def test_extract_line_for_policy_tagged_positional_groups():
    text = "@@1@@LineA\n@@2@@LineB"
    assert extract_line_for_policy(text, 0, tagged_pattern=r"^@@(\d+)@@(.*)$") == "LineA"
    assert extract_line_for_policy(text, 1, tagged_pattern=r"^@@(\d+)@@(.*)$") == "LineB"


@pytest.mark.unit
def test_parse_jsonl_entries_extracts_code_fence_from_verbose_output():
    payload = (
        "Here is the result:\n"
        "```jsonl\n"
        '{"1":"A"}\n'
        '{"2":"B"}\n'
        "```\n"
        "Hope this helps."
    )
    entries, ordered = parse_jsonl_entries(payload)
    assert entries == {"1": "A", "2": "B"}
    assert ordered == []
