# Handoff — MCP lanes W8 (door discovery) and what surrounds it

Written 2026-09-05. Read this before touching `privilegeMcpClient.js`, the
Door picker, or the `mcp-facade` doors.

**The one rule this session learned the hard way: unpushed work is invisible.**
Two reviewed-clean commits were lost because they lived only on one Mac's disk.
Every environment reads from `origin` and nothing else. Push before idling.

---

## Source of truth

| | |
|---|---|
| Spec | `docs/superpowers/specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md` — 8 workstreams, W1–W8 |
| Plan A (merged) | `docs/superpowers/plans/2026-09-04-mcp-lanes-plan-a-visibility.md` |
| Plan B | **does not exist on origin.** It was drafted on an unpushed branch and is gone. W8 was reimplemented from the spec. |

## Workstream state

| | Workstream | State |
|---|---|---|
| W1 | Preflight CLI (`npm run demo:preflight`) | merged, #2794 |
| W2 | Gateway session visible + one-click re-arm | merged, #2794 (`gatewaySession` in `/state`) |
| W7 | `DELETE` bug on multi-app façade doors | merged, #2794 |
| W4 | Reconcile LM Studio config | merged, #2804 + #2808 |
| **W8** | **Door discovery from the Privilege console** | **PR #2810, open, CI in flight** |
| W3 | Register banking as an Agentic App | **not started — do this next** |
| W5 | Privilege LLM protection panel + OpenAI lane | not started; needs an OpenAI virtual key from the console |
| W6 | Reproducible config (virtual keys via the secrets path) | not started |

Spec §6 sequencing: **W8 before W3.** Registering the banking app is the live
proof W8 works — it should appear as a door after one refresh with no code
change. That is spec §7 criterion 7 and the only part of W8 not yet verified.

---

## PR #2810 — what is on the branch

Branch `claude/mcp-lanes-w8-door-discovery`, base `main`, draft.

| commit | what |
|---|---|
| `f8be7c3a5` | groundwork: door store + URL helpers, nothing wired |
| `4dcbcddd1` | `lmstudio/README.md` — five claims #2804/#2808 falsified |
| `c3dc9f239` | the actual W8 implementation + tests |

### What it changed

- **`demo_api_server/services/lmdb/privilegeDoorStore.lmdb.js`** (new) — single
  key `inventory`. Discovery writes it; everything that *serves* a door reads
  it. Exists because the console API's only credential is an `auth_token`
  cookie an operator pastes out of a browser session, good for ~1h, so serving
  a door must not depend on the credential that discovered it.
- **`routes/privilegeMcpClient.js`** — `consoleInventory()` now emits an
  explicit `facadeUrl` per app; `/console/connect` and `/console/inventory`
  persist and report counts; `/state` derives the **sibling** presets from the
  store with a fallback, and reports `doorDiscovery`.
- **`demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`** — `knownDoors()` picks
  `facadeUrl` vs `mcpUrl` by mode.

### The latent bug it fixed

`consoleInventory()` derived each app's URL from the origin of *whatever door
was currently selected*. Correct for the gateway. In façade mode
`config.mcpUrl` is `<public-origin>/mcp-facade/privilege-gateway/<app>/mcp`, so
taking its **origin** dropped the prefix and produced `<public-origin>/<app>/mcp`
— a door reaching nothing, fed straight into the picker.

### Deliberate design calls (do not undo without reading why)

1. **Dedicated LMDB store, not `configStore`** — deviates from the spec's
   wording. `configStore` is schema-validated app config *and secrets*
   (`FIELD_DEFS`, `SECRET_KEYS`, a masked surface sent to the browser); a
   discovered app list is a data blob. Owner confirmed.
2. **`mcpUrl` keeps its mode-relative meaning**; `facadeUrl` was *added*.
   `tests/routes/privilegeConsoleInventory.test.js:120-123` pins the old
   derivation and passes **unchanged** — keep it that way.
3. **Only the sibling presets are dynamic.** The numbered presets
   (`1 · Direct`, `2 · Privilege`, `3 · Privilege — through the façade`) are the
   demo script. Do not make them dynamic.
4. **The no-discovery fallback keeps the env overrides** —
   `PRIVILEGE_MCPGW_OPENSEARCH_URL`, `PRIVILEGE_FACADE_BRAVE_URL`, etc. An
   existing deployment must see no change until someone connects the console.
