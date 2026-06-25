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

import httpx
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

logger = logging.getLogger(__name__)


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

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                self.bff_tool_url,
                json={"tool": self.name, "args": args, "sessionId": self.session_id},
                headers={
                    "x-internal-gateway-secret": self._bff_internal_secret,
                    "x-session-id": self.session_id,
                    "Content-Type": "application/json",
                },
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
