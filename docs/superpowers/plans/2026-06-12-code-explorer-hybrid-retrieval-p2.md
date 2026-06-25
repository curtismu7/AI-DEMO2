# Code Explorer Hybrid Retrieval — P2 Implementation Plan (Freshness & Fresh-Install)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Keep the Code Explorer's codegraph DB reliably fresh — rebuilt on local startup and at fresh install — and make "how fresh / how to regenerate" inspectable, so the tool works as described on a clean clone.

**Architecture:** `build-codegraph.py` records build provenance (`project_metadata`: commit, node count, timestamp). `run.sh` rebuilds the DB + stages source on startup (~1s, guarded). A discoverable `codegraph:build` npm script. SETUP/README document the one command. A fresh-clone smoke test guards the end-to-end. Stacked on P1 (uses P1's `--stage-src` + hybrid tools).

**Tech Stack:** Python 3.11 (stdlib), Node/npm, bash, pytest.

**Spec:** `docs/superpowers/specs/2026-06-12-code-explorer-hybrid-retrieval-design.md` (P2 = §5.2-C and §5.2-D). **Branch:** `worktree-codeexplorer-p2` (stacked on `worktree-codeexplorer-hybrid-spec`). Python tests run via the symlinked venv: `cd langchain_agent && .venv/bin/python -m pytest …`.

---

## File Structure
- **Modify** `scripts/build-codegraph.py` — add a `project_metadata` table + write `built_at_commit`, `node_count`, `built_at` at the end of `build()`.
- **Create** `langchain_agent/tests/test_codegraph_metadata.py` — verify metadata is written.
- **Modify** `demo_api_server/package.json` — add a `codegraph:build` script.
- **Modify** `run.sh` — rebuild the DB + stage source on startup (guarded).
- **Modify** `docs/user-guide/SETUP.md` and `README.md` — document Code Explorer + the rebuild command + the deploy-time staging prerequisite.

---

## Task 1: Record build provenance in `project_metadata`

**Files:**
- Modify: `scripts/build-codegraph.py` (schema near line 49-77; end of `build()` near line 346-350)
- Test: `langchain_agent/tests/test_codegraph_metadata.py`

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_codegraph_metadata.py`:

```python
"""build-codegraph.py records build provenance in project_metadata."""
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "build-codegraph.py"
DB = REPO_ROOT / ".codegraph" / "codegraph.db"


def test_build_writes_project_metadata():
    # Build the real repo DB (gitignored). Then assert provenance rows exist.
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
    assert rows.get("built_at")  # ISO timestamp present
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd langchain_agent && .venv/bin/python -m pytest tests/test_codegraph_metadata.py -v`
Expected: FAIL — `no such table: project_metadata`.

- [ ] **Step 3: Implement**

In `scripts/build-codegraph.py`:
(a) Add to the schema DDL (where `nodes`/`edges`/`nodes_fts` are created):

```sql
CREATE TABLE IF NOT EXISTS project_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);
```

(b) Add a helper near the top-level functions:

```python
import subprocess
from datetime import datetime, timezone

