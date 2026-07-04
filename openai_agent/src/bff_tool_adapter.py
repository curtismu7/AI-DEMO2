"""Wraps BFF /internal/agent-tool calls as OpenAI Agents SDK FunctionTool objects."""
from __future__ import annotations
import json
import logging
import os
from typing import Callable, Coroutine, Optional, TypedDict
from urllib.parse import urlparse

import httpx
from agents import FunctionTool, RunContextWrapper

logger = logging.getLogger(__name__)

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


class BffToolError(Exception):
    pass


class RunCtx(TypedDict):
    bff_tool_url: str
    bff_internal_secret: str
    session_id: str


def build_bff_tools(
    tool_schemas: list[dict],
    run_ctx: RunCtx,
    sink: Optional[Callable[[dict], Coroutine]] = None,
) -> list[FunctionTool]:
    """
    For each tool schema from the BFF run payload, create a FunctionTool that
    POSTs to the BFF /internal/agent-tool endpoint when invoked.
    """
    return [_make_tool(schema, run_ctx, sink) for schema in tool_schemas]


def _make_tool(schema: dict, run_ctx: RunCtx, sink: Optional[Callable[[dict], Coroutine]]) -> FunctionTool:
    tool_name = schema["name"]
    tool_description = schema.get("description", "")
    input_schema = schema.get("inputSchema", {"type": "object", "properties": {}})

    async def _emit_token_events(token_events: list) -> None:
        if not token_events or not sink:
            return
        # One batched STATE_DELTA (one add op per event); the client's applyJsonPatch
        # applies the whole delta array in one pass, so N frames would be wasted.
        try:
            await sink({
                "type": "STATE_DELTA",
                "delta": [
                    {"op": "add", "path": "/tokenEvents/-", "value": te}
                    for te in token_events
                ],
            })
        except Exception:
            logger.exception("[BffTool] Failed to emit STATE_DELTA")

    async def _invoke(ctx: RunContextWrapper, args_json: str) -> str:
        args = json.loads(args_json) if args_json else {}
        logger.info("[BffTool] %s args=%s session=%s", tool_name, args, run_ctx["session_id"])
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                run_ctx["bff_tool_url"],
                json={"tool": tool_name, "args": args, "sessionId": run_ctx["session_id"]},
                headers={
                    "x-internal-gateway-secret": run_ctx["bff_internal_secret"],
                    "x-session-id": run_ctx["session_id"],
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            body = resp.text[:200]
            logger.error("[BffTool] %s HTTP %s: %s", tool_name, resp.status_code, body)
            # Error bodies (e.g. 502 token-exchange-failed) carry tokenEvents showing
            # where the chain broke — surface them before raising so the Token Chain
            # panel isn't blank on exactly the failure it exists to visualize.
            try:
                err_events = resp.json().get("tokenEvents") or []
            except Exception:
                err_events = []
            await _emit_token_events(err_events)
            raise BffToolError(f"BFF returned HTTP {resp.status_code}: {body}")
        data = resp.json()
        await _emit_token_events(data.get("tokenEvents") or [])
        return json.dumps(data.get("result", data))

    return FunctionTool(
        name=tool_name,
        description=tool_description,
        params_json_schema=input_schema,
        on_invoke_tool=_invoke,
        strict_json_schema=False,
    )
