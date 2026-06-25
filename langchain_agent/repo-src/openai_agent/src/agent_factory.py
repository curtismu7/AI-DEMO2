"""Constructs the openai-agents Agent for a single run."""
from __future__ import annotations
from typing import Callable, Coroutine, Optional
from agents import Agent, OpenAIChatCompletionsModel
from openai import AsyncOpenAI
from .bff_tool_adapter import build_bff_tools

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful banking assistant. Use the available tools to help the user "
    "with their accounts, transactions, and banking needs. Always confirm before "
    "initiating any transfers or payments."
)


def build_agent(
    tool_schemas: list[dict],
    run_ctx: dict,
    model: str,
    api_key: str,
    system_prompt: str | None = None,
    sink: Optional[Callable[[dict], Coroutine]] = None,
) -> Agent:
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=run_ctx.get("base_url"),
    )
    tools = build_bff_tools(tool_schemas, run_ctx, sink=sink)
    return Agent(
        name="BankingAssistant",
        instructions=system_prompt or DEFAULT_SYSTEM_PROMPT,
        model=OpenAIChatCompletionsModel(model=model, openai_client=client),
        tools=tools,
    )
