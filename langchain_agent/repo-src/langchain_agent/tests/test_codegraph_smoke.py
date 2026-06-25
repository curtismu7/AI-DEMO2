"""Fresh-substrate smoke test: build -> stage -> hybrid tools return real hits."""
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "build-codegraph.py"


def test_build_stage_and_tools_work():
    assert subprocess.run([sys.executable, str(SCRIPT)],
                          capture_output=True, text=True).returncode == 0
    staged = REPO_ROOT / "langchain_agent" / "repo-src"
    assert subprocess.run([sys.executable, str(SCRIPT), "--stage-src", str(staged)],
                          capture_output=True, text=True).returncode == 0
    assert (staged / "demo_api_server" / "services" / "mcpGatewayClient.js").is_file()
    os.environ["REPO_SRC_ROOT"] = str(staged)
    try:
        from src.codegraph.tools import RepoGrepTool
        out = RepoGrepTool()._run("mcpGatewayClient")
    finally:
        os.environ.pop("REPO_SRC_ROOT", None)
    assert "mcpGatewayClient.js" in out
