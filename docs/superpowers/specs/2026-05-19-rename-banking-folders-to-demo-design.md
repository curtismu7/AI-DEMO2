# Design: Rename `banking_*` Folders to `demo_*`

**Date:** 2026-05-19  
**Status:** Approved  
**Approach:** Option A — `git mv` + targeted `sed`

---

## Goal

Rename the 8 `banking_*` service directories to `demo_*` without breaking any running services, tests, or scripts. Path references in scripts, configs, and source files are updated. Internal string literals (log tags, variable names, comments) are left unchanged.

---

## Folder Mapping

| Old name | New name |
|---|---|
| `banking_api_server` | `demo_api_server` |
| `banking_api_ui` | `demo_api_ui` |
| `banking_mcp_server` | `demo_mcp_server` |
| `banking_mcp_gateway` | `demo_mcp_gateway` |
| `banking_hitl_service` | `demo_hitl_service` |
| `banking_agent_service` | `demo_agent_service` |
| `banking_mcp_invest` | `demo_mcp_invest` |
| `banking_mortgage_service` | `demo_mortgage_service` |
| `langchain_agent` | *(unchanged — no banking_ prefix)* |

---

## What Changes

### 1. Folder renames (`git mv`)

Eight `git mv` calls, one per directory. `git mv` tracks the rename so per-file history is preserved.

### 2. Root-level files — path string updates (`sed`)

| File | What changes |
|---|---|
| `package.json` | `cd banking_*` in all script entries |
| `run-demo.sh` | `SVC_LIST` array, `BASEDIR/banking_*` checks, test block `cd` calls |
| `run.sh` | Same pattern as `run-demo.sh` |
| `run-tests.sh` | `cd banking_*` |
| `start.sh` | Any `banking_*` dir references |
| `CLAUDE.md` | Service table (path column), commands section |
| `.env.example` | Comment lines referencing folder names |
| `.env.replit.example` | Same |
| `.github/workflows/test.yml` | `working-directory:` and `cache-dependency-path:` entries |
| `scope-topology.json` | Any `banking_*` path keys |

### 3. Cross-service `require` paths — the load-bearing ones

These files contain **runtime `require()` calls** that cross into a sibling directory and will break at startup if not updated:

| File | Load-bearing reference |
|---|---|
| `demo_mcp_gateway/src/vault.ts` | `require('../../banking_api_server/lib/vault')` → `../../demo_api_server/lib/vault` |
| `demo_mcp_server/src/vault.ts` | Same pattern |
| `demo_agent_service/src/vault.ts` | `require('../../banking_api_server/lib/vault')` → `../../demo_api_server/lib/vault` |
| `demo_mcp_gateway/src/index.ts` | `join(__dirname, '../../banking_mcp_server/openapi/...')` and `../../banking_mcp_invest/openapi/...` |
| `demo_mcp_gateway/src/auth/scopeTopology.ts` | Path comment `../../../` is relative, no string to change |

### 4. Runtime log strings and comments — NOT changed

Strings like `'server: banking_mcp_server'`, `'source: banking_mortgage_service'`, `'backend: banking_mortgage_service'` in JSON payloads or log output, and code comments, are left as-is. Scope: folders and paths only.

---

## What Does NOT Change

- `.planning/`, `.handoff/`, `docs/`, `.archive/` — historical docs, not runtime paths
- `.claude/skills/` — skill docs, not runtime paths  
- `tests/naming-validation.test.js` — references string literals, not paths; review separately
- Internal variable names, function names, class names
- Log tag strings and comment text inside source files

---

## Verification Criteria (definition of done)

1. `grep -r "banking_api_ui\|banking_api_server\|banking_mcp_server\|banking_mcp_gateway\|banking_hitl_service\|banking_agent_service\|banking_mcp_invest\|banking_mortgage_service" . --include="*.sh" --include="*.json" --include="*.ts" --include="*.js" | grep -v "node_modules\|dist/\|\.archive\|\.planning\|\.handoff\|docs/\|\.claude/skills"` returns zero hits for path-style references (i.e. no `cd banking_*`, no `require('../../banking_*')`).
2. `cd demo_api_ui && npm run build` exits 0.
3. `npm test` from repo root passes (same suite as before).
4. `./run.sh status` shows all services healthy.
5. `tests/naming-validation.test.js` reviewed — update or skip if it hard-codes old folder names as expected values.

---

## Execution Order

1. `git mv` all 8 directories (one commit or staged together).
2. `sed` root-level files (package.json, run-demo.sh, run.sh, run-tests.sh, start.sh, CLAUDE.md, .env.example, .env.replit.example, .github/workflows/test.yml, scope-topology.json).
3. Update cross-service `require()` paths in the 3 vault files and the gateway index.
4. Check `tests/naming-validation.test.js` — update expected values to `demo_*`.
5. Run verification criteria above.
6. Single commit: `refactor: rename banking_* service dirs to demo_*`.
