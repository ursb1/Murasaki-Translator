import pytest

from murasaki_flow_v2.parsers.builtins import RegexParser, JsonObjectParser


@pytest.mark.unit
def test_flow_v2_regex_parser():
    parser = RegexParser(
        {
            "options": {
                "pattern": r"result: (?P<content>.+)",
                "group": "content",
            }
        }
    )
    output = parser.parse("result: hello")
    assert output.text == "hello"


@pytest.mark.unit
def test_flow_v2_json_object_parser():
    parser = JsonObjectParser({"options": {"path": "translation.text"}})
    output = parser.parse('{"translation": {"text": "hi"}}')
    assert output.text == "hi"


@pytest.mark.unit
def test_flow_v2_regex_parser_missing_pattern():
    parser = RegexParser({"options": {}})
    with pytest.raises(RuntimeError):
        parser.parse("result: hello")
