# Rename `banking_*` → `demo_*` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all 8 `banking_*` service directories to `demo_*` and update every path reference in scripts, configs, and cross-service `require()` calls without breaking any services, tests, or CI.

**Architecture:** `git mv` renames each directory (preserving file-level history), then `sed -i` updates path-only references in root-level files and cross-service `require()` calls inside source files. Internal string literals (log tags, variable names, comments) are left unchanged.

**Tech Stack:** bash (`git mv`, `sed -i`), Node.js ecosystem (npm scripts, Jest, Playwright), TypeScript services.

---

## File Map

### Directories renamed (git mv)
- `banking_api_server` → `demo_api_server`
- `banking_api_ui` → `demo_api_ui`
- `banking_mcp_server` → `demo_mcp_server`
- `banking_mcp_gateway` → `demo_mcp_gateway`
- `banking_hitl_service` → `demo_hitl_service`
- `banking_agent_service` → `demo_agent_service`
- `banking_mcp_invest` → `demo_mcp_invest`
- `banking_mortgage_service` → `demo_mortgage_service`

### Root-level files updated (path strings only)
- `package.json` — `cd banking_*` and `banking_api_server/scripts/*` entries
- `run-demo.sh` — `SVC_LIST`, `cd "$BASEDIR/banking_*"`, env checks
- `run.sh` — same as run-demo.sh (symlink/copy)
- `run-tests.sh` — `cd "$ROOT/banking_*"`
- `start.sh` — `cd "$BASEDIR/banking_*"`
- `scripts/run-all-tests.sh` — `cd "$ROOT/banking_*"`
- `scripts/build-diagrams.sh` — `banking_api_ui/public/...`
- `scripts/run-node.sh` — `banking_api_server/server.js` check
- `scripts/restore-vercel-env.sh` — `banking_api_server/.env` reads
- `scripts/quick-restore-vercel-env.sh` — same
- `scripts/sync-vercel-env.sh` — comment reference
- `.github/workflows/test.yml` — `working-directory:` and `cache-dependency-path:`
- `.env.example` — comment lines only
- `.env.replit.example` — comment lines only
- `CLAUDE.md` — service path table and commands section
- `scope-topology.json` — any `banking_*` path keys

### Cross-service require() paths updated (load-bearing — will break at runtime if missed)
- `demo_mcp_gateway/src/vault.ts` — `require('../../banking_api_server/lib/vault')` → `../../demo_api_server/lib/vault`
- `demo_mcp_server/src/vault.ts` — same pattern
- `demo_agent_service/src/vault.ts` — `require('../../banking_api_server/lib/vault')` → `../../demo_api_server/lib/vault`
- `demo_mcp_gateway/src/index.ts` — `../../banking_mcp_server/openapi/...` → `../../demo_mcp_server/openapi/...` and `../../banking_mcp_invest/openapi/...` → `../../demo_mcp_invest/openapi/...`

### Not changed
- `.planning/`, `.handoff/`, `docs/`, `.archive/`, `.claude/skills/` — historical docs
- `tests/naming-validation.test.js` — checks for "Ping Identity" strings, not folder names
- Internal variable names, log tag strings, code comments

---

## Task 1: Rename the 8 directories with `git mv`

**Files:** 8 top-level directories renamed

- [ ] **Step 1: Run git mv for all 8 directories**

```bash
cd /Users/curtismuir/Development/AI-Demo
git mv banking_api_server demo_api_server
git mv banking_api_ui demo_api_ui
git mv banking_mcp_server demo_mcp_server
git mv banking_mcp_gateway demo_mcp_gateway
git mv banking_hitl_service demo_hitl_service
git mv banking_agent_service demo_agent_service
git mv banking_mcp_invest demo_mcp_invest
git mv banking_mortgage_service demo_mortgage_service
```

- [ ] **Step 2: Verify git sees the renames**

```bash
git status | grep -E "renamed:|demo_|banking_"
```

Expected: 8 `renamed:` lines, e.g.:
```
renamed:    banking_api_server -> demo_api_server
renamed:    banking_api_ui -> demo_api_ui
...
```

- [ ] **Step 3: Commit the renames**

```bash
git commit -m "refactor: git mv banking_* service dirs to demo_*"
```

---

## Task 2: Update `package.json`

**Files:** Modify `package.json`

- [ ] **Step 1: Apply sed replacement**

