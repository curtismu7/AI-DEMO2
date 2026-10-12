#!/usr/bin/env python3
# PreToolUse (Bash): deny shell-level writes and destructive git ops in the
# shared MAIN checkout; allow in worktrees. Companion to
# block-main-checkout-writes.sh (Write|Edit), which Bash bypassed: the
# 2026-10-12 clobber incidents were heredoc/redirect edits to repo files from
# a main-checkout session (one wiped gen-service-topology.js twice via a
# symlinked test stub).
#
# Catches:
#   - `> path` / `>> path` / `&> path` / `tee path` where the resolved target
#     is inside the main checkout (symlink chains resolved via realpath).
#   - Uncommitted-work discards run in the main checkout: `git reset --hard`,
#     `git clean -f*`, `git checkout -- <path>`, `git restore <path>`,
#     `git switch --discard-changes`.
#
# Does NOT catch (documented gaps):
#   - targets behind shell variables (`cat > "$STUB_DIR/x"` — unresolvable
#     statically; use cp -R, never ln -s, for repo files a stub overwrites);
#   - writes from subprocesses (python file writes, npm builds);
#   - `git pull`-based wipes.
# Exemptions mirror block-main-checkout-writes.sh: .claude/**, CLAUDE.md,
# REGRESSION_PLAN.md, AGENTS.md, demo_api_server/.env, ping-gateway/.env.

import json, os, re, subprocess, sys

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
t = d.get('tool_input') or {}
cmd = str(t.get('command') or '')
cwd = d.get('cwd') or os.getcwd()
if not cmd.strip():
    sys.exit(0)


def git(*a):
    try:
        r = subprocess.run(['git', '-C', cwd, *a], capture_output=True, text=True, timeout=5)
        return r.stdout.strip()
    except Exception:
        return ''


# Only enforce in the shared main checkout (linked worktrees: git-dir differs
# from common-dir; same test as block-main-checkout-writes.sh).
gd = git('rev-parse', '--absolute-git-dir')
cd = git('rev-parse', '--path-format=absolute', '--git-common-dir')
if not gd or not cd or gd != cd:
    sys.exit(0)
root = git('rev-parse', '--show-toplevel')
if not root:
    sys.exit(0)

# Drop heredoc BODIES before scanning: a heredoc's text routinely contains
# redirects/git ops that are strings in the file being written, not commands
# being run here.
active, kept = [], []
for ln in cmd.split('\n'):
    if active:
        s = ln.strip()
        if s in active:
            active.remove(s)
        continue
    kept.append(ln)
    for m in re.finditer(r'<<-?\s*(?:[\'"]([^\'"]+)[\'"]|([A-Za-z_][A-Za-z0-9_]*))', ln):
        active.append(m.group(1) or m.group(2))
scan = '\n'.join(kept)

# 1. Destructive git ops in the main checkout.
if re.search(r'\bgit\s+(?:-[^\s]+\s+)*(?:reset\s+--hard|clean\s+[^|;&]*-[a-zA-Z]*f|checkout\s+(?:-[^\s]+\s+)*--\s|restore\s+\S|switch\s+--discard-changes)', scan):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": "Blocked: destructive git op in the shared MAIN checkout discards uncommitted work — concurrent sessions have lost files this way (REGRESSION_PLAN section 4, twice on 2026-10-12). Commit/stash in a worktree instead, or run the discard yourself in a terminal if you are sure."}}))
    sys.exit(0)

# 2. Redirect / tee targets that resolve into the main checkout.
EXEMPT = [os.path.realpath(os.path.join(root, p)) for p in
          ['.claude', 'CLAUDE.md', 'REGRESSION_PLAN.md', 'AGENTS.md',
           'demo_api_server/.env', 'ping-gateway/.env']]

def is_exempt(p):
    # Directories exempt their whole subtree (.claude/**); files match exactly.
    return any(p == e or p.startswith(e + os.sep) for e in EXEMPT)
targets = []
for m in re.finditer(r'(?:^|[\s;|(])&?>>?\s*(?:"([^"]+)"|\'([^\']+)\'|([^\s;|&<>"\']+))', scan):
    targets.append(next(g for g in m.groups() if g is not None))
for m in re.finditer(r'\btee\s+(?:-a\s+)?(?:--\s+)?(?:"([^"]+)"|\'([^\']+)\'|([^\s;|&<>"\']+))', scan):
    targets.append(next(g for g in m.groups() if g is not None))

for raw in targets:
    tok = raw.strip().strip('"\'')
    if not tok or tok.startswith('$'):
        continue  # variable target — cannot resolve (see header gaps)
    if tok.startswith('~/'):
        tok = os.path.expanduser(tok)
    p = tok if os.path.isabs(tok) else os.path.join(cwd, tok)
    p = os.path.realpath(p)
    if (p == root or p.startswith(root + os.sep)) and not is_exempt(p):
        rel = os.path.relpath(p, root)
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
            "permissionDecisionReason": f"Blocked: shell redirect writes to '{rel}' in the shared MAIN checkout. CLAUDE.md requires edit -> test -> commit in an isolated git worktree (concurrent sessions share one index and have clobbered work repeatedly). Write in a worktree, redirect outside the checkout, or use the Write/Edit tool for exempt paths (.claude/**, CLAUDE.md, .env). Test stubs that shadow repo files must cp -R, never ln -s."}}))
        sys.exit(0)
sys.exit(0)
