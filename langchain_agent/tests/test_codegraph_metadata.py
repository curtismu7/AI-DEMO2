"""build-codegraph.py records build provenance in project_metadata."""
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "build-codegraph.py"
DB = REPO_ROOT / ".codegraph" / "codegraph.db"


def test_build_writes_project_metadata():
    result = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    conn = sqlite3.connect(str(DB))
    try:
        rows = dict(conn.execute("SELECT key, value FROM project_metadata").fetchall())
    finally:
        conn.close()
    head = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
        capture_output=True, text=True,
    ).stdout.strip()
    assert rows.get("built_at_commit") == head
    assert int(rows.get("node_count", "0")) > 0
    assert rows.get("built_at")