```bash
sed -i '' 's|banking_api_server|demo_api_server|g; s|banking_api_ui|demo_api_ui|g; s|banking_mcp_server|demo_mcp_server|g; s|banking_mcp_gateway|demo_mcp_gateway|g; s|banking_hitl_service|demo_hitl_service|g; s|banking_agent_service|demo_agent_service|g; s|banking_mcp_invest|demo_mcp_invest|g; s|banking_mortgage_service|demo_mortgage_service|g' package.json
```

- [ ] **Step 2: Verify no banking_ refs remain**

```bash
grep "banking_" package.json
```

Expected: no output.

- [ ] **Step 3: Sanity check scripts still look sane**

```bash
python3 -c "import sys,json; json.load(open('package.json')); print('valid JSON')"
```

Expected: `valid JSON`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "refactor: update package.json paths banking_* → demo_*"
```

---

## Task 3: Update `run-demo.sh` and `run.sh`

**Files:** Modify `run-demo.sh`, `run.sh`

- [ ] **Step 1: Apply sed to run-demo.sh**

```bash
sed -i '' 's|banking_api_server|demo_api_server|g; s|banking_api_ui|demo_api_ui|g; s|banking_mcp_server|demo_mcp_server|g; s|banking_mcp_gateway|demo_mcp_gateway|g; s|banking_hitl_service|demo_hitl_service|g; s|banking_agent_service|demo_agent_service|g; s|banking_mcp_invest|demo_mcp_invest|g; s|banking_mortgage_service|demo_mortgage_service|g' run-demo.sh
```

- [ ] **Step 2: Apply sed to run.sh**

```bash
sed -i '' 's|banking_api_server|demo_api_server|g; s|banking_api_ui|demo_api_ui|g; s|banking_mcp_server|demo_mcp_server|g; s|banking_mcp_gateway|demo_mcp_gateway|g; s|banking_hitl_service|demo_hitl_service|g; s|banking_agent_service|demo_agent_service|g; s|banking_mcp_invest|demo_mcp_invest|g; s|banking_mortgage_service|demo_mortgage_service|g' run.sh
```

- [ ] **Step 3: Verify no banking_ path refs remain in either file**

```bash
grep "banking_" run-demo.sh run.sh
```

Expected: no output (or only comment/string text that is not a path — none expected).

- [ ] **Step 4: Confirm SVC_LIST looks correct in run-demo.sh**

```bash
grep "SVC_LIST" run-demo.sh
```

Expected:
```
SVC_LIST=(demo_api_server demo_mcp_server demo_api_ui      demo_mcp_gateway demo_hitl_service demo_agent_service demo_mcp_invest demo_mortgage_service)
```

- [ ] **Step 5: Commit**

```bash
git add run-demo.sh run.sh
git commit -m "refactor: update run-demo.sh + run.sh paths banking_* → demo_*"
```

---

## Task 4: Update remaining shell scripts and CI

**Files:** Modify `run-tests.sh`, `start.sh`, `scripts/run-all-tests.sh`, `scripts/build-diagrams.sh`, `scripts/run-node.sh`, `scripts/restore-vercel-env.sh`, `scripts/quick-restore-vercel-env.sh`, `scripts/sync-vercel-env.sh`, `.github/workflows/test.yml`

- [ ] **Step 1: Apply sed to all script files in one pass**

```bash
for f in run-tests.sh start.sh scripts/run-all-tests.sh scripts/build-diagrams.sh scripts/run-node.sh scripts/restore-vercel-env.sh scripts/quick-restore-vercel-env.sh scripts/sync-vercel-env.sh .github/workflows/test.yml; do
  sed -i '' 's|banking_api_server|demo_api_server|g; s|banking_api_ui|demo_api_ui|g; s|banking_mcp_server|demo_mcp_server|g; s|banking_mcp_gateway|demo_mcp_gateway|g; s|banking_hitl_service|demo_hitl_service|g; s|banking_agent_service|demo_agent_service|g; s|banking_mcp_invest|demo_mcp_invest|g; s|banking_mortgage_service|demo_mortgage_service|g' "$f"