5. **A store write failure reports `persisted: false`**, never success —
   "discovered but only for this session" is the exact behaviour W8 removes.
6. **Every suite that touches the store doubles it; none writes real LMDB.**
   The store keeps one key under a per-worker dir, so two suites in the same
   worker clobber each other — and `privilegeMcpClient.state.test.js` asserts on
   the exact sibling labels `/state` derives from that key, so the damage lands
   in a different file as an unexplained failure. That is not hypothetical: it
   is the CI failure described below.

### Verification already done

```
CI=true npx jest tests/routes/privilegeConsoleInventory.test.js \
  tests/routes/privilegeDoorDiscovery.test.js \
  tests/services/privilegeDoorStore.test.js \
  'tests/routes/privilegeMcpClient\..*\.test\.js' --runInBand --no-cache
  -> 24 suites / 104 tests passed, exit 0

npx vitest run (doorPicker, denialDoor, gatewaySwitch) -> 16 passed, exit 0
npm run build                                          -> exit 0
biome lint (all changed + new files)                   -> exit 0
```

Both new guards were proven able to **fail**, not just pass: reintroducing the
façade-URL bug reds 1 test; disabling persistence reds 4, including *"doors
outlive the console session that discovered them"*.

### The CI failure this branch already hit, and why

The first full CI run went red on ONE test, in a file this PR does not touch:
`privilegeMcpClient.state.test.js` saw `Privilege — cmuir` / `Privilege —
external` where it expects the fallback `opensearch` / `brave` pair.

Those two names exist only in `privilegeConsoleInventory.test.js`'s fixture.
That suite exercises `/console/connect`, which W8 made PERSIST -- and the store
keeps a single key under a **per-worker** LMDB dir (`src/__tests__/setup/
lmdbTestDir.js`), shared by every suite jest puts in that worker. So one file's
fixture leaked into another file's assertions.

Fixed by doubling the store in that suite too; its own assertions are unchanged.
**Any future suite that exercises `/console/connect` or `/console/inventory`
needs the same double** -- there is a comment saying so at the top of both.

Reproducing it needs one jest invocation with the writing suite ordered first
(`globalSetup` wipes the LMDB base per run, so two sequential invocations hide
it):

```
CI=true npx jest tests/routes/privilegeConsoleInventory.test.js \
  tests/routes/privilegeMcpClient.state.test.js --runInBand --no-cache
```

### Not verified

Live end-to-end. Needs Privilege console access: register an app, click one
refresh, confirm it appears as a selectable door with no redeploy.

---

## Next actions, in order

1. **Confirm #2810's CI is green, then merge.**
2. **W3 — register banking as an Agentic App** on the AI Gateway. This is both
   the next workstream and W8's live proof. Open question from spec §8: which
   banking MCP server backs it — `oauth-mcp` (`mcp-server:8080`) or the Node
   gateway — given the gateway registers an SSE backend. `oauth-mcp` gained
   legacy HTTP+SSE transport in #2802, so it can serve a `/sse` backend URL now.
3. **W5 / W6** — both blocked on the user supplying an OpenAI virtual key from
   the Privilege console.

## Loose ends this session did not close

- `demo_api_ui/tests/e2e/librechat-mcp-servers.real.spec.js` still probes the
  Priv Agent frontend on `:8643`, deleted infrastructure. Recommended deletion;
  not done, because deleting a test unprompted is not the agent's call.
- `/api/mcp/inspector/pingone-admin/login` returns a raw JSON 401 to a browser
  instead of redirecting to sign-in with `returnTo`. Small, self-contained.
- `origin/claude/drop-dead-agent-doors` — 3 commits that look unmerged only
  because #2804 squash-merged them. Verified content-identical (merge-base
  `cefdcefa8`, same 8 files as `b8fdd9590`). **Safe to delete; do not open a PR.**

## Environment gotchas that cost time

- This is a **cloud container**, not the user's Mac. Their worktrees, their
  `.git` objects and their uncommitted files are unreachable. Only `origin` is
  shared.
- Worktrees have **no `node_modules`**, and `scripts/bootstrap-worktree.sh`
  links from the main checkout — which in this container has none either. A
  real `npm ci` in the service directory is needed before UI gates will run.
- `vault.failClosed.test.js` (3 tests) fails locally and passes in CI: the
  container runs as **root**, which bypasses `chmod 0444`. Not a defect, do not
  chase it.
- Never conclude from a piped command's exit status — redirect to a file and
  read the file.
