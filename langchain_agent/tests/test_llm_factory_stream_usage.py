import pytest

from agent.llm_factory import get_llm


@pytest.mark.parametrize("provider", ["lmstudio", "llamacpp", "groq", "google"])
def test_openai_compatible_models_request_stream_usage(provider):
    llm = get_llm(provider=provider, api_key="x", streaming=True)
    assert llm.stream_usage is True
