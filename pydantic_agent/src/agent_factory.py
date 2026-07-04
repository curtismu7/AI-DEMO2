from __future__ import annotations
import os
from typing import Callable, Coroutine, Optional
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from .bff_tool_adapter import build_tool_functions
from .models import BffDeps

_ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6"


def build_agent(
    tool_schemas: list[dict],
    model_name: str,
    base_url: str,
    api_key: str,
    system_prompt: str | None = None,
    provider: str = "",
    emit_fn: Optional[Callable[[dict], Coroutine]] = None,
) -> Agent:
    if provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
        effective_model = model_name if model_name else _ANTHROPIC_DEFAULT_MODEL
        # pydantic-ai >=1.x AnthropicModel has no api_key kwarg; the key is passed
        # via the provider. Passing api_key= directly raises TypeError on every run.
        model = AnthropicModel(
            effective_model,
            provider=AnthropicProvider(api_key=anthropic_key or None),
        )
    else:
        # Constructing OpenAIModel with an explicit provider keeps pydantic_ai from
        # falling back to the env-driven default (which would 401 on LM Studio).
        model = OpenAIModel(
            model_name=model_name,
            provider=OpenAIProvider(base_url=base_url, api_key=api_key),
        )
    tools = build_tool_functions(tool_schemas, emit_fn=emit_fn)
    prompt = system_prompt or (
        "You are a helpful banking assistant. "
        "Use the available tools to answer user questions accurately."
    )
    return Agent(
        model,
        deps_type=BffDeps,
        tools=tools,
        system_prompt=prompt,
        defer_model_check=True,
    )
