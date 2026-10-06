"""Outbound A2A: this agent calling other agents through the Privilege gateway.

Targets come from ``A2A_DELEGATE_TARGETS`` (JSON: name -> {url, description});
the agent's own gateway key from ``PRIVILEGE_A2A_AGENT_KEY``. With either
unset there are no targets and nothing here does anything.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextvars import ContextVar
from typing import Any

import httpx
from langchain_core.tools import StructuredTool

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 60.0
_CARD_TIMEOUT_SECONDS = 10.0
_MAX_WIRE_TEXT = 4000


# Hand-offs made while serving one inbound request, so the handler can report
# them to its caller. Unset outside a request: nothing is recorded.
_hop_trace: ContextVar[list[dict[str, Any]] | None] = ContextVar("a2a_hop_trace", default=None)


class DelegationError(Exception):
    """The downstream agent could not be reached or refused the call."""


def start_hop_trace() -> list[dict[str, Any]]:
    """Begin recording hand-offs for the current request; returns the live list."""

    hops: list[dict[str, Any]] = []
    _hop_trace.set(hops)
    return hops


def _record_hop(target: str, status: str, detail: str, started: float, **extra: Any) -> None:
    """Add one entry to the caller's report. ``extra`` is what crossed the wire."""

    hops = _hop_trace.get()
    if hops is not None:
        hops.append(
            {
                "from": "langchainagent",
                "to": target,
                "status": status,
                "detail": detail,
                "elapsedMs": round((time.monotonic() - started) * 1000),
                **{key: value for key, value in extra.items() if value not in (None, "", {}, [])},
            }
        )


def _masked_key() -> str:
    """This agent's gateway key as it may be shown: its recognisable prefix only."""

    return f"{os.environ.get('PRIVILEGE_A2A_AGENT_KEY', '')[:13]}… (masked)"


def _pretty(raw: str) -> str:
    try:
        return json.dumps(json.loads(raw), indent=2)
    except ValueError:
        return raw.strip()


def _wire_response(response: httpx.Response) -> str:
    return f"HTTP {response.status_code}\n\n{_pretty(response.text)[:_MAX_WIRE_TEXT]}"


def _texts(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str) and item] if isinstance(value, list) else []


def _card_summary(body: dict[str, Any]) -> dict[str, Any]:
    """The fields of an A2A Agent Card the caller's trace shows.

    Names, versions and other short fields only. The card's prose (its
    description and each skill's description) is another agent's free text, and
    this report travels back to our caller inside our own reply: relaying it
    would carry whatever that agent wrote, including an instruction aimed at a
    model, through us. The gateway's guardrail blocked exactly that reply when
    the hostile demo agent's card was relayed (a2a_response_blocked,
    2026-10-06). So the prose is counted, not copied.
    """

    skills = [skill for skill in body.get("skills") or [] if isinstance(skill, dict) and isinstance(skill.get("name"), str)]
    required: dict[str, list[str]] = {}
    for entry in body.get("securityRequirements") or body.get("security") or []:
        if isinstance(entry, dict):
            required.update({name: _texts(scopes) for name, scopes in entry.items()})
    security = []
    for name, scheme in (body.get("securitySchemes") or {}).items():
        fields = scheme if isinstance(scheme, dict) else {}
        kind = fields.get("type") if isinstance(fields.get("type"), str) else next(iter(fields), "unspecified")
        scopes = required.get(name, [])
        security.append(f"{name} ({kind})" + (f", scopes: {' '.join(scopes)}" if scopes else ""))
    capabilities = body.get("capabilities") if isinstance(body.get("capabilities"), dict) else {}
    return {
        "name": body["name"],
        "description": "",
        "descriptionChars": len(body["description"]) if isinstance(body.get("description"), str) else 0,
        "protocolVersion": body.get("protocolVersion") if isinstance(body.get("protocolVersion"), str) else "",
        "url": body.get("url") if isinstance(body.get("url"), str) else "",
        "preferredTransport": body.get("preferredTransport") if isinstance(body.get("preferredTransport"), str) else "",
        "skills": [skill["name"] for skill in skills],
        "version": body.get("version") if isinstance(body.get("version"), str) else "",
        "capabilities": [f"{name}: {'yes' if value else 'no'}" for name, value in capabilities.items() if isinstance(value, bool)],
        "inputModes": _texts(body.get("defaultInputModes")),
        "outputModes": _texts(body.get("defaultOutputModes")),
        "skillDetails": [
            {
                "id": skill.get("id") if isinstance(skill.get("id"), str) else "",
                "name": skill["name"],
                "description": "",
                "tags": _texts(skill.get("tags")),
            }
            for skill in skills
        ],
        "security": security,
    }


