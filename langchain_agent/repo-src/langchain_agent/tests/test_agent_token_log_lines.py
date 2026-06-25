import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "agent" / "mcp_tool_provider.py"


def test_token_debug_lines_use_masked_fingerprint():
    text = SRC.read_text()
    bad = re.findall(r'logger\.debug\(f"[^"]*\{self\._current_agent_token\}', text)
    assert bad == [], f"bare token interpolation still present: {bad}"
    bad2 = re.findall(r'logger\.debug\(f"[^"]*\{agent_token\}', text)
    assert bad2 == [], f"bare agent_token interpolation still present: {bad2}"
    assert "masked_fingerprint()" in text
