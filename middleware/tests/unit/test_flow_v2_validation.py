import pytest

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.validation import validate_profile


@pytest.mark.unit
def test_flow_v2_validation_api_missing_fields():
    result = validate_profile("api", {"id": "api1", "type": "openai_compat"})
    assert "missing_base_url" in result.errors
    assert "missing_model" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pipeline_missing_refs(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    data = {
        "id": "pipe1",
        "provider": "missing_api",
        "prompt": "missing_prompt",
        "parser": "missing_parser",
        "chunk_policy": "missing_chunk",
    }
    result = validate_profile("pipeline", data, store=store)
    assert any(item.startswith("missing_reference:api:") for item in result.warnings)
    assert any(item.startswith("missing_reference:prompt:") for item in result.warnings)


@pytest.mark.unit
def test_flow_v2_validation_pipeline_missing_required():
    data = {"id": "pipe1"}
    result = validate_profile("pipeline", data)
    assert "missing_field:provider" in result.errors
