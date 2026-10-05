"""The default Gemini model must be one the demo's Google key can still call.

gemini-2.0-flash returned HTTP 404 for the key (checked 2026-10-05, from the agent
container) while gemini-2.5-flash answered and made tool calls; Google mode then failed
every turn.
"""
import inspect

from agent.llm_factory import get_llm
from config.settings import LangChainConfig

RETIRED = "gemini-2.0-flash"


def test_settings_default_is_not_the_retired_model():
    assert LangChainConfig().google_model != RETIRED
    assert LangChainConfig().google_model == "gemini-2.5-flash"


def test_get_llm_default_is_not_the_retired_model():
    default = inspect.signature(get_llm).parameters["google_model"].default
    assert default == "gemini-2.5-flash"

