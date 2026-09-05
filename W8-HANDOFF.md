# Handoff — MCP lanes W8 (door discovery) and what surrounds it

Last updated 2026-09-05, after W8 merged. Read this before touching
`privilegeMcpClient.js`, the Door picker, or the `mcp-facade` doors.

**The rule this session learned the hard way: unpushed work is invisible.** Two
reviewed-clean commits were lost because they lived only on one Mac's disk.
Every other environment reads from `origin` and nothing else. Push before idling.

---

## Source of truth

| | |
|---|---|
| Spec | `docs/superpowers/specs/2026-09-04-mcp-lanes-and-privilege-llm-design.md` — 8 workstreams, W1–W8 |
| Plan A (merged) | `docs/superpowers/plans/2026-09-04-mcp-lanes-plan-a-visibility.md` |
| Plan B | **does not exist on origin.** Drafted on an unpushed branch and gone. W8 was reimplemented from the spec. |

## Workstream state

| | Workstream | State |
|---|---|---|
| W1 | Preflight CLI (`npm run demo:preflight`) | merged, #2794 |
| W2 | Gateway session visible + one-click re-arm | merged, #2794 (`gatewaySession` in `/state`) |
| W7 | `DELETE` bug on multi-app façade doors | merged, #2794 |
| W4 | Reconcile LM Studio config | merged, #2804 + #2808 |
| W8 | Door discovery from the Privilege console | **merged, #2810 (`c17e6e2c`)** |
| **W3** | **Register banking as an Agentic App** | **not started — do this next** |
| W5 | Privilege LLM protection panel + OpenAI lane | not started; needs an OpenAI virtual key from the console |
| W6 | Reproducible config (virtual keys via the secrets path) | not started |

Spec §6 put **W8 before W3** because registering the banking app is W8's live
proof: it should appear as a selectable door after one refresh with no code
change. That is spec §7 criterion 7, **and it is the one part of W8 nobody has
verified** — it needs Privilege console access.

---

## What W8 landed

`demo_api_server/services/lmdb/privilegeDoorStore.lmdb.js` (new) — single key
`inventory`. Discovery writes it; everything that *serves* a door reads it. It
exists because the console API's only credential is an `auth_token` cookie an
operator pastes out of a browser session, good for ~1h. Serving a door must not
depend on the credential that discovered it; only re-discovery does. The token
is never written — app names and status are configuration, not secrets.

`routes/privilegeMcpClient.js`:

- `consoleInventory()` emits three URLs per app — `mcpUrl` (mode-relative,
  legacy), **`facadeUrl`** and **`gatewayUrl`**, the latter two derived from
  configuration and independent of whatever door was selected at discovery time
- `/console/connect` and `/console/inventory` persist and report counts
- `/state` derives the **sibling** presets from the store with a fallback, and
  reports `doorDiscovery` including each app's `status` and the policies that
  mention it
- `readInventory()` guards the read: a store failure or a malformed record
  degrades to the fallback doors instead of 500ing `/state`

`demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` — `knownDoors()` picks the
lane-specific URL, and Direct mode contributes nothing from the console.

### Three URL-derivation bugs fixed along the way

All three came from deriving a door URL from *whatever door was selected when
the console was read*, which `consoleData` then outlives:

1. **Façade mode** took the ORIGIN of `/mcp-facade/privilege-gateway/<app>/mcp`,
   dropping the prefix and offering `<public-origin>/<app>/mcp` — reaches nothing.
2. **Mode switches** served a list discovered under one mode in another.
3. **Direct mode** has no correct console-derived URL at all. It used to offer
   the gateway URL, which the denial probe (no origin filter) could switch to
   while leaving the client in Direct mode — mismatching mode and auth path.

---

## Deliberate design calls — do not undo without reading why

1. **Dedicated LMDB store, not `configStore`** — deviates from the spec's
   wording. `configStore` is schema-validated app config *and secrets*
   (`FIELD_DEFS`, `SECRET_KEYS`, a masked surface sent to the browser); a
   discovered app list is a data blob. Owner confirmed before writing it.
2. **`mcpUrl` keeps its mode-relative meaning**; `facadeUrl` and `gatewayUrl`
   were *added* beside it. `tests/routes/privilegeConsoleInventory.test.js:120-123`
   pins the old derivation and passes **unchanged** — keep it that way. The UI
   no longer reads `mcpUrl`.
3. **Direct mode contributes NOTHING from the console.** A discovered app is a
   Privilege Agentic App; "direct" means no Privilege in the path at all, and the
   direct doors are this demo's own façade doors, which `presets` already
   supplies. There is no correct console-derived URL for that lane, only two
   wrong ones. **This is the guard most likely to be innocently removed.**
4. **Only the sibling presets are dynamic.** The numbered presets (`1 · Direct`,
   `2 · Privilege`, `3 · Privilege — through the façade`) are the demo script.
   Do not make them dynamic.
5. **The no-discovery fallback keeps the env overrides** —
   `PRIVILEGE_MCPGW_OPENSEARCH_URL`, `PRIVILEGE_FACADE_BRAVE_URL`, etc. An
   existing deployment must see no change until someone connects the console.
