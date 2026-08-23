#!/usr/bin/env python3
"""PreToolUse (Bash): warn — never block — on the three commands that burn the most
tokens for the least information. Each has a cheaper form answering the same question.

  1. CI polling      repeated `gh pr checks/view`, `gh run list/view`. One
                     `gh pr checks --watch` blocks and costs nothing while it waits;
                     N polls each pay a full round trip. Warns from the SECOND
                     occurrence in a session, so a single snapshot check stays free.
  2. Unscoped tests  jest/vitest/`npm test` with no test path. CLAUDE.md's default is
                     a scoped run; the full suite is for shared middleware or a red
                     scoped run.
  3. Whole-stack     `run-docker.sh restart|build` with no service — rebuilds and
     restart         re-reads everything to pick up a change in one service.

Not warned: `--watch`; `deploy-live.sh` (already targeted — it deploys only the synced
range); any run-docker.sh call naming a service; any test run naming a path or filter.

Pure Python, no bash wrapper: a `python3 <<'PY'` heredoc eats the hook's stdin, so the
JSON payload never reaches the script. Escape hatch: append `# no-leak-warn`.

Self-check: bash .claude/hooks/warn-token-leaks.test.sh
"""
import json
import os
import re
import sys
import tempfile

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = (d.get("tool_input") or {}).get("command") or ""
if not cmd or "no-leak-warn" in cmd:
    sys.exit(0)

session = re.sub(r"[^A-Za-z0-9_-]", "", str(d.get("session_id") or "nosession"))[:64]


def seen(tag):
    """Count of prior hits for this tag in this session, then record this one."""
    path = os.path.join(tempfile.gettempdir(), "claude-leakwatch", f"{session}-{tag}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = 0
    try:
        with open(path) as f:
            n = int(f.read().strip() or 0)
    except Exception:
        pass
    try:
        with open(path, "w") as f:
            f.write(str(n + 1))
    except Exception:
        pass
    return n


warnings = []

# 1. CI polling — free the first time, a leak every time after.
if re.search(r"\bgh\s+(pr\s+(checks|view)|run\s+(list|view))\b", cmd) and "--watch" not in cmd:
    if seen("ci-poll") >= 1:
        warnings.append(
            "Repeat CI poll. `gh pr checks <n> --watch` blocks until the run finishes and "
            "costs nothing while it waits — one call instead of N. Poll manually only when "
            "you need a single snapshot."
        )

# 2. Unscoped test run — no path, no -t, no --testPathPattern.
runs_tests = re.search(r"\b(npx?\s+)?(jest|vitest)\b|\bnpm\s+(run\s+)?test\b", cmd)
scoped = re.search(
    r"\.(test|spec)\.[jt]sx?\b|--testPathPattern|(^|\s)-t\s|--testNamePattern|test:unit", cmd
)
if runs_tests and not scoped:
    warnings.append(
        "Unscoped test run. CLAUDE.md's default is scoped: "
        "`cd demo_api_server && CI=true npx jest <touched test paths> --forceExit`. Full "
        "suite is for shared middleware (auth/session/token exchange/config store), a "
        "change spanning >3 route files, or a scoped run that came back red."
    )

# 3. Whole-stack restart where a targeted one would do.
if re.search(r"run-docker\.sh\s+(restart|build)\s*($|[;&|#])", cmd):
    warnings.append(
        "Whole-stack restart. Name the services instead: "
        "`./run-docker.sh restart ui demo-api-server`. After a merge, "
        "`scripts/deploy-live.sh` is already targeted — it deploys only the synced range."
    )

if warnings:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "additionalContext": (
                "TOKEN LEAK WARNING (not blocked — proceed if you have a reason, and say "
                "why): " + " | ".join(warnings) + " Suppress with `# no-leak-warn`."
            ),
        }
    }))
