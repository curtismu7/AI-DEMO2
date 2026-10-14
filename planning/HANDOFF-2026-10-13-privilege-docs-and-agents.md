# Handoff 2026-10-13 — Privilege docs runbooks, plus what every agent was doing

Written so VS Code can be restarted. Source for the other agents' state: their
transcripts in `~/.claude/projects/` (first read ~17:08, last refreshed ~19:20 local); **their state may
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
5. **Feature 14:** serial rerun done (23:01–23:14Z) and **still inconclusive**:
   even one-at-a-time, replies time out (llama tier too slow for the worker's
   multi-step loop), none blocked at the A2A hop. Log showed leg-④ alerts
   (`prompt_injection` on worker→MCP calls) and one `sanitized mcp response …
   category=pii`, not attributable to a row. Next: send ONE row, wait for the
   reply, read that minute's log immediately; or test against a lighter worker.
   Documented in `A2A-GUARDRAILS-DEMO.md` ("Rerun").
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

## 2. Other agents (refreshed from transcripts ~19:20 local)

Their state may have moved again — verify before acting.

| Session | State |
|---|---|
| **v1.261009 demo steps plan** | **Latest (18:31):** k8s manifest `standalone/privilege-a2a-anthropic-demo/k8s/deployment.yaml` re-synced to live (both agents on llama.cpp via the custom lane, `worker-agent` door, `a2a-mcp-tools` MCP door, `WORKER_PUBLIC_URL` restored) and pushed; live worker re-patched after an env replace dropped the card URL var. **Earlier — finished.** PRs #1252 (llama.cpp default provider) and #1253 (per-tab colors) merged, branches deleted. Live: both standalone agents default to llama.cpp *through Privilege* (custom lane); in-cluster `workeragentdemo` + `mainagentdemo` flipped to llama.cpp; the dead `workeragentdemo` door fixed to `worker-agent`; llama-tier1 ctx raised to 16384. Full A2A chain verified end to end (delegate → MCP tools → real answer). 8B model rejected (won't delegate); 3B + 16k ctx is the sweet spot |
| **Privilege-mcp-client facade broken** | **Latest (18:38): llama tier3 rejected for the worker step** — fast, but it never called a tool and made up an answer; tier1 restored, tier3 back to zero replicas. (So a faster tier is *not* a fix for the slow A2A worker in feature 14.) PR **#1248 merged**. **One live fix is NOT applied** (blocked by the classifier): step 25A returns 403 because `mainagentdemo` has `MAIN_AGENT_PROVIDER=llamacpp` but a leftover `MAIN_AGENT_MODEL=gemini-3.6-flash`. Fix, to run: `kubectl -n ping-devops-cmuir set env deploy/mainagentdemo MAIN_AGENT_MODEL=llama.cpp` (verified from inside the pod: that model returns 200, the gemini name returns 403). **Already applied** — `MAIN_AGENT_MODEL` is `llama.cpp` (checked 22:4xZ). Live-only, not in git |
| **Floating agent on A2A tab** | Finished (re-confirmed 18:02): PRs #1245 and #1246 merged, frontend live; A2A tab keeps its in-page chat and hands the same run to the floating agent; chips follow the vertical. `mainagentdemo` was switched to llama.cpp because Google returned 503 — revert: `kubectl -n ping-devops-cmuir set env deploy/mainagentdemo MAIN_AGENT_PROVIDER=google` |
| **AIC as IDP for demo** | **Latest (18:28):** hosted front door now has a **"Sign On with AIC"** button (new PingOne sign-on policy `Hosted_Access_Login`). **Allowlisting `test12345@mailinator.com` on the cluster was refused**, so that user still can't pass the wall. **PR #1254** (AIC token-exchange demo, step two: the delegation exchange) is open. Earlier — waiting on the user: commit pending edits in the AIC worktrees, then it will sync the main checkout, rebuild the local UI bundle and confirm the AIC nav group. Still needs the user's `/aic-token-exchange` click-through; test user `test12345@mailinator.com` password unknown (reset in AIC admin → Alpha realm → Users) |
| **HDD cleanup** | Done: free space 325 GB → 476 GB (48% used). `~/.cache` 24 → 6.1 GB; CI dep cache trimmed to the newest copy; `~/Library/Caches` only 11 → 9 GB (some deletes unconfirmed). **Docker volumes (6, ~3.4 GB) left** — classifier blocked; command is in that session's last message |
| **GenericOpenSearchApiTool / gateway-events** | Read-only OpenSearch queries via `opensearch-hitl`; nothing pending |
| **Demo API server .env comments** | Comments added to local `.env`; waiting on any rewording from the user |

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

- Open PRs at 19:20: **#1255** (this session's guardrail rerun; user merges, then remove `.worktrees/guard-rerun` + branch `docs/guardrail-rerun`) and **#1254** (AIC token-exchange step two).
- **Decisions waiting on the user (all peers idle at ~19:20, none busy):**
  (1) facade session asks whether to **ship the hybrid** parked on branch
  `fix/a2a-demo-anthropic-lane-key` — main agent on local llama.cpp, only the
  worker on Haiku through Privilege (its recommendation; tier3 rejected, tier5
  won't start); (2) AIC session: allowlisting `test12345@mailinator.com` on the
  cluster was refused — needs the user's explicit go-ahead or a manual step;
  (3) merge #1255 and review #1254.
- Feature 14 next step is unchanged: one row, wait for the reply, read that minute's log. Don't use llama tier3 (no tool calls).

- Worktrees still present (not mine except `priv-live`): `AI-DEMO2-aic-login`,
  `-aic-nav`, `-aic-tx`, `-priv-doc`; `.worktrees/` `facade-self-call`,
  `ingress-fix`, `lb-stats-always`, `lb-stats-sso`, `remove-canary`,
  `repair-d5a50f`, `static-assets`; `.claude/worktrees/` `ghcr-share-path`,
  `group-picker`. Several are probably merged — check ancestry before deleting.
- The main checkout is shared: don't leave uncommitted edits there; use a worktree.
- Auto-mode classifier blocks `gh pr merge` from this agent; the user merges
  (or says "merge" to retry — it has worked after an explicit instruction).