6. **Failures are reported, never swallowed.** A write failure reports
   `persisted: false` ("discovered but only for this session" is the exact
   behaviour W8 removes); a read failure degrades to the fallback doors rather
   than taking out the one screen an operator would use to diagnose the store.
7. **Every suite that touches the store doubles it; none writes real LMDB.** The
   store keeps one key under a per-worker dir, so two suites in the same worker
   clobber each other — and `privilegeMcpClient.state.test.js` asserts on the
   exact sibling labels `/state` derives from that key, so the damage lands in a
   different file as an unexplained failure. Not hypothetical: see below.

---

## Verification at merge

```
CI=true npx jest tests/routes/privilegeConsoleInventory.test.js \
  tests/routes/privilegeDoorDiscovery.test.js \
  tests/services/privilegeDoorStore.test.js \
  'tests/routes/privilegeMcpClient\..*\.test\.js' --runInBand --no-cache
  -> 24 suites / 108 tests passed, exit 0

npx vitest run src/pages/__tests__/  -> 60 files / 319 tests passed, exit 0
npm run build                        -> exit 0
biome lint (changed + new files)     -> exit 0
Full CI green on 7fa8815cb, Greptile Review included.
```

Guards were proven able to **fail**, not just to pass: reintroducing the
façade-URL bug reds 1 test; disabling persistence reds 4, including *"doors
outlive the console session that discovered them"*; removing `readInventory()`
reds 2.

---

## The CI failure this branch hit, and why

Read this before adding a test near this code. The first full run went red on
ONE test, in a file the PR did not touch: `privilegeMcpClient.state.test.js` saw
`Privilege — cmuir` / `Privilege — external` where it asserts the fallback
`opensearch` / `brave` pair.

Those names exist only in `privilegeConsoleInventory.test.js`'s fixture. That
suite exercises `/console/connect`, which W8 made PERSIST — and the store keeps
a single key under a **per-worker** LMDB dir (`src/__tests__/setup/lmdbTestDir.js`)
shared by every suite jest puts in that worker. One file's fixture leaked into
another file's assertions.

Fixed by doubling the store in that suite too; its own assertions are unchanged.
**Any future suite exercising `/console/connect` or `/console/inventory` needs
the same double** — there is a comment saying so at the top of each.

Reproducing it takes one jest invocation with the writing suite ordered first
(`globalSetup` wipes the LMDB base per run, so two sequential invocations hide
it):

```
CI=true npx jest tests/routes/privilegeConsoleInventory.test.js \
  tests/routes/privilegeMcpClient.state.test.js --runInBand --no-cache
```

---

## Next actions, in order

1. **Sync the shared main checkout** — `scripts/sync-main-checkout.sh`. Docker
   bind-mounts it, so the running demo serves pre-W8 code until something pulls.
2. **Prove W8 live.** Register an Agentic App in the Privilege console, click
   refresh once, confirm it appears as a selectable door with no redeploy. This
   is spec §7 criterion 7 and the only unverified part of W8.
3. **W3 — register banking as an Agentic App.** Same act as step 2, so it does
   double duty. Open question from spec §8: which banking MCP server backs it —
   `oauth-mcp` (`mcp-server:8080`) or the Node gateway — given the gateway
   registers an SSE backend. `oauth-mcp` gained legacy HTTP+SSE transport in
   #2802, so it can serve a `/sse` backend URL now.
4. **W5 / W6** — both blocked on an OpenAI virtual key from the Privilege console.

## Loose ends nobody has closed

- **No UI test seeds `consoleData.applications`**, so `knownDoors()`'s
  lane-selection expression — design call 3 above — has no direct coverage. The
  server-side contract it rests on is covered in
  `tests/routes/privilegeDoorDiscovery.test.js`. Adding UI coverage means driving
  the console-connect flow through the page.
- `demo_api_ui/tests/e2e/librechat-mcp-servers.real.spec.js` still probes the
  Priv Agent frontend on `:8643`, deleted infrastructure. Deletion recommended,
  not done — deleting a test unprompted is not an agent's call.
- `/api/mcp/inspector/pingone-admin/login` returns a raw JSON 401 to a browser
  instead of redirecting to sign-in with `returnTo`. Small and self-contained.
- `origin/claude/drop-dead-agent-doors` — 3 commits that look unmerged only
  because #2804 squash-merged them. Verified content-identical (merge-base
  `cefdcefa8`, same 8 files as `b8fdd9590`). **Safe to delete; do not open a PR.**

## Environment gotchas that cost time

- A cloud agent runs in **its own container**, not on the user's Mac. Their
  worktrees, `.git` objects and uncommitted files are unreachable from it. Only
  `origin` is shared — which is why the two Plan B commits could not be recovered.
- Worktrees have **no `node_modules`**, and `scripts/bootstrap-worktree.sh` links
  them from the main checkout — which in a fresh container has none either. A
  real `npm ci` in the service directory is needed before the UI gates will run.
- `vault.failClosed.test.js` (3 tests) fails in a container and passes in CI: the
  container runs as **root**, which bypasses `chmod 0444`. Not a defect; do not
  chase it.
- Never conclude from a piped command's exit status — redirect to a file and read
  the file.
