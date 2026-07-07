"""LangChain BaseTool wrappers that call the BFF /internal/agent-tool endpoint.

Each tool call:
1. POSTs { tool, args, sessionId } to the BFF tool URL with the internal secret.
2. Reads tokenEvents from the response (success AND error bodies) and emits a single
   STATE_DELTA with one add op per event (path /tokenEvents/-) so the client's token
   chain accumulates across multi-tool runs.
3. Returns the tool result string for the LLM.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Coroutine, Dict, List, Optional, Type
from urllib.parse import urlparse

import httpx
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

logger = logging.getLogger(__name__)

# Read timeout for the BFF /internal/agent-tool callback. Must exceed the BFF's
# own tool budget (token exchange + Authorize + HITL) so a slow-but-successful
# tool isn't spuriously aborted mid-flight. Configurable for slower deployments.
_BFF_TOOL_TIMEOUT_SECONDS = float(os.environ.get("BFF_TOOL_TIMEOUT_SECONDS", "120"))

# Hosts the shared internal secret (BFF_INTERNAL_SECRET) may be sent to. The BFF
# supplies the tool-callback URL in the run payload (its cert is for
# api.ping.demo, not the agent's own BFF_BASE_URL host), so we must accept a
# request-supplied URL — but only to a trusted host. Extend via
# BFF_ALLOWED_TOOL_HOSTS (comma-separated) for non-default deployments.
_DEFAULT_ALLOWED_BFF_HOSTS = {"api.ping.demo", "demo-api-server", "localhost", "127.0.0.1"}


def resolve_bff_tool_url(request_url: str, config_url: str) -> str:
    """Return a BFF tool URL that is safe to attach the internal secret to.

    A request-supplied URL is honored only when its host is allowlisted;
    otherwise we fall back to the server-configured URL. This prevents a caller
    from pointing the agent at an attacker host and exfiltrating the shared
    internal gateway secret.
    """
    if not request_url:
        return config_url
    allowed = set(_DEFAULT_ALLOWED_BFF_HOSTS)
    allowed.update(h.strip() for h in os.environ.get("BFF_ALLOWED_TOOL_HOSTS", "").split(",") if h.strip())
    cfg_host = urlparse(config_url).hostname
    if cfg_host:
        allowed.add(cfg_host)
    host = urlparse(request_url).hostname
    if host and host in allowed:
        return request_url
    logger.warning("[security] ignoring untrusted bffToolUrl host=%r; using configured BFF URL", host)
    return config_url


# ── Pydantic schema helpers ───────────────────────────────────────────────────

def _build_schema_from_input_schema(name: str, input_schema: Dict[str, Any]) -> Type[BaseModel]:
    """Convert a JSON Schema object into a dynamic Pydantic model for use as args_schema."""
    properties = input_schema.get("properties") or {}
    required = input_schema.get("required") or []

    if not properties:
        class _Empty(BaseModel):
            pass
        return _Empty

    fields: Dict[str, Any] = {}
    annotations: Dict[str, Any] = {}

    for prop_name, prop_schema in properties.items():
        prop_type = prop_schema.get("type", "string")
        prop_description = prop_schema.get("description", f"Parameter {prop_name}")
        prop_default = prop_schema.get("default")

        if prop_type == "string":
            python_type: Any = str
        elif prop_type == "number":
            python_type = float
        elif prop_type == "integer":
            python_type = int
        elif prop_type == "boolean":
            python_type = bool
        elif prop_type == "array":
            python_type = List[Any]
        elif prop_type == "object":
            python_type = Dict[str, Any]
        else:
            python_type = Any

        if prop_name not in required:
            python_type = Optional[python_type]
            if prop_default is None:
                prop_default = None

        if prop_default is not None:
            fields[prop_name] = Field(default=prop_default, description=prop_description)
        elif prop_name not in required:
            fields[prop_name] = Field(default=None, description=prop_description)
        else:
            fields[prop_name] = Field(description=prop_description)

        annotations[prop_name] = python_type

    class_name = f"Bff{''.join(w.title() for w in name.split('_'))}Input"
    return type(class_name, (BaseModel,), {"__annotations__": annotations, **fields})


# ── BffTool ───────────────────────────────────────────────────────────────────

class BffTool(BaseTool):
    """LangChain tool that calls the BFF /internal/agent-tool endpoint.

    Emits a STATE_DELTA (one add op per token event) after each call — including
    failure responses — so the TokenChain panel accumulates events across multi-tool
    runs and still shows where the chain broke when a tool call fails.
    """

    name: str
    description: str
    args_schema: Type[BaseModel]
    return_direct: bool = False

    bff_tool_url: str
    session_id: str

    _sink: Optional[Callable[[Dict[str, Any]], Coroutine]] = PrivateAttr(default=None)
    _bff_internal_secret: str = PrivateAttr(default="")

    def __init__(
        self,
        *,
        name: str,
        description: str,
        args_schema: Type[BaseModel],
        bff_tool_url: str,
        session_id: str,
        sink: Optional[Callable] = None,
        bff_internal_secret: str = "",
        **kwargs: Any,
    ) -> None:
        super().__init__(
            name=name,
            description=description,
            args_schema=args_schema,
            bff_tool_url=bff_tool_url,
            session_id=session_id,
            **kwargs,
        )
        self._sink = sink
        self._bff_internal_secret = bff_internal_secret

    def _run(self, **kwargs: Any) -> str:
        raise NotImplementedError("BffTool only supports async execution")

    async def _emit_token_events(self, token_events: List[Dict[str, Any]]) -> None:
        """Emit all token events as one STATE_DELTA with an add op per event.

        The client's applyJsonPatch applies the whole delta array, so batching keeps
        the Token Chain panel accumulating while emitting a single frame per call.
        """
        if not token_events or not self._sink:
            return
        try:
            await self._sink({
                "type": "STATE_DELTA",
                "delta": [
                    {"op": "add", "path": "/tokenEvents/-", "value": te}
                    for te in token_events
                ],
            })
        except Exception:
            logger.exception("[BffTool] Failed to emit STATE_DELTA for tokenEvents")

    async def _arun(self, **kwargs: Any) -> str:
        args = {k: v for k, v in kwargs.items() if v is not None}
        logger.info("[BffTool] %s args=%s session=%s", self.name, args, self.session_id)

        # The BFF /internal/agent-tool call does RFC 8693 token exchange +
        # PingOne Authorize + optional HITL gating, which can take longer than
        # the old 30s cap under load. A spurious ReadTimeout errors the whole run
        # *while the BFF may still be completing the tool*, so a retry can double
        # a non-idempotent action (e.g. a transfer). Use a generous, configurable
        # read timeout and a short connect timeout.
        _timeout = httpx.Timeout(_BFF_TOOL_TIMEOUT_SECONDS, connect=10.0)
        try:
            async with httpx.AsyncClient(timeout=_timeout) as client:
                resp = await client.post(
                    self.bff_tool_url,
                    json={"tool": self.name, "args": args, "sessionId": self.session_id},
                    headers={
                        "x-internal-gateway-secret": self._bff_internal_secret,
                        "x-session-id": self.session_id,
                        "Content-Type": "application/json",
                    },
                )
        except httpx.TimeoutException:
            logger.error("[BffTool] %s timed out after %ss", self.name, _BFF_TOOL_TIMEOUT_SECONDS)
            # Return a non-error string so the graph does not surface a RUN_ERROR
            # that invites a blind retry of a possibly-completed operation.
            return (
                f"Tool '{self.name}' did not respond within "
                f"{int(_BFF_TOOL_TIMEOUT_SECONDS)}s. It may still be processing on "
                "the server. Do NOT retry automatically — ask the user to verify "
                "the result (e.g. check recent transactions) before trying again."
            )

        if resp.status_code != 200:
            body = resp.text[:200]
            logger.error("[BffTool] %s HTTP %s: %s", self.name, resp.status_code, body)
            # Error bodies (e.g. 502 token-exchange-failed) carry tokenEvents that show
            # where the chain broke — surface them so the Token Chain panel isn't blank
            # on exactly the failures it exists to visualize.
            try:
                err_events = resp.json().get("tokenEvents") or []
            except Exception:
                err_events = []
            await self._emit_token_events(err_events)
            return f"Tool call failed: HTTP {resp.status_code}: {body}"

        data = resp.json()

        # Emit the call's token events so the client accumulates events across
        # multi-tool runs (one add op per event; replace would overwrite prior events).
        await self._emit_token_events(data.get("tokenEvents") or [])

        result = data.get("result", data)
        return json.dumps(result) if not isinstance(result, str) else result


# ── Factory ───────────────────────────────────────────────────────────────────

def build_bff_tools(
    tool_schemas: List[Dict[str, Any]],
    bff_tool_url: str,
    session_id: str,
    sink: Optional[Callable] = None,
) -> List[BffTool]:
    """Build a BffTool for each schema from the BFF /run payload."""
    secret = os.environ.get("BFF_INTERNAL_SECRET", "dev-shared-secret-change-me")
    tools = []
    for schema in tool_schemas:
        tool_name = schema.get("name", "unknown_tool")
        description = schema.get("description", "")
        input_schema = schema.get("inputSchema") or {"type": "object", "properties": {}}
        args_schema = _build_schema_from_input_schema(tool_name, input_schema)
        tools.append(BffTool(
            name=tool_name,
            description=description,
            args_schema=args_schema,
            bff_tool_url=bff_tool_url,
            session_id=session_id,
            sink=sink,
            bff_internal_secret=secret,
        ))
    logger.info("[BffTool] Built %d BFF tools for session %s", len(tools), session_id)
    return tools