def card_urls_for(jsonrpc_url: str) -> list[str]:
    """Where a target's Agent Card may live behind its gateway route, likeliest first.

    An agent serves its card beside its JSON-RPC endpoint or at the root of its
    route; which one depends on the agent, so both are tried.
    """

    beside = jsonrpc_url.rstrip("/").removesuffix("/jsonrpc")
    root = beside.removesuffix("/a2a")
    return list(dict.fromkeys(f"{base}/.well-known/agent-card.json" for base in (beside, root)))


async def _discover(target: str, url: str, client: httpx.AsyncClient) -> None:
    """Read the target's A2A Agent Card through the gateway and report it.

    Discovery for the caller's trace only: the card is never given to the model,
    and the hand-off goes to the configured gateway route whatever the card says.
    A card that cannot be read is reported and the hand-off carries on.
    """

    started = time.monotonic()
    headers = {"Authorization": f"Bearer {os.environ['PRIVILEGE_A2A_AGENT_KEY']}"}
    request = ""
    last: httpx.Response | None = None
    try:
        for card_url in card_urls_for(url):
            request = f"GET {card_url}\nAuthorization: Bearer {_masked_key()}"
            last = await client.get(card_url, headers=headers, timeout=_CARD_TIMEOUT_SECONDS)
            try:
                body: Any = last.json()
            except ValueError:
                body = None
            if last.status_code == 200 and isinstance(body, dict) and isinstance(body.get("name"), str):
                _record_hop(
                    target, "ok", f"Agent Card for {body['name']}", started,
                    kind="card", card=_card_summary(body), request=request,
                    # Not the card's body: see _card_summary on relaying another agent's text.
                    response=f"HTTP {last.status_code}\n\n(Agent Card received, {len(last.text)} characters. Its text is not relayed.)",
                    wire={"status": last.status_code}, credential=_masked_key(),
                )
                return
    except httpx.HTTPError as exc:
        _record_hop(target, "unavailable", f"No Agent Card returned ({type(exc).__name__})", started, kind="card", request=request, credential=_masked_key())
        return
    status = last.status_code if last is not None else 0
    _record_hop(
        target, "unavailable", f"No Agent Card returned (HTTP {status})", started,
        kind="card", request=request, response=_wire_response(last) if last is not None else "",
        wire={"status": status}, credential=_masked_key(),
    )


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

    exchange: dict[str, Any] = {}
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=_TIMEOUT_SECONDS)
    try:
        targets = load_targets()
        # Only a request that reports its hand-offs pays for discovery.
        if _hop_trace.get() is not None and target in targets:
            await _discover(target, targets[target]["url"], client)
        started = time.monotonic()
        try:
            reply = await _send(target, text, client, exchange)
        except DelegationError as exc:
            _record_hop(target, "refused", str(exc), started, message=text, **exchange)
            raise
        _record_hop(target, "ok", "", started, message=text, reply=reply, **exchange)
        return reply
    finally:
        if own_client:
            await client.aclose()


async def _send(target: str, text: str, client: httpx.AsyncClient, exchange: dict[str, Any]) -> str:
    """Make the call. ``exchange`` is filled with what crossed the wire, for the report."""

    targets = load_targets()
    if target not in targets:
        raise DelegationError(f"unknown delegation target: {target}")
    url = targets[target]["url"]
    rpc_id = str(uuid.uuid4())
    message_id = str(uuid.uuid4())
    payload = {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "messageId": message_id,
                "parts": [{"kind": "text", "text": text}],
            }
        },
    }
    headers = {"Authorization": f"Bearer {os.environ['PRIVILEGE_A2A_AGENT_KEY']}"}
    exchange.update(
        request=f"POST {url}\nContent-Type: application/json\nAuthorization: Bearer {_masked_key()}\n\n{json.dumps(payload, indent=2)}",
        credential=_masked_key(),
        wire={"rpcId": rpc_id, "messageId": message_id},
    )
    try:
        response = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise DelegationError(f"{target} unreachable: {type(exc).__name__}") from exc
    exchange["response"] = _wire_response(response)
    exchange["wire"]["status"] = response.status_code

    # The gateway refuses with plain text (policy, scope) or a JSON-RPC error
    # (guardrail block); the downstream agent answers with a JSON-RPC result.
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        if isinstance(body["error"].get("code"), int):
            exchange["wire"]["errorCode"] = body["error"]["code"]
        raise DelegationError(f"{target} refused ({response.status_code}): {body['error'].get('message')}")
    if response.status_code != 200 or not isinstance(body, dict):
        raise DelegationError(f"{target} refused ({response.status_code}): {response.text.strip()[:200]}")
    result = body.get("result") if isinstance(body.get("result"), dict) else {}
    exchange["wire"].update(
        {
            key: value
            for key, value in (("replyMessageId", result.get("messageId")), ("kind", result.get("kind")), ("role", result.get("role")))
            if isinstance(value, str) and value
        }
    )
    parts = result.get("parts") or []
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