done
```

- [ ] **Step 2: Verify no banking_ refs remain**

```bash
grep -l "banking_" run-tests.sh start.sh scripts/run-all-tests.sh scripts/build-diagrams.sh scripts/run-node.sh scripts/restore-vercel-env.sh scripts/quick-restore-vercel-env.sh scripts/sync-vercel-env.sh .github/workflows/test.yml 2>/dev/null
```

Expected: no output (no files listed).

- [ ] **Step 3: Commit**

```bash
git add run-tests.sh start.sh scripts/run-all-tests.sh scripts/build-diagrams.sh scripts/run-node.sh scripts/restore-vercel-env.sh scripts/quick-restore-vercel-env.sh scripts/sync-vercel-env.sh .github/workflows/test.yml
git commit -m "refactor: update shell scripts + CI paths banking_* → demo_*"
```

---

## Task 5: Update env examples, CLAUDE.md, and scope-topology.json

**Files:** Modify `.env.example`, `.env.replit.example`, `CLAUDE.md`, `scope-topology.json`

- [ ] **Step 1: Apply sed to env/doc files**

```bash
for f in .env.example .env.replit.example CLAUDE.md scope-topology.json; do
  [ -f "$f" ] && sed -i '' 's|banking_api_server|demo_api_server|g; s|banking_api_ui|demo_api_ui|g; s|banking_mcp_server|demo_mcp_server|g; s|banking_mcp_gateway|demo_mcp_gateway|g; s|banking_hitl_service|demo_hitl_service|g; s|banking_agent_service|demo_agent_service|g; s|banking_mcp_invest|demo_mcp_invest|g; s|banking_mortgage_service|demo_mortgage_service|g' "$f"
done
```

- [ ] **Step 2: Verify no banking_ refs remain in those files**

```bash
grep "banking_" .env.example .env.replit.example CLAUDE.md scope-topology.json 2>/dev/null
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add .env.example .env.replit.example CLAUDE.md scope-topology.json
git commit -m "refactor: update env examples + CLAUDE.md + scope-topology paths"
```

---

## Task 6: Fix cross-service `require()` paths (load-bearing)

These three `vault.ts` files and one `index.ts` contain runtime `require()` calls with hardcoded sibling-directory paths. They will crash at startup if not updated.

**Files:**
- Modify `demo_mcp_gateway/src/vault.ts`
- Modify `demo_mcp_server/src/vault.ts`
- Modify `demo_agent_service/src/vault.ts`
- Modify `demo_mcp_gateway/src/index.ts`

- [ ] **Step 1: Fix demo_mcp_gateway/src/vault.ts**

```bash
sed -i '' "s|../../banking_api_server/lib/vault|../../demo_api_server/lib/vault|g" demo_mcp_gateway/src/vault.ts
```

Verify:
```bash
grep "banking_api_server" demo_mcp_gateway/src/vault.ts
```
Expected: no output.

- [ ] **Step 2: Fix demo_mcp_server/src/vault.ts**

```bash
sed -i '' "s|../../banking_api_server/lib/vault|../../demo_api_server/lib/vault|g" demo_mcp_server/src/vault.ts
```

Verify:
```bash
grep "banking_api_server" demo_mcp_server/src/vault.ts
```
Expected: no output.

- [ ] **Step 3: Fix demo_agent_service/src/vault.ts**

```bash
sed -i '' "s|../../banking_api_server/lib/vault|../../demo_api_server/lib/vault|g" demo_agent_service/src/vault.ts
```

Verify:
```bash
grep "banking_api_server" demo_agent_service/src/vault.ts
```
Expected: no output.

- [ ] **Step 4: Fix demo_mcp_gateway/src/index.ts openapi paths**

```bash
sed -i '' "s|../../banking_mcp_server/openapi/|../../demo_mcp_server/openapi/|g; s|../../banking_mcp_invest/openapi/|../../demo_mcp_invest/openapi/|g" demo_mcp_gateway/src/index.ts
```

Verify:
```bash
grep "banking_mcp_server\|banking_mcp_invest" demo_mcp_gateway/src/index.ts
```
Expected: no output (only comment text may remain, which is acceptable).

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/vault.ts demo_mcp_server/src/vault.ts demo_agent_service/src/vault.ts demo_mcp_gateway/src/index.ts
git commit -m "refactor: fix cross-service require() paths banking_* → demo_*"
```

---

## Task 7: Verify — sweep for missed path references

- [ ] **Step 1: Grep for any remaining load-bearing banking_ path refs**

