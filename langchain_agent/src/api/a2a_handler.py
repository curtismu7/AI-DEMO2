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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/a2a")

_agent: Optional[Any] = None
_txn_validator: Callable[[str], dict[str, Any]] = validate_privilege_transaction_token


def set_agent(agent: Any) -> None:
    """Install the initialized LangChain agent used for A2A turns."""

    global _agent
    _agent = agent


def set_transaction_token_validator(validator: Callable[[str], dict[str, Any]]) -> None:
    """Test seam for the cryptographic Privilege transaction-token verifier."""

    global _txn_validator
    _txn_validator = validator


@router.get("/.well-known/agent-card.json")
async def get_agent_card(request: Request) -> dict[str, Any]:
    public_url = os.environ.get("PRIVILEGE_A2A_PUBLIC_URL", "").rstrip("/")
    jsonrpc_url = public_url or f"{str(request.base_url).rstrip('/')}/a2a/jsonrpc"
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
    }


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
    txn_token = request.headers.get("txn-token", "").strip()
    try:
        txn_claims = _txn_validator(txn_token)
    except TokenValidationError:
        return _error(
            request_id, -32001, "Valid Privilege transaction token required", 401
        )

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
    caller = str(txn_claims["client_id"])
    session_id = "a2a-" + hashlib.sha256(caller.encode()).hexdigest()[:24]
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
