# Handoff 2026-10-13 — Privilege docs runbooks, plus what every agent was doing

Written so VS Code can be restarted. Source for the other agents' state: their
transcripts in `~/.claude/projects/` (first read ~17:08, last refreshed ~19:50 local); **their state may
have moved — verify before acting on it.** No secret values are in this file.

## 0. Session status (latest — 2026-10-14)

- **Claude Code account: SE** (`cmuir@demoauthn.pingidentity.cloud`, org "Ping Identity
  Corporation - SE Demo"). Re-check with `claude auth status` after any VS Code restart.
- **Cluster:** kubectl context `us`; frontend and BFF in `ping-devops-cmuir` were
  promoted to the CI-built `sha-0564d0222…` images (includes #1254, the AIC token
  exchange). Rollback targets if needed: frontend `sha-7138f39ea`, BFF `sha-f6847f720`.
  Other sessions deploy to the same deployments — re-read the image before assuming.
- **MCP servers: keep ALL of them.** The "pick 3-5, freeze the rest" idea is **on hold**
  (spec marked, PR #1266); nothing was frozen or removed. See memory `mcp-standardization-on-hold`.
- **GitHub:** every session pushes as `cmuir_pingcorp`, so **no PR can be approved from
  this account** ("Can not approve your own pull request") — the user merges.
- **Console access recipe (no login needed):** a fresh headless Playwright (Python) opens
  `https://local.procyon.ai:8643` (Privilege desktop app must be running) and calls
  `/api/<tenant>/v1/...` from page context. Keys must never be printed — write them to a
  `chmod 600` file and delete it.
- **Permission grants need the user's explicit OK:** creating a `pacpolicys` rule that
  grants an agent key access to an app is blocked by the auto-mode classifier until the
  user approves in chat (done once for feature 15). Feature 20's grant still needs that.
- **Still needs the user:** rotate the five printed keys; the `/aic-token-exchange`
  signed-in click-through; approve the feature 20 grant; review #1265/#1267/#1268.

## 0b. New workstream, 2026-10-19: PF-token claims → Cedar (AI policy) via the gateway

**Status: scoped and researched only. Nothing built, nothing changed on the console, no commits.**
(Sections 1–3 below are as of 2026-10-14 and are stale; this section is newer.)

**The ask (user, 2026-10-19):** work out how to set up Privilege so that claims in the token
coming in from PingFederate are what Cedar (AI policy) protects on; write docs and diagrams
showing how; and set it up through the Privilege gateway.

**What the repo already has (checked 2026-10-19):**
- Cedar / AI-policy material exists only for tool and LLM rules: `privilege/GATEWAY-RELEASE-v1.261009-DEMO.md`
  (PII withhold), `docs/superpowers/plans/2026-10-12-v1.261009-demo-steps.md` (§2.1–2.4: editor at
  `/ui/admin/ai-policys`, Active vs Candidate), `privilege/AGENT-APPROVALS-DEMO.md` (`agentapprovals` = Cedar per-call).
- **No doc shows a PF-token claim reaching a Cedar rule.** The only Cedar vocabulary on record is
  `Action::"mcp:Invoke"`, `Tool::"…"`, `context.args` (from the editor's example). No `context.claims`
  or `principal.*` attribute is documented anywhere in the repo.
- Older notes (`privilege/PRIVILEGE-MCP.md` ~L796, ~L1843–1870, written Aug 2026, may be stale): an
  Agentic App has `ResourceOAuth` (outbound challenge + DCR only, not inbound issuer trust) and no
  inbound-issuer field; the one untested lever was tenant-level `cyctl object idprovider create`
  (`IDProvider → OidcServer → IssuerPublicKey`, inferred, never tried). The Oct work (HITL, PII) shows
  AI policies do enforce, so re-test before trusting these.
- Related memory: `ping-idjag-dpop-pf-only`, `id-jag-pf-missing-kid-proven`, `ai-demo2-opensearch-hitl-demo`
  (AI policies live in `aipolicys`, not `pacpolicys`; API-created policies land with `State:''` and
  must be PUT to `Active` or they are never enforced).

**Answered 2026-10-20 (user):** the PF claim that decides allow / hold / deny is **group or user**
(i.e. the `groups` claim, or the user's identity such as `sub` / email). The user first ticked scope,
group and `act` / ID-JAG in a multi-select, then narrowed it to "group or user" in a follow-up, so
treat that follow-up as the answer. Still open: which tools, and which groups or users, map to
allow / hold / deny. Ask for that mapping before writing rules. The kit's PF already issues
`groups` as a list and `email_verified` as a boolean in the ID token (see the ID-JAG roadmap).
Nothing is built yet, and nothing on the console has changed.

**Proposed approach once answered (unapproved):**
1. Find out empirically what the gateway exposes from a PF-issued token to Cedar: read the editor's
   vocabulary on the live console, author a throwaway rule per candidate attribute, and watch the
   gateway log (`mcp_policy_denied` / `mcp_policy_approval_required`, `PolicyIDs`).
2. Write the doc (`privilege/` MD) from what was measured, not inferred; update both indexes
   (`privilege/DOCUMENTATION-INDEX.md` and `PrivilegeDocsIndexPage.jsx`) and the Drive copy, per
   `privilege-docs-workflow`.
3. ReactFlow diagram via `EmbeddedFlowDiagram` + a `config/*Diagram.js` (movable boxes, Simulate, Reset,
   speed), registered in `config/__tests__/embeddedDiagrams.test.js`, on its page + `/diagrams` +
   a Learning Hub card (synced trio).
4. Live setup changes (policy create/PUT, IdP registration) are state changes on the shared tenant:
   get the user's explicit OK first; the classifier blocks credential and grant writes without it.

**Tooling traps hit this session:** macOS has no `timeout` (a `timeout 90 grep …` pipeline returned empty
silently); zsh errors on unquoted `--include=*.md` globs; use `rg` (installed). Empty grep output
earlier looked like "no Cedar docs" and was wrong, so re-run with `rg`.

**Repo state:** main checkout is 4 commits behind origin, with unrelated staged edits
(`HostileMcpTab.jsx` + test) and untracked `planning/cloudflare-hybrid-migration.md`. This file edit is
uncommitted; commit from a worktree, not the shared checkout.

## 1. Privilege docs session ("Privilege agent features doc") — this session

### Done and merged

| PR | What |
|---|---|
| #1239 | Master index `docs/privilege-agent-features.md`: features 11–21 ("Beyond the ten") |
| #1241 | In-app Privilege Docs Index blurb now says 21 features |
| #1242 | `privilege/SENSOR-ENFORCEMENT-DEMO.md` — **verified live** (audit `would_kill=1`; enforce `Killed`, exit 137) |
| #1243 | Runbooks for features 12, 14, 15, 20 (from code + guides) |
| #1244 | (other session) five rows brought up to the console release notes |
| #1249 | Live findings recorded in the Secrets Hub, A2A-guardrails, aggregate runbooks |
| #1263 | The five runbooks added to both Privilege docs indexes (repo + in-app); live page shows 66 documents |
| #1260 / #1266 | MCP standardization spec, then marked **on hold** (keep all MCP servers) |
| #1258 / #1259 | `CLAUDE.md` request-flow + single-test commands; README `demo_mcp_server` → `oauth-mcp` |
| #1271 | Aggregate live results + auth-modes findings (this update) |

- Frontend deployed: `ping-devops-cmuir/frontend` on `sha-1d353f4a7…`, both pods
  verified to contain the new blurb. (Deploy script used the wrong namespace
  `ping-devops-curtismuir` — that is the *gateway* namespace; the frontend lives
  in `ping-devops-cmuir`. The script's vault step also fails from a worktree; the
  roll was done with `kubectl set image`.)
- `~/Documents/privilege-agent-features.md` and `.pdf` regenerated from merged main.

### Runbook verification status

| Feature | Runbook | Live status |
|---|---|---|
| 21 Sensor enforcement | SENSOR-ENFORCEMENT-DEMO | **Verified** (standalone mode; console-pushed policy not exercised) |
| 12 Aggregate | AGGREGATE-APPS-DEMO | **Verified live 2026-10-14** with the console `worker-agent` key: `aggregate-limited` = 4 tools, `aggregate` = 42, `aggregate-none` = 0, banking member call works, **the `opensearch` member fails at `initialize`** (Internal Server Error) so avoid `opensearch__` calls live; refusal messages recorded |
| 14 A2A guardrails | A2A-GUARDRAILS-DEMO | Rows 1–2 verified (200; 400 block in 0.56 s). Rows 3–7: none blocked at the A2A hop, **alerts unconfirmed** (worker too slow to finish). Leg-4 alerts and one PII `sanitized mcp response` were seen in the log but not tied to a row |
| 20 Secrets Hub | SECRETS-HUB-DEMO | **Partly verified live 2026-10-14**: Resync works; View ran on `privilege-hub-test` (value not displayed; audit event not located); wizard steps and the API grant shape captured; the existing grant `YukonRiver-416146713043` covers `privilege-hub-test` for 4 users + 1 group (Read+Write, to 2027-06-04) — including `demoadmin`. **No new grant created** (redundant) |
| 15 Auth modes | AUTH-MODES-DEMO | **Verified live 2026-10-14** on the spare app `workeragentdemo2` (temp grant created and deleted, app restored identical): `none` and `static-token` reach the worker (200), `token-pass` is refused by the gateway (`403` in ~0.2 s). None vs Static indistinguishable on the live worker (no bearer check). Reason log line not located |

### Open work, in order

1. **Update the exposed virtual keys — the user does the console part.** `~/Desktop/key-rotation-checklist.md`
   has step-by-step instructions; `~/Desktop/rotate_apply.py` (`--dry-run` / `--apply`) then updates
   the 2 k8s secrets (`privilege-a2a-demo`, `ai-demo-secrets`) and the 2 local `.env` files. Keys to
   update: `anthropic` (also put the user's new Anthropic API key in its provider-key field),
   `worker-agent`, `main-agent`. **`llama.cpp` is not rotated** (needs no key). Why not me: the
   auto-mode classifier blocks writing credentials ("Secret-Store Writes") — a PUT that changes a key's
   `VirtualKey`, patching secrets, editing `.env`. A key PUT that does *not* change the value is
   allowed and **preserves the stored real provider key** (verified: gateway call 200 before and after).
   Not covered: the encrypted vault and any other copy of the keys.
   **Done 2026-10-14:** `llama.cpp` key capped at **60 rpm / 200,000 tpm** (native Privilege key limits;
   enforced — a 75-request burst gave 60 × 200 then 15 × 429), key expiry moved to **2027-10-14**, and
   grant policy `HawkesburyRiver-786c3937324e` end date moved to **2027-10-14** (only those fields
   changed; A2A card and LLM lane probes stayed 200 for 4 minutes). Other things expiring in
   Oct–Nov 2026: `local` key (10-29), `main-agent` + `AngaraRiver-…` + hostile policies (11-03),
   `ollama`/`meta` keys (11-11) — extend if the demo needs them.
2. ~~Feature 15~~ — **done 2026-10-14** (approved temp grant; policy `tmp-w2-authmodes` deleted, app restored, key files removed). Optional follow-up: start a worker with `WORKER_REQUIRE_BEARER=true` to make None (401) vs Static (200) visible.
3. **Feature 20 — nothing left that proves anything new.** `demoadmin` already has Read + Write on
   `privilege-hub-test` through `YukonRiver-416146713043` (4 users + 1 group, valid to **2027-06-04**), so
   the requested extra Read grant would be redundant and was **not created**. To show a grant taking
   effect, use a user outside that list (e.g. `cmuir+4@pingidentity.com`) or the `groq-key` secret —
   needs the user's approval for that specific grant. Decide whether the long-lived Read+Write grant
   should stay. API grant shape is in `SECRETS-HUB-DEMO.md`.
4. **Feature 14:** confirm rows 3–7 with a worker that finishes (llama tier too slow;
   `gpt-oss-20b` is the candidate but cluster tier5 won't start): send ONE row, wait
   for the reply, read that minute's gateway log with keys stripped.
5. Optional: fix the unhealthy `opensearch` member behind the aggregate doors.

### Access recipes that worked today

- **Console API with no login:** open `https://local.procyon.ai:8643` in the
  *Playwright* browser (the desktop app must be running: `open -a "PingOne Privilege"`),
  then `fetch('/api/<tenant>/v1/…', {credentials:'include', headers:{'x-procyon-session-id':crypto.randomUUID()}})`.
  Tenant `0428ba4f-169c-436b-aff9-b230496e0e3b`. The Claude Chrome extension was
  not connected.
- **Gateway:** `https://mcpgw.ai-demo.ping-devops.com/<app>/…`; namespace
  `ping-devops-curtismuir`, kubectl context `us`.
- **OrbStack logs** are summarized by `docker logs`; read raw via the Docker API socket.
- **Google:** `gcloud` was logged in as the user but needed re-auth; works after
  `gcloud auth login`.

## 2. Other agents (refreshed ~21:30 local, 2026-10-13 → 14)

All sessions are active and push as `cmuir_pingcorp`; verify before acting.

| Session | State |
|---|---|
| **Privilege MCP client demo handoff** | Waiting on CI for PR **#1270** (A2A events keepalive, user-name hint to the main agent, one login for app + gateway); will `gh pr merge 1270 --squash` when green, stops and reports on a failure |
| **UI code review** | **#1264 merged.** Stack #1265 → #1267 (Privilege A2A page `/privilege-a2a`) → #1268 (MCP client title bar, More menu) rebased after conflicts with #1262; waiting on CI; nothing deployed or cleaned up yet |
| **Soften tab colour (#1269)** | PR open; background job waiting up to ~40 min on "UI tests (Vitest) + build", merges on green |
| **OpenSearch queries** | Read-only; nothing pending |
| **AIC as IDP** | #1254 merged and deployed (frontend + BFF, 2026-10-14). Still needs the user's signed-in click-through of `/aic-token-exchange`; allowlisting `test12345@mailinator.com` was refused earlier |
| **Others earlier** | v1.261009 demo steps, floating agent on A2A tab, HDD cleanup, facade — finished (see git log); facade's last open question was whether to ship the hybrid worker (tier5 won't start) |

### Effect on this session's A2A results (re-run 22:43Z)

`mainagentdemo`'s `MAIN_AGENT_MODEL` was already `llama.cpp` (another session
fixed it; my `set env` was a no-op that restarted the pods) — **that item is
closed.**

Re-ran A2A guardrail rows 1, 3–7 through the `worker-agent` door, six requests in
parallel: **five timed out at 170 s with no response** (rows 1, 3, 4, 5, 7) and
row 6 returned 200 after 117 s with a worker error text (`llama.cpp request
returned 500: … The model produced output that …`). Nothing came back as a fast
400, so **no message was guardrail-blocked** — consistent with the earlier run.
The llama tier is CPU-bound; parallel requests starve it, so this proves nothing
about alerts. **To confirm alert status:** send rows 3–7 **one at a time** (or just
two), and read the gateway log filtered to the A2A calling-agent lines with keys
stripped. Row 2 (plain injection → 400 in 0.56 s) is unaffected — blocked before
the model.

## 3. Repo and cluster state worth knowing

- Main moved while this doc was open: `cf68c62d8` (cluster agent defaults to llama.cpp, local-first), `0cdbac3e8` (Google dropped from the provider picker), `622e29b46` (a2a-demo k8s manifest matches live llama.cpp state).
- Open PRs at 19:50: **#1255** (this session's guardrail rerun; user merges, then remove `.worktrees/guard-rerun` + branch `docs/guardrail-rerun`) and **#1254** (AIC token-exchange step two; merge state UNKNOWN — CI/rebase may be pending).
- **Decisions waiting on the user (all peers idle at ~19:20, none busy):**
  (1) facade session asks whether to **ship the hybrid** parked on branch
  `fix/a2a-demo-anthropic-lane-key` — main agent on local llama.cpp, only the
  worker on Haiku through Privilege (its recommendation; tier3 rejected, tier5
  won't start); (2) AIC session: allowlisting `test12345@mailinator.com` on the
  cluster was refused — needs the user's explicit go-ahead or a manual step;
  (3) merge #1255 and review #1254.
- **Facade session blocker (19:55):** `gpt-oss-20b` runs on this Mac (port 8096) but
  cluster **tier5** (same model) never starts, so it can't ship to SE. The model
  file is on the volume, which has only 1.8 GB free. It proposes checking the
  pod's events/logs first and is waiting on the user's yes. Fixing tier5 is the
  likeliest route to a worker fast enough to finish feature 14's guardrail rows.
- Feature 14 next step is unchanged: one row, wait for the reply, read that minute's log. Don't use llama tier3 (no tool calls).

- Worktrees still present (not mine except `priv-live`): `AI-DEMO2-aic-login`,
  `-aic-nav`, `-aic-tx`, `-priv-doc`; `.worktrees/` `facade-self-call`,
  `ingress-fix`, `lb-stats-always`, `lb-stats-sso`, `remove-canary`,
  `repair-d5a50f`, `static-assets`; `.claude/worktrees/` `ghcr-share-path`,
  `group-picker`. Several are probably merged — check ancestry before deleting.
- The main checkout is shared: don't leave uncommitted edits there; use a worktree.
- Auto-mode classifier blocks `gh pr merge` from this agent; the user merges
  (or says "merge" to retry — it has worked after an explicit instruction).
