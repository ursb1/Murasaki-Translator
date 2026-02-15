import pytest

from murasaki_flow_v2.policies.chunk_policy import LineChunkPolicy
from murasaki_flow_v2.policies.line_policy import (
    LinePolicyError,
    StrictLinePolicy,
    TolerantLinePolicy,
)
from murasaki_flow_v2.utils.line_aligner import align_lines


@pytest.mark.unit
def test_flow_v2_align_lines_basic():
    src = ["a", "", "b"]
    dst = ["x"]
    assert align_lines(src, dst) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_strict_error():
    policy = StrictLinePolicy({"options": {"on_mismatch": "error"}})
    with pytest.raises(LinePolicyError):
        policy.apply(["a", "b"], ["x"])


@pytest.mark.unit
def test_flow_v2_line_policy_strict_pad():
    policy = StrictLinePolicy({"options": {"on_mismatch": "pad"}})
    assert policy.apply(["a", "b", "c"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_strict_align():
    policy = StrictLinePolicy({"options": {"on_mismatch": "align"}})
    assert policy.apply(["a", "", "b"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_tolerant():
    policy = TolerantLinePolicy({})
    assert policy.apply(["a", "", "b"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_chunk_policy_strict():
    policy = LineChunkPolicy({"options": {"strict": True, "keep_empty": True}})
    items = [
        {"text": "hello\n", "meta": 0},
        {"text": "\n", "meta": 1},
        {"text": "world", "meta": 2},
    ]
    blocks = policy.chunk(items)
    assert [b.prompt_text for b in blocks] == ["hello", "", "world"]
