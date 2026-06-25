"""
Helix agent-key file loader.

Python equivalent of demo_api_server/services/helixAgentKeyLoader.js.

Helix's web console lets you download a per-agent API key as a JSON file
named <agentName>.json — keys: keyName, keyValue, expiration, scope, etc.
When HELIX_API_KEY env var is not set, we look for that JSON file in three
common locations and lift the keyValue out so the service "just works".

Search order (first match wins):
  1. Repo root            (where the user typically drops the export)
  2. ~/Documents/<file>.json
  3. ~/Downloads/<file>.json

Successful lookups are memoized per agent name for the process lifetime.
Failed lookups (file absent or empty) are NOT cached, so dropping a key
file into the search path takes effect on the next request without a
process restart. To rotate a key, replace the file and restart.

This loader is intentionally a fallback only — explicit HELIX_API_KEY
env var wins.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Repo root = four directories up from this file:
# src/agent/helix_key_loader.py → src/agent → src → langchain_agent → repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_HOME = Path.home()

# Only cache hits — misses re-check on every call so a new key file is
# picked up automatically without a process restart.
_cache: dict[str, str] = {}


def _read_agent_json(path: Path) -> Optional[str]:
    """Return keyValue from a Helix agent-key JSON file, or None."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        value = data.get("keyValue", "")
        return value.strip() if isinstance(value, str) and value.strip() else None
    except Exception:
        return None


def load_agent_key(agent_name: str) -> Optional[str]:
    """
    Load a Helix agent's API key from <agentName>.json in repo root,
    ~/Documents, or ~/Downloads.

    Returns the keyValue string, or None if no file is found / readable /
    contains a non-empty keyValue.

    Args:
        agent_name: Helix agent name, e.g. "LLM2"
    """
    if not agent_name:
        return None

    # Sanitise — same logic as the JS loader
    safe = "".join(c for c in agent_name if c.isalnum() or c in ("_", ".", "-"))
    if not safe:
        return None

    if safe in _cache:
        return _cache[safe]

    candidates = [
        _REPO_ROOT / f"{safe}.json",
        _HOME / "Documents" / f"{safe}.json",
        _HOME / "Downloads" / f"{safe}.json",
    ]

    for path in candidates:
        value = _read_agent_json(path)
        if value:
            logger.info("[Helix] API key loaded from %s (agent: %s)", path, safe)
            _cache[safe] = value
            return value

    # Don't cache misses — allows the file to appear without a process restart.
    return None


def clear_cache() -> None:
    """Test/admin hook — clear the memoized lookup."""
    _cache.clear()
