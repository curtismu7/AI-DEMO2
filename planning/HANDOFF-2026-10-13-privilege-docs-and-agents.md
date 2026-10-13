# Handoff 2026-10-13 — Privilege docs runbooks, plus what every agent was doing

Written so VS Code can be restarted. Source for the other agents' state: their
transcripts in `~/.claude/projects/` (read at ~17:08 local); **their state may
have moved — verify before acting on it.** No secret values are in this file.

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
| 14 A2A guardrails | A2A-GUARDRAILS-DEMO | Rows 1–2 verified (200; 400 block in 0.56 s). Rows 3–7 sent, none blocked, **alert status unconfirmed**; row 5 (HTML-comment injection) was *not* blocked with my wording |
| 20 Secrets Hub | SECRETS-HUB-DEMO | Tenant state verified (hub `GCP-hub-secrets` Synced, project `privilege-hub-test-643070`, 2 secrets). **View / Resync / policy grant not run** |
| 12 Aggregate | AGGREGATE-APPS-DEMO | Door inventory verified (`aggregate`, `aggregate-limited`, `aggregate-none`, `banking-aggregate`). **No tool calls**: the demo `.env` agent keys get `403 key not scoped for mcp access` |
| 15 Auth modes | AUTH-MODES-DEMO | **Not run.** Live app states read: `agent-gateway` + `banking-mcp` = static-token, most others none |

### Open work, in order

1. **Rotate five agent keys that were printed into session output** (tool
   mistakes by this session): the A2A demo's `MAIN_AGENT_KEY` and
   `WORKER_AGENT_KEY`, the console's `worker-agent` key, and two keys seen in
   gateway-log / config dumps. Demo keys, local transcript only — but rotate.
   Lesson recorded: print only named non-secret fields; the console's key object
   exposes the secret under `VirtualKey`.
2. **Feature 12:** needs an mcp-scoped key with the aggregate apps selected.
   Existing mcp-scoped keys: `worker-agent`, `openai`, `google`, `local`,
   `ollama`, `llama.cpp`. Either create a throwaway key in the console UI
   (driving the UI is safer than POSTing an uncaptured key object) or hand over a
   key via a `chmod 600` file. Then: `tools/list` on `aggregate-limited`, one
   call per member, one ungranted call (`access denied`).
3. **Feature 15:** spare app `workeragentdemo2` points at the same worker backend
   (auth `none`) but the main key gets **403** on it — it has no grant. Choose:
   grant the main key on it, flip it through None → Static Token → Pass Agent
   Token, then restore; or flip the live `worker-agent` door briefly (affects
   anyone using the demo).
4. **Feature 20:** run View on `privilege-hub-test` (**not** `groq-key`) and
   create one time-boxed `SecretResources` policy (body shape not yet captured —
   easiest is one grant done in the console UI, then read back through the API).
5. **Feature 14:** confirm alerts for rows 3–7 from the gateway log (filter to
   the A2A calling-agent lines; avoid dumping lines that contain keys).
6. Cleanup: **done** — `priv-live` worktree, its branches and the Playwright
   browser are gone (all PRs merged, #1250 included). Only the other session's
   `AI-DEMO2-priv-doc` worktree remains (branch
   `docs/privilege-features-release-notes`, already merged as #1244) — leave it
   to that session.

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

## 2. Other agents (from transcripts, ~17:08)

| Session | Working in | State |
|---|---|---|
| **Floating agent on A2A tab** | main checkout | UI tests running; merge queued behind a watcher that auto-merges when they pass; was looking up the deploy recipe |
| **v1.261009 demo steps plan** | `standalone/privilege-a2a-anthropic-demo` | In the middle of tab colors — reading the nav component |
| **Privilege-mcp-client facade broken** | `.worktrees/facade-self-call` | **PR #1248** open, auto-merge on, CI running. After merge + image build: promote `sha-<merge>` to `demo-api-server` on SE, re-test the door from the pod and the page, then remove worktree + branches |
| **AIC as IDP for demo** | main checkout / `AI-DEMO2-aic-*` worktrees | PRs #1238, #1240 merged. Waiting on the user to sign in and click through `/aic-token-exchange` (Sign in at AIC → Get actor token). Test user `test12345@mailinator.com` in AIC tenant `openam-jgcten` / `alpha` realm — its password is unknown to the agent; reset in AIC admin (Identities → Manage → Alpha realm → Users) |
| **HDD cleanup** | main checkout | Report only: disk 64% used, 325 GB free. Safe-to-regenerate items listed (Docker build cache 16.8 GB, unused images 6.5 GB, volumes 5.4 GB, `~/Library/Caches` 11 GB, `~/.npm` 4.4 GB, `~/.cache` 24 GB needs a look). **Nothing deleted** |
| **GenericOpenSearchApiTool / gateway-events** (2–3 sessions) | main | Read-only OpenSearch queries via `opensearch-hitl` (`gateway-events` = 268 docs). No pending changes |
| **Demo API server .env comments** | `demo_api_server` | Comments added to local `.env`; waiting for any rewording |
| **Top 10 agent privilege features** (10:30) | `~/.agents` | Finished; field guide + master index pushed (`7f78935a2`, `9ffa06749`, `35f1cd8c2`) |
| **HAProxy stats page** (10:23) | main | Finished: PR #1234 merged/deployed; vault/.env drift eliminated at root; canary removed (#1231) |

## 3. Repo and cluster state worth knowing

- Worktrees still present (not mine except `priv-live`): `AI-DEMO2-aic-login`,
  `-aic-nav`, `-aic-tx`, `-priv-doc`; `.worktrees/` `facade-self-call`,
  `ingress-fix`, `lb-stats-always`, `lb-stats-sso`, `remove-canary`,
  `repair-d5a50f`, `static-assets`; `.claude/worktrees/` `ghcr-share-path`,
  `group-picker`. Several are probably merged — check ancestry before deleting.
- The main checkout is shared: don't leave uncommitted edits there; use a worktree.
- Auto-mode classifier blocks `gh pr merge` from this agent; the user merges
  (or says "merge" to retry — it has worked after an explicit instruction).
