"""Identity-sidecar token client (ff_agent_identity_sidecar).

When the flag is ON for a request, the agent asks the identity sidecar for its
PingOne agent token instead of running client_credentials itself. The agent
names a target; the sidecar owns scope, audience and resource.

There is no silent fallback: if the flag is ON and the sidecar cannot supply a
token the call fails, so a broken sidecar is never hidden behind the old path.
"""

import asyncio
import contextvars
import os
from datetime import datetime, timezone
from typing import Optional

import aiohttp
from models.auth import AccessToken

# Set per request by the AG-UI gate middleware from the BFF's
# `x-agent-identity-sidecar` header.
sidecar_requested: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "agent_identity_sidecar_requested", default=False
)


class IdentitySidecarError(RuntimeError):
    """The sidecar could not supply a token. Never carries the API key."""


def credentials_optional() -> bool:
    """True for a creds-free deploy: start without PingOne client credentials."""
    return os.environ.get("AGENT_IDENTITY_SIDECAR_ONLY", "").lower() == "true"


async def fetch_sidecar_token(
    session: aiohttp.ClientSession, target: Optional[str] = None
) -> AccessToken:
    api_key = os.environ.get("AGENT_IDENTITY_SIDECAR_API_KEY", "")
    if not api_key:
        raise IdentitySidecarError("AGENT_IDENTITY_SIDECAR_API_KEY is not set")
    base = os.environ.get("AGENT_IDENTITY_SIDECAR_URL", "http://agent-identity-sidecar:8097")
    url = base.rstrip("/") + "/v1/token"
    target = target or os.environ.get("AGENT_IDENTITY_SIDECAR_TARGET", "mcp-gateway")

    try:
        async with session.post(
            url,
            json={"target": target},
            headers={"x-api-key": api_key},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            body = await resp.json(content_type=None)
            if resp.status != 200:
                error = body.get("error") if isinstance(body, dict) else None
                raise IdentitySidecarError(
                    f"identity sidecar returned HTTP {resp.status} for target {target!r}: {error}"
                )
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        raise IdentitySidecarError(f"identity sidecar unreachable at {url}: {e}") from e

    if not isinstance(body, dict) or not body.get("access_token"):
        raise IdentitySidecarError("identity sidecar response missing access_token")
    return AccessToken(
        token=body["access_token"],
        token_type=body.get("token_type", "Bearer"),
        expires_in=int(body.get("expires_in", 300)),
        scope=body.get("scope", ""),
        issued_at=datetime.now(timezone.utc),
    )
