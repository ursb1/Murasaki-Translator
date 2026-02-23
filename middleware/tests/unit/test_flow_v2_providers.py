import pytest
import threading

from murasaki_flow_v2.providers.base import BaseProvider, ProviderRequest, ProviderResponse
from murasaki_flow_v2.providers.pool import PoolProvider
from murasaki_flow_v2.providers.openai_compat import (
    OpenAICompatProvider,
    _RpmLimiter,
    _normalize_base_url,
)


class DummyProvider(BaseProvider):
    def __init__(self, provider_id: str):
        super().__init__({})
        self.provider_id = provider_id

    def build_request(self, messages, settings):
        return ProviderRequest(model="dummy", messages=messages)

    def send(self, request):
        return ProviderResponse(text=self.provider_id, raw={"provider": self.provider_id})


class DummyRegistry:
    def __init__(self):
        self.providers = {}

    def add(self, provider_id: str):
        self.providers[provider_id] = DummyProvider(provider_id)

    def get_provider(self, ref: str):
        return self.providers[ref]


@pytest.mark.unit
def test_flow_v2_pool_provider_endpoint_selection_single():
    registry = DummyRegistry()
    pool = PoolProvider(
        {
            "endpoints": [
                {
                    "base_url": "https://api.example.com/v1",
                    "api_key": "key-a",
                    "model": "model-a",
                    "weight": 2,
                }
            ],
            "model": "fallback-model",
        },
        registry,
    )
    req = pool.build_request([], {})
    assert req.provider_id == "endpoint:0"


@pytest.mark.unit
def test_flow_v2_pool_provider_endpoints_build_request():
    registry = DummyRegistry()
    pool = PoolProvider(
        {
            "endpoints": [
                {
                    "base_url": "https://api.example.com/v1",
                    "api_key": "key-a",
                    "model": "model-a",
                    "weight": 2,
                }
            ],
            "model": "fallback-model",
        },
        registry,
    )
    req = pool.build_request([], {})
    assert req.model == "model-a"


@pytest.mark.unit
def test_openai_compat_normalize_base_url_versions():
    assert (
        _normalize_base_url("https://api.example.com")
        == "https://api.example.com/v1"
    )
    assert (
        _normalize_base_url("https://api.example.com/v1")
        == "https://api.example.com/v1"
    )
    assert (
        _normalize_base_url(
            "https://aiplatform.googleapis.com/v1/projects/x/locations/y/endpoints/openapi"
        )
        == "https://aiplatform.googleapis.com/v1/projects/x/locations/y/endpoints/openapi"
    )
    assert (
        _normalize_base_url("https://open.bigmodel.cn/api/paas/v4")
        == "https://open.bigmodel.cn/api/paas/v4"
    )


@pytest.mark.unit
def test_openai_compat_send_uses_short_default_timeout():
    provider = OpenAICompatProvider(
        {
            "id": "api_demo",
            "type": "openai_compat",
            "base_url": "https://api.example.com/v1",
            "model": "demo-model",
        }
    )
    recorded: dict[str, object] = {}

    class _Resp:
        status_code = 200
        text = '{"choices":[{"message":{"content":"ok"}}]}'

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "ok"}}]}

    class _Session:
        @staticmethod
        def post(url, headers, data, timeout):
            recorded["timeout"] = timeout
            return _Resp()

    provider._session = _Session()
    request = provider.build_request(
        [{"role": "user", "content": "hello"}],
        {},
    )
    response = provider.send(request)
    assert response.text == "ok"
    assert recorded["timeout"] == 60


@pytest.mark.unit
def test_openai_compat_send_keeps_explicit_timeout():
    provider = OpenAICompatProvider(
        {
            "id": "api_demo",
            "type": "openai_compat",
            "base_url": "https://api.example.com/v1",
            "model": "demo-model",
        }
    )
    recorded: dict[str, object] = {}

    class _Resp:
        status_code = 200
        text = '{"choices":[{"message":{"content":"ok"}}]}'

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "ok"}}]}

    class _Session:
        @staticmethod
        def post(url, headers, data, timeout):
            recorded["timeout"] = timeout
            return _Resp()

    provider._session = _Session()
    request = provider.build_request(
        [{"role": "user", "content": "hello"}],
        {"timeout": 15},
    )
    response = provider.send(request)
    assert response.text == "ok"
    assert recorded["timeout"] == 15


@pytest.mark.unit
def test_openai_compat_rpm_limiter_schedules_fixed_intervals(monkeypatch):
    import murasaki_flow_v2.providers.openai_compat as provider_module

    limiter = _RpmLimiter(60)  # 1 request/second
    clock = {"now": 100.0}
    sleeps: list[float] = []

    monkeypatch.setattr(provider_module.time, "monotonic", lambda: clock["now"])

    def _sleep(seconds: float):
        sleeps.append(seconds)
        clock["now"] += seconds

    monkeypatch.setattr(provider_module.time, "sleep", _sleep)

    limiter.acquire()
    limiter.acquire()
    limiter.acquire()

    assert len(sleeps) == 2
    assert sleeps[0] == pytest.approx(1.0, rel=1e-6)
    assert sleeps[1] == pytest.approx(1.0, rel=1e-6)


@pytest.mark.unit
def test_openai_compat_session_is_thread_local(monkeypatch):
    import murasaki_flow_v2.providers.openai_compat as provider_module

    provider = OpenAICompatProvider(
        {
            "id": "api_demo",
            "type": "openai_compat",
            "base_url": "https://api.example.com/v1",
            "model": "demo-model",
        }
    )
    created = {"count": 0}

    class DummySession:
        pass

    def fake_session():
        created["count"] += 1
        return DummySession()

    monkeypatch.setattr(provider_module.requests, "Session", fake_session)
    main_thread_session = provider._get_session()
    sessions = [main_thread_session]

    def worker():
        sessions.append(provider._get_session())

    t = threading.Thread(target=worker)
    t.start()
    t.join()

    assert created["count"] == 2
    assert sessions[0] is not sessions[1]
