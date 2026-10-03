"""Outbound A2A: this agent calling other agents through the Privilege gateway.

Targets come from ``A2A_DELEGATE_TARGETS`` (JSON: name -> {url, description});
the agent's own gateway key from ``PRIVILEGE_A2A_AGENT_KEY``. With either
unset there are no targets and nothing here does anything.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Any

import httpx
from langchain_core.tools import StructuredTool

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 60.0


class DelegationError(Exception):
    """The downstream agent could not be reached or refused the call."""


def load_targets() -> dict[str, dict[str, str]]:
    """Configured delegation targets, or {} when delegation is not set up."""

    raw = os.environ.get("A2A_DELEGATE_TARGETS", "").strip()
    if not raw or not os.environ.get("PRIVILEGE_A2A_AGENT_KEY"):
        return {}
    try:
        targets = json.loads(raw)
    except ValueError:
        logger.error("[A2A] A2A_DELEGATE_TARGETS is not valid JSON; delegation disabled")
        return {}
    return {
        name: target
        for name, target in targets.items()
        if isinstance(target, dict) and isinstance(target.get("url"), str)
    }


async def delegate(target: str, text: str, client: httpx.AsyncClient | None = None) -> str:
    """Send ``text`` to the named target as A2A ``message/send``; return its reply text."""

    targets = load_targets()
    if target not in targets:
        raise DelegationError(f"unknown delegation target: {target}")
    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "messageId": str(uuid.uuid4()),
                "parts": [{"kind": "text", "text": text}],
            }
        },
    }
    headers = {"Authorization": f"Bearer {os.environ['PRIVILEGE_A2A_AGENT_KEY']}"}
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)
    try:
        response = await client.post(targets[target]["url"], json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise DelegationError(f"{target} unreachable: {type(exc).__name__}") from exc
    finally:
        if own_client:
            await client.aclose()

    # The gateway refuses with plain text (policy, scope) or a JSON-RPC error
    # (guardrail block); the downstream agent answers with a JSON-RPC result.
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        raise DelegationError(f"{target} refused ({response.status_code}): {body['error'].get('message')}")
    if response.status_code != 200 or not isinstance(body, dict):
        raise DelegationError(f"{target} refused ({response.status_code}): {response.text.strip()[:200]}")
    parts = (body.get("result") or {}).get("parts") or []
    return "\n".join(p["text"] for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)).strip()


def build_delegate_tools() -> list[StructuredTool]:
    """One LangChain tool per target, so the model can choose to delegate."""

    tools = []
    for name, target in load_targets().items():

        async def _run(message: str, _name: str = name) -> str:
            try:
                return await delegate(_name, message)
            except DelegationError as exc:
                return f"Delegation failed: {exc}"

        tools.append(
            StructuredTool.from_function(
                coroutine=_run,
                name=f"delegate_to_{name}",
                description=(
                    f"Ask the {name} agent for help. {target.get('description', '')} "
                    "Pass the full question as `message`; returns that agent's answer."
                ).strip(),
            )
        )
    return tools
