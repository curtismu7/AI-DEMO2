from __future__ import annotations
import logging
import os
from typing import Any, Callable, Coroutine, Optional
from urllib.parse import urlparse
import httpx
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.tools import Tool
from .models import BffDeps

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
    """Retained for backwards compatibility; recoverable failures now raise
    pydantic_ai.ModelRetry so the model can recover or report the error."""
    pass


def build_tool_functions(
    tool_schemas: list[dict],
    emit_fn: Optional[Callable[[dict], Coroutine]] = None,
) -> list[Tool]:
    tools = []
    for schema in tool_schemas:
        tools.append(_make_tool(schema, emit_fn))
    return tools


def _make_tool(schema: dict, emit_fn: Optional[Callable[[dict], Coroutine]]) -> Tool:
    name: str = schema["name"]
    description: str = schema["description"]
    properties: dict = schema.get("inputSchema", {}).get("properties", {})
    param_names: list[str] = list(properties.keys())

    async def tool_fn(ctx: RunContext[BffDeps], **kwargs: Any) -> Any:
        args = {k: kwargs[k] for k in param_names if k in kwargs}
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ctx.deps.bff_tool_url,
                json={"tool": name, "args": args, "sessionId": ctx.deps.session_id},
                headers={
                    "x-internal-gateway-secret": ctx.deps.bff_internal_secret,
                    "x-session-id": ctx.deps.session_id,
                },
                timeout=30.0,
            )
        if resp.status_code != 200:
            # Recoverable: hand control back to the model instead of tearing down
            # the whole run — it can retry, adjust arguments, or report the error.
            raise ModelRetry(
                f"Tool '{name}' failed: BFF returned HTTP {resp.status_code}: {resp.text[:200]}"
            )
        try:
            data = resp.json()
        except ValueError as exc:
            raise ModelRetry(
                f"Tool '{name}' returned a non-JSON response from the BFF."
            ) from exc
        token_events = data.get("tokenEvents") or []
        if token_events and emit_fn:
            for te in token_events:
                try:
                    await emit_fn({
                        "type": "STATE_DELTA",
                        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": te}],
                    })
                except Exception:
                    logger.exception("[BffTool] Failed to emit STATE_DELTA")
        return data.get("result", data)

    tool_fn.__name__ = name
    tool_fn.__doc__ = description
    return Tool(tool_fn, name=name, description=description, takes_ctx=True)
