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

# Read timeout for the BFF /internal/agent-tool callback. The BFF does RFC 8693
# token exchange + PingOne Authorize + optional HITL gating, which can exceed
# 30s under load. A spurious timeout errors the run *while the BFF may still be
# completing the tool*, so a retry can double a non-idempotent action (e.g. a
# transfer). Use a generous, configurable read timeout and a short connect
# timeout. Shares BFF_TOOL_TIMEOUT_SECONDS with the langchain adapter.
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
        # Small models sometimes emit malformed JSON for tool arguments. Return a
        # tool-error STRING to the model (so it can retry) instead of raising and
        # aborting the entire run.
        try:
            args = json.loads(args_json) if args_json else {}
        except json.JSONDecodeError as exc:
            logger.warning("[BffTool] %s invalid tool-args JSON session=%s: %s",
                           tool_name, run_ctx["session_id"], exc)
            return json.dumps({"error": f"Invalid tool arguments (not valid JSON): {exc}"})
        # Argument values may contain PII; log only names/count at INFO, values at DEBUG.
        logger.info("[BffTool] %s arg_keys=%s session=%s",
                    tool_name, sorted(args.keys()) if isinstance(args, dict) else "n/a",
                    run_ctx["session_id"])
        logger.debug("[BffTool] %s args=%s session=%s", tool_name, args, run_ctx["session_id"])
        _timeout = httpx.Timeout(_BFF_TOOL_TIMEOUT_SECONDS, connect=10.0)
        try:
            async with httpx.AsyncClient(timeout=_timeout) as client:
                resp = await client.post(
                    run_ctx["bff_tool_url"],
                    json={"tool": tool_name, "args": args, "sessionId": run_ctx["session_id"]},
                    headers={
                        "x-internal-gateway-secret": run_ctx["bff_internal_secret"],
                        "x-session-id": run_ctx["session_id"],
                        "Content-Type": "application/json",
                    },
                )
        except httpx.TimeoutException:
            logger.error("[BffTool] %s timed out after %ss", tool_name, _BFF_TOOL_TIMEOUT_SECONDS)
            # Return a tool-result STRING (not a raised error) so the run does not
            # abort in a way that invites a blind retry of a possibly-completed,
            # non-idempotent operation (e.g. a transfer).
            return json.dumps({
                "error": (
                    f"Tool '{tool_name}' did not respond within "
                    f"{int(_BFF_TOOL_TIMEOUT_SECONDS)}s. It may still be processing "
                    "on the server. Do NOT retry automatically — ask the user to "
                    "verify the result (e.g. check recent transactions) before "
                    "trying again."
                )
            })
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