```bash
grep -rn "banking_api_server\|banking_api_ui\|banking_mcp_server\|banking_mcp_gateway\|banking_hitl_service\|banking_agent_service\|banking_mcp_invest\|banking_mortgage_service" \
  . \
  --include="*.sh" --include="*.json" --include="*.ts" --include="*.js" --include="*.yml" --include="*.yaml" \
  2>/dev/null \
  | grep -v "node_modules\|/dist/\|\.archive/\|\.planning/\|\.handoff/\|docs/\|\.claude/skills/\|\.git/"
```

Expected: only comment/string-literal lines (not `cd`, `require`, `working-directory:`, or path-style references). Any path-style hit is a bug — fix it with the same `sed` pattern before proceeding.

- [ ] **Step 2: Confirm the 8 directories exist with new names and old names are gone**

```bash
ls -d demo_api_server demo_api_ui demo_mcp_server demo_mcp_gateway demo_hitl_service demo_agent_service demo_mcp_invest demo_mortgage_service
ls -d banking_api_server banking_api_ui banking_mcp_server banking_mcp_gateway banking_hitl_service banking_agent_service banking_mcp_invest banking_mortgage_service 2>&1
```

Expected: first command lists all 8 dirs. Second command: `ls: cannot access ...` for every old name.

---

## Task 8: Build and test verification

- [ ] **Step 1: Build the UI (must exit 0)**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.` and exit code 0. If it fails, check for any `banking_api_ui` import paths inside the React source (there shouldn't be any since those are internal to the folder).

- [ ] **Step 2: Build TypeScript services**

```bash
cd ../demo_mcp_server && npm run build 2>&1 | tail -5
cd ../demo_mcp_gateway && npm run build 2>&1 | tail -5
cd ../demo_agent_service && npm run build 2>&1 | tail -5
cd ../demo_mcp_invest && npm run build 2>&1 | tail -5
```

Expected: each exits 0.

- [ ] **Step 3: Run the core test suite from repo root**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm run test:api-server
npm run test:mcp-server
npm run test:ui
```

Expected: all pass. If a test fails with `Cannot find module '../../banking_api_server/...'`, that's a test file with a hardcoded cross-service path — apply the same `sed` fix and add to the Task 6 commit (or a new commit).

- [ ] **Step 4: Run the naming validation test (should be unaffected)**

```bash
npx jest tests/naming-validation.test.js --forceExit
```

Expected: all 7 tests pass. This test checks for "Ping Identity" strings, not folder names — no changes needed.

- [ ] **Step 5: Commit any fixes found during testing**

If any test fixes were needed:
```bash
git add <affected files>
git commit -m "refactor: fix test path refs banking_* → demo_*"
```

---

## Task 9: Final commit and CLAUDE.md update

- [ ] **Step 1: Confirm CLAUDE.md service table reflects new paths**

Open [CLAUDE.md](CLAUDE.md) and verify the repository map table (around the "Repository map" section) shows `demo_api_ui/`, `demo_api_server/`, etc. The `sed` in Task 5 should have handled this — spot-check the table.

- [ ] **Step 2: Update the `run.sh` memory note**

Check the memory file at `/Users/curtismuir/.claude/projects/-Users-curtismuir-Development-AI-Demo/memory/feedback_run_sh.md` — it references `./run.sh`. No path change needed there (run.sh filename is unchanged).

- [ ] **Step 3: Final clean grep sweep**

```bash
grep -rn "banking_api_server\|banking_api_ui\|banking_mcp_server\|banking_mcp_gateway\|banking_hitl_service\|banking_agent_service\|banking_mcp_invest\|banking_mortgage_service" \
  . \
  --include="*.sh" --include="*.json" --include="*.ts" --include="*.js" --include="*.yml" \
  2>/dev/null \
  | grep -v "node_modules\|/dist/\|\.archive/\|\.planning/\|\.handoff/\|docs/\|\.claude/skills/\|\.git/" \
  | grep -v "^\./\(demo_\|test-\|fix-\|scope-\)" \
  | grep -E "cd |require\(|working-directory|cache-dependency-path|SVC_LIST"
```

Expected: no output. This confirms no load-bearing path references remain.

- [ ] **Step 4: Tag the rename complete**

```bash
git log --oneline -8
```

Review the 8 commits that make up this rename (Tasks 1–6 + any fixes). No further action needed — the rename is done.
