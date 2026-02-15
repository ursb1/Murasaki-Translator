import pytest

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.parsers.registry import ParserRegistry


@pytest.mark.unit
def test_profile_store_load(tmp_path):
    api_dir = tmp_path / "api"
    api_dir.mkdir()
    profile_path = api_dir / "demo.yaml"
    profile_path.write_text("id: demo\nname: Demo API\ntype: openai_compat\n", encoding="utf-8")
    store = ProfileStore(str(tmp_path))
    profile = store.load_profile("api", "demo")
    assert profile["id"] == "demo"
    assert profile["name"] == "Demo API"


@pytest.mark.unit
def test_parser_registry_plain(tmp_path):
    parser_dir = tmp_path / "parser"
    parser_dir.mkdir()
    profile_path = parser_dir / "plain.yaml"
    profile_path.write_text("id: parser_plain\nname: Plain\ntype: plain\n", encoding="utf-8")
    store = ProfileStore(str(tmp_path))
    registry = ParserRegistry(store)
    parser = registry.get_parser("parser_plain")
    output = parser.parse("hello")
    assert output.text == "hello"
