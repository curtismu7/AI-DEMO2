# langchain_agent/src/codegraph/llm_target.py
"""Resolve a live llama.cpp / llm-proxy target for Code Explorer.

Never hard-pin Code Explorer at llama-tier1/3/5. The llm-proxy `/health`
payload already lists each tier's `healthy` flag — pick a healthy model name
and send chat completions to the proxy origin so the proxy routes (and swaps
if needed) to the running tier.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Prefer tool/reasoning-capable tiers when several are healthy. Names match
# demo_llm_proxy/router.js TIERS[].name.
_PREFERRED_ORDER = (
    "gpt-oss-20b",
    "llama-3-groq-8b-tool-use",
    "phi-4-mini-instruct",
)


def proxy_base_url() -> str:
    """Origin for chat completions — prefer the in-cluster llm-proxy."""
    return (
        os.getenv("CODEGRAPH_LLAMACPP_BASE_URL")
        or os.getenv("LLAMACPP_BASE_URL")
        or "http://host.docker.internal:8090"
    ).rstrip("/")


def preferred_model_name() -> Optional[str]:
    """Optional pin from env (used only when that model is currently healthy)."""
    for key in ("CODEGRAPH_MODEL", "LLAMACPP_MODEL"):
        raw = (os.getenv(key) or "").strip()
        if not raw:
            continue
        if raw.lower().startswith("claude"):
            continue
        return raw
    return None


def fetch_proxy_health(base_url: str, timeout: float = 2.0) -> Optional[dict[str, Any]]:
    """GET {base}/health. Returns parsed JSON or None on failure."""
    url = base_url.rstrip("/") + "/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if getattr(resp, "status", 200) >= 400:
                return None
            return json.loads(resp.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        logger.debug("CodeGraph LLM: health probe failed for %s: %s", url, exc)
        return None


def healthy_model_names(health: dict[str, Any]) -> list[str]:
    """Extract names of models flagged healthy from llm-proxy /health."""
    models = health.get("models")
    if not isinstance(models, list):
        return []
    names: list[str] = []
    for entry in models:
        if not isinstance(entry, dict):
            continue
        if entry.get("healthy") is not True:
            continue
        name = entry.get("name")
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return names


def pick_healthy_model(
    health: dict[str, Any],
    preferred: Optional[str] = None,
) -> Optional[str]:
    """Choose a model name currently marked healthy on the proxy.

    Order: preferred (if healthy) → preferred-order list → first healthy.
    """
    healthy = healthy_model_names(health)
    if not healthy:
        return None

    if preferred:
        # Exact match, or preferred is a substring of a healthy id (gguf aliases).
        pref = preferred.strip()
        for name in healthy:
            if name == pref or pref in name or name in pref:
                return name

    for candidate in _PREFERRED_ORDER:
        for name in healthy:
            if name == candidate or candidate in name:
                return name

    return healthy[0]


def resolve_llamacpp_target(
    preferred: Optional[str] = None,
) -> tuple[str, Optional[str], str]:
    """Return (base_url, model_or_none, reason) for a live local LLM.

    `model` is None when the proxy is reachable but no tier reports healthy —
    caller may still attempt a request (proxy may swap) or fall through.
    """
    base = proxy_base_url()
    pref = preferred if preferred is not None else preferred_model_name()
    health = fetch_proxy_health(base)
    if health is None:
        return base, None, f"proxy unreachable at {base}"

    model = pick_healthy_model(health, preferred=pref)
    status = health.get("status", "unknown")
    healthy = healthy_model_names(health)
    if model:
        return (
            base,
            model,
            f"proxy {status}; healthy={healthy}; picked={model}",
        )
    return (
        base,
        pref,  # may trigger a swap on next chat if preferred is set
        f"proxy {status}; no healthy tiers (healthy={healthy}); "
        f"using preferred pin={pref!r}",
    )
