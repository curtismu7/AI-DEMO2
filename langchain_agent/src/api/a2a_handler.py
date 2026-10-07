"""A2A JSON-RPC surface for the Privilege Remote Agent gateway."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import uuid
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from agent import a2a_delegation
from api import a2a_tasks
from authentication.token_validator import (
    TokenValidationError,
    validate_privilege_transaction_token,
)
from authentication.federated_token_validator import FederatedCaller, FederatedTokenValidator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/a2a")
public_router = APIRouter()

_agent: Optional[Any] = None
_txn_validator: Callable[[str], dict[str, Any]] = validate_privilege_transaction_token
_federated_validator: Optional[FederatedTokenValidator] = None
_a2a_public_url = ""
_a2a_metadata_urls: list[str] = []


def set_agent(agent: Any) -> None:
    """Install the initialized LangChain agent used for A2A turns."""

    global _agent
    _agent = agent


def set_transaction_token_validator(validator: Callable[[str], dict[str, Any]]) -> None:
    """Test seam for the cryptographic Privilege transaction-token verifier."""

    global _txn_validator
    _txn_validator = validator


def set_federated_token_validator(validator: Optional[FederatedTokenValidator]) -> None:
    """Install the configured customer-IdP validator, or disable that branch."""

    global _federated_validator
    _federated_validator = validator


def set_a2a_discovery_config(public_url: str, metadata_urls: list[str]) -> None:
    """Install the validated public discovery values from AppConfig."""

    global _a2a_public_url, _a2a_metadata_urls
    _a2a_public_url = public_url.rstrip("/")
    _a2a_metadata_urls = list(metadata_urls)


def _advertised_url(request: Request) -> str:
    """The JSON-RPC URL to put in the card: the address this caller used.

    A caller on the direct host is told the direct address (A2A_PUBLIC_URL);
    anyone else (the Privilege gateway reaches us by the cluster-internal
    service name) is told the gateway route (PRIVILEGE_A2A_PUBLIC_URL), so a
    client that follows the card stays on the route it came in by. When only
    one is configured, that one is used.
    """

    direct = (_a2a_public_url or os.environ.get("A2A_PUBLIC_URL", "")).rstrip("/")
    gateway = os.environ.get("PRIVILEGE_A2A_PUBLIC_URL", "").rstrip("/")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    if direct and urlsplit(direct).netloc == host.split(",")[0].strip():
        return direct
    return gateway or direct


@router.get("/.well-known/agent-card.json")
async def get_agent_card(request: Request) -> dict[str, Any]:
    jsonrpc_url = _advertised_url(request) or f"{str(request.base_url).rstrip('/')}/a2a/jsonrpc"
    metadata_urls = _configured_metadata_urls()
    oauth_scheme: dict[str, Any] = {
        "description": "OAuth 2.0 access token issued by an allowlisted customer IdP.",
        "flows": {"authorizationCode": {"scopes": {"agent:invoke": "Invoke the LangChain A2A agent"}}},
    }
    if metadata_urls:
        oauth_scheme["oauth2MetadataUrl"] = metadata_urls[0]
    return {
        "name": "langchainagent",
        "description": (
            "LangGraph banking agent. Answers account, balance, transaction and transfer questions "
            "through MCP tools, and can hand a message to a configured specialist agent through the "
            "PingOne Privilege AI Gateway. Every hand-off it makes is reported back in the reply."
        ),
        "protocolVersion": "0.3.0",
        "version": "1.1.0",
        "url": jsonrpc_url,
        "preferredTransport": "JSONRPC",
        "provider": {"organization": "Ping Identity", "url": "https://www.pingidentity.com"},
        "documentationUrl": "https://docs.pingidentity.com",
        "capabilities": {
            "extensions": [],
            "stateTransitionHistory": False,
            # Push only when an allowlisted callback host is configured (a2a_tasks.py).
            "pushNotifications": a2a_tasks.push_enabled(),
            "streaming": True,
        },
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "skills": [
            {
                "id": "langchainagent-chat",
                "name": "LangChain agent chat",
                "description": "Delegate a text task to the LangChain MCP agent: accounts, balances, transactions and transfers.",
                "tags": ["langchain", "mcp", "banking"],
                "examples": ["What are my account balances?", "Show my last five transactions."],
            },
            {
                "id": "langchainagent-delegate",
                "name": "Hand off to a specialist agent",
                "description": (
                    "Forward a message to a configured specialist agent through the gateway. "
                    "Name it in the request metadata as delegateTo; no model call is made."
                ),
                "tags": ["a2a", "delegation"],
                "examples": ["Review who has admin access (metadata: delegateTo=<specialist>)."],
            },
        ],
        "additionalInterfaces": [{"url": jsonrpc_url, "transport": "JSONRPC"}],
        "securitySchemes": {"customerOAuth": {"oauth2": oauth_scheme}},
        "securityRequirements": [{"customerOAuth": ["agent:invoke"]}],
        "x-tenantOAuthMetadata": metadata_urls,
    }


@public_router.get("/.well-known/agent-card.json")
async def get_public_agent_card(request: Request) -> dict[str, Any]:
    """Expose the standard host-level A2A discovery path for direct clients."""

    return await get_agent_card(request)


def _configured_metadata_urls() -> list[str]:
    if _a2a_metadata_urls:
        return list(_a2a_metadata_urls)
    raw = os.environ.get("A2A_TENANT_METADATA_URLS", "")
    return [value.strip() for value in raw.split(",") if value.strip()]


def _message_text(params: Any) -> str:
    message = params.get("message") if isinstance(params, dict) else None
    parts = message.get("parts") if isinstance(message, dict) else None
    if not isinstance(parts, list):
        return ""
    return "\n".join(
        part["text"]
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ).strip()


def _error(request_id: Any, code: int, message: str, status: int, data: Any = None) -> JSONResponse:
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": error},
        status_code=status,
    )


@router.post("/jsonrpc")
async def jsonrpc(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return _error(None, -32700, "Parse error", 400)

    request_id = body.get("id") if isinstance(body, dict) else None
    bearer = request.headers.get("authorization", "").strip()
    txn_token = request.headers.get("txn-token", "").strip()
    caller_key: str
    if bearer:
        scheme, _, token = bearer.partition(" ")
        if scheme.lower() == "bearer" and _is_gateway_static_token(token):
            # ponytail: one shared token carries no caller identity, so every
            # gateway caller shares one conversation; key the session on a
            # gateway-supplied caller header if per-agent history matters.
            caller_key = "privilege:static-token"
        elif scheme.lower() != "bearer" or not token or _federated_validator is None:
            return _auth_error(request_id, "Bearer authentication is not configured", 401)
        else:
            try:
                caller = _federated_validator.validate(token)
                caller_key = f"federated:{caller.tenant_id}:{caller.sub}"
            except TokenValidationError as exc:
                status = 403 if "required scope" in str(exc) else 401
                return _auth_error(request_id, "Insufficient A2A scope" if status == 403 else "Bearer token rejected", status)
    elif txn_token:
        try:
            txn_claims = _txn_validator(txn_token)
        except TokenValidationError:
            return _error(request_id, -32001, "Valid Privilege transaction token required", 401)
        caller = None
        caller_key = f"privilege:{txn_claims['client_id']}"
    else:
        return _auth_error(request_id, "Bearer authentication required", 401)

    if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
        return _error(request_id, -32600, "Invalid Request", 400)
    method = body.get("method")
    if method == "tasks/get":
        return _tasks_get(request_id, body.get("params"), caller_key)
    if method == "tasks/resubscribe":
        return _resubscribe(request_id, body.get("params"), caller_key)
    if method == "tasks/pushNotificationConfig/set":
        return await _push_config_set(request_id, body.get("params"), caller_key)
    if method not in ("message/send", "message/stream"):
        return _error(request_id, -32601, "Method not found", 404)
    text = _message_text(body.get("params"))
    if not text:
        return _error(request_id, -32602, "A text message is required", 400)
    # Opt-in task lifecycle; a plain message/send falls through to the single Message below.
    if method == "message/stream":
        return _stream_task(request_id, body.get("params"), text, caller_key)
    if _metadata_flag(body.get("params"), "task"):
        return await _send_task(request_id, body.get("params"), text, caller_key)

    # Explicit hand-off: the caller names a configured specialist and this
    # agent forwards the message to it through the gateway. No banking
    # identification and no model involved, so it works on the first message.
    # Every hand-off this request causes, explicit or model-chosen, is reported
    # back in the reply so the caller can show the chain.
    hops = a2a_delegation.start_hop_trace()
    a2a_delegation.set_relay_card_text(_metadata_flag(body.get("params"), "relayCardText"))
    delegate_to = _delegate_target(body.get("params"))
    if delegate_to:
        try:
            delegated = await a2a_delegation.delegate(delegate_to, text)
        except a2a_delegation.DelegationError as exc:
            logger.warning("[A2A] delegation to %s failed: %s", delegate_to, exc)
            return _error(request_id, -32003, f"Delegation failed: {exc}", 502, data={"hops": hops})
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "kind": "message",
                    "messageId": str(uuid.uuid4()),
                    "role": "agent",
                    "parts": [{"kind": "text", "text": delegated}],
                    "metadata": {"delegatedTo": delegate_to, "delegatedBy": "langchainagent", "hops": hops},
                },
            }
        )

    if _agent is None:
        return _error(request_id, -32002, "Agent is not ready", 503)

    # Use only validated, non-secret claims to partition conversations. Never
    # persist or log the transaction token itself.
    session_id = "a2a-" + hashlib.sha256(caller_key.encode()).hexdigest()[:24]
    try:
        reply = await _agent.process_message(text, session_id)
    except Exception:
        logger.exception("[A2A] Agent execution failed")
        return _error(request_id, -32000, "Agent execution failed", 500)

    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "kind": "message",
                "messageId": str(uuid.uuid4()),
                "role": "agent",
                "parts": [{"kind": "text", "text": str(reply)}],
                **({"metadata": {"hops": hops}} if hops else {}),
            },
        }
    )


class _TaskFailure(Exception):
    """A turn that ends the task as failed, with the text the caller may see."""


def _owner_session(caller_key: str) -> str:
    return "a2a-" + hashlib.sha256(caller_key.encode()).hexdigest()[:24]


async def _produce_reply(params: Any, text: str, caller_key: str) -> tuple[str, dict[str, Any]]:
    """One turn for the task and streaming paths: the same hand-off or agent call as message/send."""

    hops = a2a_delegation.start_hop_trace()
    a2a_delegation.set_relay_card_text(_metadata_flag(params, "relayCardText"))
    delegate_to = _delegate_target(params)
    if delegate_to:
        try:
            delegated = await a2a_delegation.delegate(delegate_to, text)
        except a2a_delegation.DelegationError as exc:
            logger.warning("[A2A] delegation to %s failed: %s", delegate_to, exc)
            raise _TaskFailure(f"Delegation failed: {exc}") from exc
        return delegated, {"delegatedTo": delegate_to, "delegatedBy": "langchainagent", "hops": hops}
    if _agent is None:
        raise _TaskFailure("Agent is not ready")
    try:
        reply = await _agent.process_message(text, _owner_session(caller_key))
    except Exception as exc:
        logger.exception("[A2A] Agent execution failed")
        raise _TaskFailure("Agent execution failed") from exc
    return str(reply), ({"hops": hops} if hops else {})


def _context_id(params: Any) -> Optional[str]:
    message = params.get("message") if isinstance(params, dict) and isinstance(params.get("message"), dict) else {}
    value = message.get("contextId")
    return value if isinstance(value, str) and value else None


async def _run_task(task: dict[str, Any], params: Any, text: str, caller_key: str) -> dict[str, Any]:
    """Run the turn for an already-created working task, then store it and notify callbacks."""

    try:
        reply, metadata = await _produce_reply(params, text, caller_key)
        a2a_tasks.finish(task, "completed", a2a_tasks.result_artifact(reply, metadata))
    except _TaskFailure as exc:
        a2a_tasks.finish(task, "failed", None, str(exc))
    a2a_tasks.task_store().save(task, caller_key)
    await a2a_tasks.notify_push(task, caller_key)
    return task


async def _send_task(request_id: Any, params: Any, text: str, caller_key: str) -> JSONResponse:
    task = a2a_tasks.new_task(_context_id(params))
    a2a_tasks.task_store().save(task, caller_key)
    await _run_task(task, params, text, caller_key)
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": task})


def _sse(request_id: Any, result: dict[str, Any]) -> str:
    return "data: " + json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}) + "\n\n"


async def _drive_stream(run: a2a_tasks.TaskRun, params: Any, text: str, caller_key: str) -> None:
    """Run the turn and publish its events. Lives in the background, independent of any connection."""

    task = run.task
    await run.publish(json.loads(json.dumps(task)))
    try:
        await _run_task(task, params, text, caller_key)
    except Exception:
        logger.exception("[A2A] task run failed")
        a2a_tasks.finish(task, "failed", None, "Agent execution failed")
        a2a_tasks.task_store().save(task, caller_key)
    for artifact in task["artifacts"]:
        await run.publish(
            {"kind": "artifact-update", "taskId": task["id"], "contextId": task["contextId"], "artifact": artifact, "lastChunk": True}
        )
    await run.publish(
        {"kind": "status-update", "taskId": task["id"], "contextId": task["contextId"], "status": task["status"], "final": True}
    )


async def _follow(request_id: Any, run: a2a_tasks.TaskRun, start: int, first: Optional[dict[str, Any]] = None):
    if first is not None:
        yield _sse(request_id, first)
    async for event in run.follow(start):
        yield _sse(request_id, event)


def _stream_task(request_id: Any, params: Any, text: str, caller_key: str) -> StreamingResponse:
    """message/stream: the working task, then its artifact, then the final status, as server-sent events.

    The task runs in the background, so a caller that drops the stream does not stop it
    and can rejoin with tasks/resubscribe.
    """

    task = a2a_tasks.new_task(_context_id(params))
    a2a_tasks.task_store().save(task, caller_key)
    run = a2a_tasks.start_run(task, caller_key, lambda r: _drive_stream(r, params, text, caller_key))
    return StreamingResponse(_follow(request_id, run, 0), media_type="text/event-stream")


def _resubscribe(request_id: Any, params: Any, caller_key: str):
    """tasks/resubscribe: the task as it is now, then every later event, while it is still running."""

    task_id = params.get("id") if isinstance(params, dict) else None
    run = a2a_tasks.get_run(task_id, caller_key) if isinstance(task_id, str) else None
    if run is None:
        stored = a2a_tasks.task_store().get(task_id, caller_key) if isinstance(task_id, str) else None
        if stored is None:
            return _error(request_id, -32001, "Task not found", 404)
        state = stored["status"]["state"]
        if state in a2a_tasks.TERMINAL_STATES:
            return _error(request_id, -32004, f"Task {task_id} is in a terminal state ({state}) and cannot be subscribed to", 400)
        return _error(request_id, -32004, "Task is not running on this instance", 400)
    snapshot = json.loads(json.dumps(run.task))
    return StreamingResponse(_follow(request_id, run, len(run.events), snapshot), media_type="text/event-stream")


def _tasks_get(request_id: Any, params: Any, caller_key: str) -> JSONResponse:
    task_id = params.get("id") if isinstance(params, dict) else None
    task = a2a_tasks.task_store().get(task_id, caller_key) if isinstance(task_id, str) else None
    if task is None:
        return _error(request_id, -32001, "Task not found", 404)
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": task})


async def _push_config_set(request_id: Any, params: Any, caller_key: str) -> JSONResponse:
    if not a2a_tasks.push_enabled():
        return _error(request_id, -32003, "Push notifications are not enabled on this agent", 400)
    params = params if isinstance(params, dict) else {}
    task_id = params.get("taskId")
    config = params.get("pushNotificationConfig") if isinstance(params.get("pushNotificationConfig"), dict) else {}
    if not isinstance(task_id, str) or a2a_tasks.task_store().get(task_id, caller_key) is None:
        return _error(request_id, -32001, "Task not found", 404)
    try:
        await a2a_tasks.assert_push_url_allowed(str(config.get("url", "")))
    except ValueError as exc:
        return _error(request_id, -32602, str(exc), 400)
    stored = a2a_tasks.task_store().add_push(task_id, caller_key, config["url"], str(config.get("token", "")))
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": {"taskId": task_id, "pushNotificationConfig": {"id": stored["id"], "url": stored["url"]}}})


def _delegate_target(params: Any) -> str:
    """The ``delegateTo`` name from the request's or the message's metadata, or ''."""

    if not isinstance(params, dict):
        return ""
    message = params.get("message") if isinstance(params.get("message"), dict) else {}
    for holder in (params.get("metadata"), message.get("metadata")):
        if isinstance(holder, dict) and isinstance(holder.get("delegateTo"), str):
            return holder["delegateTo"].strip()
    return ""


def _metadata_flag(params: Any, name: str) -> bool:
    """True when the request's or the message's metadata sets ``name`` to true."""

    if not isinstance(params, dict):
        return False
    message = params.get("message") if isinstance(params.get("message"), dict) else {}
    return any(isinstance(holder, dict) and holder.get(name) is True for holder in (params.get("metadata"), message.get("metadata")))


def _is_gateway_static_token(token: str) -> bool:
    """True when ``token`` is the secret the Privilege gateway's Static Token mode sends."""

    expected = os.environ.get("PRIVILEGE_A2A_STATIC_TOKEN", "")
    return bool(expected) and hmac.compare_digest(token.encode(), expected.encode())


def _auth_error(request_id: Any, message: str, status: int) -> JSONResponse:
    response = _error(request_id, -32001, message, status)
    response.headers["WWW-Authenticate"] = (
        'Bearer realm="langchain-a2a", error="insufficient_scope"'
        if status == 403
        else 'Bearer realm="langchain-a2a"'
    )
    return response
