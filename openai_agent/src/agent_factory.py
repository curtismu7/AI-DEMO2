"""Constructs the openai-agents Agent for a single run."""
from __future__ import annotations
import os
from typing import Callable, Coroutine, Optional
from agents import Agent, OpenAIChatCompletionsModel
from openai import AsyncOpenAI
from .bff_tool_adapter import build_bff_tools

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful banking assistant. Use the available tools to help the user "
    "with their accounts, transactions, and banking needs. Always confirm before "
    "initiating any transfers or payments."
)


def build_llm_client(api_key: str, base_url: str | None) -> AsyncOpenAI:
    """Create the per-run AsyncOpenAI client.

    The caller owns the returned client's lifecycle and MUST close it once the
    run's stream is fully consumed (otherwise its HTTP connection and the
    underlying socket/FD leak across runs).
    """
    # Cap the LLM call — the SDK default is 600s, which lets a stalled proxy
    # pin a run for ten minutes. Override via AGENT_LLM_TIMEOUT (seconds).
    timeout = float(os.environ.get("AGENT_LLM_TIMEOUT", "120.0"))
    return AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout)


def build_agent(
    tool_schemas: list[dict],
    run_ctx: dict,
    model: str,
    api_key: str,
    system_prompt: str | None = None,
    sink: Optional[Callable[[dict], Coroutine]] = None,
    client: AsyncOpenAI | None = None,
) -> Agent:
    # When the caller does not supply a client, build one here so its lifecycle
    # is self-contained; the /run path supplies its own so it can close it.
    if client is None:
        client = build_llm_client(api_key, run_ctx.get("base_url"))
    tools = build_bff_tools(tool_schemas, run_ctx, sink=sink)
    return Agent(
        name="BankingAssistant",
        instructions=system_prompt or DEFAULT_SYSTEM_PROMPT,
        model=OpenAIChatCompletionsModel(model=model, openai_client=client),
        tools=tools,
    )
