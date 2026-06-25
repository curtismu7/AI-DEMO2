"""SSE wire formatting for AG-UI events."""
import json
from typing import Any, Dict

# AG-UI keepalive comment line — sent every 15s to prevent proxy timeout
KEEPALIVE_PING = ": ping\n\n"


def format_sse(event_dict: Dict[str, Any]) -> str:
    """Serialise an AG-UI event dict to an SSE data line.

    Returns a string of the form:
        data: {"type": "..."}\n\n
    """
    payload = json.dumps(event_dict, separators=(",", ":"))
    return f"data: {payload}\n\n"
