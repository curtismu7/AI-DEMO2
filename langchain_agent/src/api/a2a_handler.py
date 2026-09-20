"""A2A JSON-RPC surface for the Privilege Remote Agent gateway."""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from typing import Any, Callable, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from authentication.token_validator import (
    TokenValidationError,
    validate_privilege_transaction_token,
)
from authentication.federated_token_validator import FederatedCaller, FederatedTokenValidator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/a2a")

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


@router.get("/.well-known/agent-card.json")
async def get_agent_card(request: Request) -> dict[str, Any]:
    public_url = (
        _a2a_public_url
        or
        os.environ.get("A2A_PUBLIC_URL", "")
        or os.environ.get("PRIVILEGE_A2A_PUBLIC_URL", "")
    ).rstrip("/")
    jsonrpc_url = public_url or f"{str(request.base_url).rstrip('/')}/a2a/jsonrpc"
    metadata_urls = _configured_metadata_urls()
    oauth_scheme: dict[str, Any] = {
        "description": "OAuth 2.0 access token issued by an allowlisted customer IdP.",
        "flows": {"authorizationCode": {"scopes": {"agent:invoke": "Invoke the LangChain A2A agent"}}},
    }
    if metadata_urls:
        oauth_scheme["oauth2MetadataUrl"] = metadata_urls[0]
    return {
        "name": "langchainagent",
        "description": "LangChain MCP agent exposed through PingOne Privilege AI Gateway.",
        "protocolVersion": "0.3.0",
        "version": "1.0.0",
        "url": jsonrpc_url,
        "preferredTransport": "JSONRPC",
        "capabilities": {
            "extensions": [],
            "stateTransitionHistory": False,
            "pushNotifications": False,
            "streaming": False,
        },
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text"],
        "skills": [
            {
                "id": "langchainagent-chat",
                "name": "LangChain agent chat",
                "description": "Delegate a text task to the LangChain MCP agent.",
                "tags": ["langchain", "mcp"],
            }
        ],
        "additionalInterfaces": [{"url": jsonrpc_url, "transport": "JSONRPC"}],
        "securitySchemes": {"customerOAuth": {"oauth2": oauth_scheme}},
        "securityRequirements": [{"customerOAuth": ["agent:invoke"]}],
        "x-tenantOAuthMetadata": metadata_urls,
    }


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


def _error(request_id: Any, code: int, message: str, status: int) -> JSONResponse:
    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": code, "message": message},
        },
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
        if scheme.lower() != "bearer" or not token or _federated_validator is None:
            return _auth_error(request_id, "Bearer authentication is not configured", 401)
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
    if body.get("method") != "message/send":
        return _error(request_id, -32601, "Method not found", 404)
    text = _message_text(body.get("params"))
    if not text:
        return _error(request_id, -32602, "A text message is required", 400)
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
            },
        }
    )


def _auth_error(request_id: Any, message: str, status: int) -> JSONResponse:
    response = _error(request_id, -32001, message, status)
    response.headers["WWW-Authenticate"] = (
        'Bearer realm="langchain-a2a", error="insufficient_scope"'
        if status == 403
        else 'Bearer realm="langchain-a2a"'
    )
    return response