def _repo_commit(root: Path) -> str:
    try:
        out = subprocess.run(
            ['git', '-C', str(root), 'rev-parse', 'HEAD'],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip() or 'unknown'
    except Exception:
        return 'unknown'

def write_metadata(conn, root: Path) -> None:
    node_count = conn.execute('SELECT COUNT(*) FROM nodes').fetchone()[0]
    rows = {
        'built_at_commit': _repo_commit(root),
        'node_count': str(node_count),
        'built_at': datetime.now(timezone.utc).isoformat(),
    }
    for k, v in rows.items():
        conn.execute(
            'INSERT INTO project_metadata(key, value) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            (k, v),
        )
    conn.commit()
```

(c) In `build()`, just before `conn.close()` (around line 347), call `write_metadata(conn, REPO_ROOT)`.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd langchain_agent && .venv/bin/python -m pytest tests/test_codegraph_metadata.py -v`
Expected: PASS. Also confirm a manual `python3 scripts/build-codegraph.py --dry-run` still exits 0 (dry-run must NOT write metadata — guard the call so it only runs on a real build).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-codegraph.py langchain_agent/tests/test_codegraph_metadata.py
git commit -m "feat(code-explorer): record build provenance (commit/count/time) in the codegraph db"
```

---

## Task 2: Discoverable `codegraph:build` npm script

**Files:** Modify `demo_api_server/package.json:47-52` (scripts block)

- [ ] **Step 1: Add the script**

In `demo_api_server/package.json` `scripts`, add (alongside `setup:fresh`):

```json
"codegraph:build": "python3 ../scripts/build-codegraph.py"
```

- [ ] **Step 2: Verify**

Run: `cd demo_api_server && npm run codegraph:build`
Expected: prints `Wrote … edges` / `Database: …`, exits 0, and `.codegraph/codegraph.db` is updated. (This is the command the docs and the P3 page affordance will reference.)

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/package.json
git commit -m "chore(code-explorer): add codegraph:build npm script"
```

---

## Task 3: Rebuild DB + stage source on startup (`run.sh`)

**Files:** Modify `run.sh` (insert after the Python-agent dependency check, ~line 923, BEFORE services launch)

This is a bash config change (not TDD). Keep it guarded and fast (~1s); never fail startup on a codegraph error.

- [ ] **Step 1: Add the startup step**

In `run.sh`, after the existing dependency-check sections (Node deps ~891, Python agent deps ~923) and before the service-launch section, insert a guarded block. Match the script's existing `ok`/`err`/spinner helper style:

```bash
# ── CodeGraph index (Code Explorer) ──────────────────────────────────────────
# Rebuild the codegraph DB + stage the source the agent's grep/read tools read,
# so /code-explorer is always current locally. Fast (~1s, AST-only, no API cost);
# never fails startup — Code Explorer degrades gracefully on a missing/stale DB.
if command -v python3 >/dev/null 2>&1; then
  if python3 "$BASEDIR/scripts/build-codegraph.py" >/dev/null 2>&1; then
    python3 "$BASEDIR/scripts/build-codegraph.py" --stage-src langchain_agent/repo-src >/dev/null 2>&1 || true
    ok "CodeGraph index refreshed (Code Explorer)"
  else
    err "CodeGraph index build skipped (non-fatal) — Code Explorer may be stale"
  fi
else
  err "python3 not found — skipping CodeGraph index (Code Explorer disabled until built)"
fi
```

(Confirm `$BASEDIR` is the repo root in run.sh — it is the variable the script already uses for service dirs. If the var name differs, use the script's existing repo-root variable.)

- [ ] **Step 2: Verify**

Run from the repo root: `bash -n run.sh` (syntax OK). Then a dry confirmation that the block runs the builder and stages without aborting:
`python3 scripts/build-codegraph.py >/dev/null && python3 scripts/build-codegraph.py --stage-src langchain_agent/repo-src >/dev/null && echo OK`
Expected: `OK`, and `.codegraph/codegraph.db` + `langchain_agent/repo-src/` exist (the latter gitignored). Confirm `git status` shows neither (both ignored).

- [ ] **Step 3: Commit**

```bash
git add run.sh
git commit -m "feat(code-explorer): refresh codegraph index + stage source on startup"
```

---

## Task 4: Fresh-clone smoke test

**Files:** Create `langchain_agent/tests/test_codegraph_smoke.py`

A credential-free smoke test proving the *retrieval substrate* works end-to-end after a build: the DB has nodes, the staged source exists, and the hybrid tools return real hits over it. (A full LLM round-trip needs a model backend and is out of scope here — that's covered by running the agent manually / in the bake-off.)

- [ ] **Step 1: Write the test**

Create `langchain_agent/tests/test_codegraph_smoke.py`:

```python
"""Fresh-substrate smoke test: build → stage → hybrid tools return real hits."""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "build-codegraph.py"


def test_build_stage_and_tools_work(tmp_path):
    # Build the DB and stage source (the two startup/fresh-install steps).
    assert subprocess.run([sys.executable, str(SCRIPT)],
                          capture_output=True, text=True).returncode == 0
    staged = REPO_ROOT / "langchain_agent" / "repo-src"
    assert subprocess.run([sys.executable, str(SCRIPT), "--stage-src", str(staged)],
                          capture_output=True, text=True).returncode == 0
    # A known file is staged, and grep over the staged tree finds it.
    assert (staged / "demo_api_server" / "services" / "mcpGatewayClient.js").is_file()
    import os
    os.environ["REPO_SRC_ROOT"] = str(staged)
    from src.codegraph.tools import RepoGrepTool
    out = RepoGrepTool()._run("mcpGatewayClient")
    assert "mcpGatewayClient.js" in out
```

- [ ] **Step 2: Run it, verify it passes**

Run: `cd langchain_agent && .venv/bin/python -m pytest tests/test_codegraph_smoke.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add langchain_agent/tests/test_codegraph_smoke.py
git commit -m "test(code-explorer): fresh-substrate smoke (build + stage + hybrid grep)"
```

---

## Task 5: Document Code Explorer in fresh-install docs + the deploy prerequisite

**Files:** Modify `docs/user-guide/SETUP.md`, `README.md`

- [ ] **Step 1: SETUP.md** — add a short "Code Explorer (optional)" subsection after the bootstrap step:

```markdown
### Code Explorer (optional)

The public `/code-explorer` page answers natural-language questions about this
codebase. It is powered by a local code index. `npm run setup:fresh` builds it;
to rebuild after code changes (no API cost, ~1s):

    cd demo_api_server && npm run codegraph:build

`run.sh` also rebuilds it on every startup, so local dev stays current.
```

- [ ] **Step 2: README.md** — in the install/run section, add one line that `setup:fresh` builds the Code Explorer index and `npm run codegraph:build` regenerates it.

- [ ] **Step 3: Deploy prerequisite note** — in `README.md` (or `k8s/README.md` if it documents image builds), add a short note from the P1 review:

```markdown
> **Building the langchain_agent image:** the Dockerfile copies
> `langchain_agent/repo-src/` (the staged source the Code Explorer agent reads).
> Run `npm run setup:fresh` (or `python3 scripts/build-codegraph.py --stage-src langchain_agent/repo-src`)
> before `docker build` so that directory exists, or the image build fails at COPY.
```

- [ ] **Step 4: Commit**

```bash
git add docs/user-guide/SETUP.md README.md
git commit -m "docs(code-explorer): document the index build, regenerate command, and image-build prerequisite"
```

---

## Task 6: Validate

- [ ] **Step 1:** `cd langchain_agent && .venv/bin/python -m pytest -q` — full suite green (P1 + new P2 metadata/smoke tests).
- [ ] **Step 2:** `bash -n run.sh` clean; manual `npm run codegraph:build` works and writes provenance (`sqlite3 .codegraph/codegraph.db "select * from project_metadata"`).
- [ ] **Step 3:** Confirm `.codegraph/` and `langchain_agent/repo-src/` remain gitignored (no stray staged files committed).

---

## Self-Review notes
- **Spec coverage:** §5.2-C (freshness) → Tasks 1,2,3. §5.2-D (fresh install + smoke) → Tasks 4,5. The P3 page affordance consumes Task 1's `project_metadata` (separate plan).
- **Stacking:** branched from the P1 branch; Tasks 3/4 rely on P1's `--stage-src` and `RepoGrepTool`. Merge/rebase onto main after P1 lands.
- **Names:** `project_metadata` table with keys `built_at_commit`/`node_count`/`built_at`; npm script `codegraph:build`; staging dir `langchain_agent/repo-src/`. Consistent with P1 and the spec.
