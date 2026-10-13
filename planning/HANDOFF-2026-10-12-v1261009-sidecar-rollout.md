# Handoff — 2026-10-12 session: v1.261009 demo runbook finished, ML sidecar rolled out to all 10 Agent Registry keys

> Written for the next agent/session. Check your work against this file; if you
> find something here that is wrong or stale, fix it in place and note it.

---

## 0. Demo portfolio at a glance — everything built to date

> Collated 2026-10-13 from every concurrent session's own report of what it
> personally built (agents a4, b6, d3, ac, 25, 3d + this session).

The customer-facing story is one trust plane: **the AI-DEMO2 app shows governed
AI in a product UI; the Privilege console/gateway is the enforcement behind
it.** Every demo below is shipped and verified live unless marked otherwise.

### In the AI-DEMO2 app (PingOne AI IAM Core, ai-demo.ping-devops.com)

| Demo | What it shows | State |
| --- | --- | --- |
| **Unified sign-in** | One door: customer = device-first, admin = password+MFA (Multi_Factor policy); modal-only via signInService | Live (PRs #1094/#1100, 10 Oct) |
| **Welcome wizard** (`/welcome`) | First-run onboarding that intercepts fresh browsers; Skip first in demos | Live (PR #1166, 11 Oct) |
| **Observability demo** | Traces/spans for agent runs; operator-chain rail collapsed to 1 step; projections gate on their own vocabulary prefix | Live (PR #1167, verified in browser 12 Oct) |
| **Jev demo gallery** | 8 clickable vertical demos (auto-finance, health, …), each run-to-completion tested | Live (PR #1163 + hotfix #1170, on von-1.3.0) |
| **Dot personal agent** | The user's own agent behind the gateway: promote-based deploy, hosted-access 401-proves-route | Live (PR #1207, 12 Oct) |
| **Group board vertical picker** (`/group-policy`) | One decision per load via `?verticalId=`; panel = picked user, board = signed-in user, both labeled | Live (PRs #1212/#1215) |
| **Hosted-access plus wall** | Public `/` on SE with `+address` aliases denied; demo allowlist in configmap — revoke by clearing `HOSTED_ACCESS_ALLOWED_IDENTIFIERS`; wall fix for allowlisted off-list domains killed the demoAdmin 401 login loop (`/api/auth/hosted-access/check` → 204) | Live (PRs #1191 + fix #1211, browser-verified 12 Oct) |
| **Invite→approval loop** | Admin invites via form → invitee appears on the approval page → approve moves them through the gate (was a dead end); gate denials now log `group_not_allowed` with reason/subject/email/domain | Merged (PR #1228, 13 Oct); SE deploy pending — see §6 |
| **Bootstrap hosted-access (⑥b)** | `setup:fresh` reproduces the hosted wall's inputs — sign-in app, Complete/Pending groups, groups claim, .env keys — no console steps | Live-verified on tenant, PR #1228 open |
| **Invite form** | send-invite endpoint; native-email gate = password+emailOTP despite SMS fail | Live (PR #1196, 12 Oct) |
| **LLM gateway page** (`/llm-gateway`) | Five virtual-key lanes incl. the new OpenRouter lane; the custom/llama.cpp lane with the two response-side stories: policy withhold ("Denied by policy", Active) vs AIGuard redact ("Allowed, 4 redacted", Candidate) — both UI-verified | Live (lanes: a4 session, 52adb1a34…; 824 tests green) |
| **Session-scoped MCP token cache** | Replay-labeled rail events give demo speed without faking the exchange chain | Live (24270fee9; test breakage fixed by #1224) |
| **Auth recovery** | Signoff drops `id_token_hint`; exchange-reject → 401 force-login; activity panels | Live (62f064435, 12 Oct) |
| **SE sign-in repair** | Root-caused + fixed live: User Login app is CLIENT_SECRET_POST but SE had empty secret + stale auth-method "none" — rotated secret, patched ai-demo-secrets + ai-demo-config | Fixed live 13 Oct (ops change, no PR); customer sign-in works again |

### In the Privilege console / gateway

| Demo | What it shows | State |
| --- | --- | --- |
| **MCP discovery-gating** | An agent's `tools/list` returns only what its policy grants — permit door, deny-by-default door, grant change live | Tested (10-02…04) |
| **A2A through the gateway** | Agent-to-agent calls, auth modes compared, guardrails on JSON-RPC | Tested (10-03/04) |
| **Red team: hostile A2A agent** | Poisoned Agent-Card attack end to end — what the gateway blocked vs alerted vs passed | Measured (standalone/hostile-a2a-agent) |
| **Hostile-MCP rug-pull** | Side-by-side twin MCP servers: governed twin DENYs 3 dangerous tools, ungoverned (allow-all policy) ALLOWs all; no-policy = DENY ALL on v1.261009 | Verified live (11 Oct) |
| **Hostile-MCP public door** | Re-registered console app on `/mcp`; public door 401-with-metadata, zero entry-path rejections | Resolved (12 Oct) |
| **Gateway topology page** (`/privilege-gateway-topologies`) | Live LB tab: ReactFlow diagram of the real 2-node mesh — ingress → mcpgw-lb HAProxy pair → gateway nodes → Agentic App doors — walk-stepped, verified against live LB/gateway logs; all 4 tabs ReactFlow (Mermaid removed, opensearch22 default door → aggregate) | Live (PRs #1223, #1227, blurb #1229) |
| **HAProxy stats + LB park/unpark** | Live per-node health/sessions/bandwidth stats and admin Park/Unpark per gateway via HAProxy runtime API — live failover control without helm; **PingOne SSO** gate (#1232/#1233) + #1234 softening (stats-view for any signed-in user, park/unpark admin-gated inside the route, duplicate flow figure deleted) | **FULLY LIVE 13 Oct**: /lb-stats verified, BFF + frontend both deployed (set-image done after a concurrent-session race); see §6 for the promote-gap note |
| **Cluster model swap** | tier1 PVC Phi-4-mini → Llama-3.2-3B — the model behind the Privilege llama.cpp lane | Live (5507079ce, gateway-verified) |
| **Gateway release v1.261009 runbook** | Model catalog refresh live in dropdowns; response-side policy denial (`llm_policy_response_denied` + `UpstreamStatus:200` pairing); llama.cpp governed on our own hardware via `/llm/custom/v1` (403 `wrong_provider` control, 90s timeout fix); Bedrock blocked on credential | Built this session (12 Oct) |
| **ML sidecar on every key** | demo_mcp_promptguard (NeMo + ProtectAI) wired into all 10 Agent Registry keys, Block Agreement off — injection blocked end to end on the custom lane | Built this session (12 Oct) |
| **HITL approvals (Track 2)** | Privilege native agentapprovals: approval flow works end-to-end (ApprovalReq → Pending → console Approve/Deny) = demo-ready fallback; **Slack delivery blocked after exhaustive probing (zero dispatch, zero errors) = Ping bug**; one untested cell remains (valid bot token + UI-exact wiring after Slack re-OAuth — token expired 05:50Z) | Parked; fallback demoable (3d session; evidence in memory + /tmp/procyon-probe/) |
| **Secrets Hub (GSM)** | Google Secret Manager sync, service-account key in audit log | Tested (10-04) |
| **Sensor (Docker + k8s)** | Node sensor identity, enforcement policies, safe local test | Tested (10-03) |

### Hygiene that keeps the demos running (not demos themselves)

- **Dependabot 51 → 0** (PRs #1190, #1216, #1224, #1226: otel ×7, vitest 4, lighthouse 13, sentry 11, express 4.22.3, provider-utils override; 20 documented dismissals) — PR #1225 review/merge + 6560-test UI suite green.
- **Live canary removed** (PR #1231, 13 Oct): 74 straight failures — CI runners can never hold hosted-wall approval, so the class it watched is covered by hostedAccessGate unit tests. The #1235 merge accidentally resurrected `scripts/canary/uc1-canary.js` (modify/delete conflict resolved wrong); PR #1236 re-deleted it, CI green, main clean. Don't resurrect without a CI wall-approval path.
- **Stale-engine landmine fixed**: nginx in gateway1-lb.values.yaml would have rolled the public LB back (d3 session, docs in GATEWAY-LOAD-BALANCER.md §00a-2).
- **p1-invite runbook corrected**: "console only" scoped to tenant 0428ba4f — demo-tenant writes work via memberOfGroups (#1200, merged).
- **Known dead end recorded**: mcpgw answers 200 RFC 9728 metadata for ANY door path (never-existing apps included) — door-liveness probes are meaningless; ground truth is cyonproxy.log or the console (memory: mcpgw-wildcard-metadata).

### Diagrams/docs that carry the demos

ReactFlow diagram trio (diagram/demo/Learning Hub stay in sync — changing any
surface means checking the other two); all primary steps + Hub chips
diagrammed, both hostile tabs carry embedded attack-maps. Demo scripts
auto-generate into `privilege/demo/privilege-demo-script.md` (do not hand-edit).

---

## 1. Where this started

This session executed
[docs/superpowers/plans/2026-10-12-v1.261009-demo-steps.md](../docs/superpowers/plans/2026-10-12-v1.261009-demo-steps.md)
(inline, superpowers:executing-plans) — turning the static release inventory
[privilege/GATEWAY-RELEASE-v1.261009.md](../privilege/GATEWAY-RELEASE-v1.261009.md)
into a live-tested runbook. Tasks 1 (partially), 2 and 5 were done by earlier
sessions; this session added the console screenshots, the blocked-with-reason
Bedrock task, the final runbook assembly, the opus review pass and its fixes.
Mid-run the user added two requests: roll the demo sidecar out to **all**
Agent Registry connections, and write new docs for the new features. Both are
done.

Commits (all on `main`, this repo's docs convention):
`f78a6704f`, `53235f0cd`, `c69a759a6` (runbook + review fixes),
`0a36d580e` (sidecar rollout doc + index row).

## 2. Deliverables

| Artifact | State |
| --- | --- |
| [privilege/GATEWAY-RELEASE-v1.261009-DEMO.md](../privilege/GATEWAY-RELEASE-v1.261009-DEMO.md) | NEW — per-feature tested tables: catalog dropdowns live, `llm_policy_response_denied` end to end (400 + `UpstreamStatus:200` pairing), llama.cpp custom lane, Bedrock blocked-with-reason (P.1), AIGuard-sanitize vs policy-withhold demo switch, quick lookup |
| [privilege/GATEWAY-RELEASE-v1.261009.md](../privilege/GATEWAY-RELEASE-v1.261009.md) | Caveat replaced with link to tested claims; "Demo steps" section says executed |
| [privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md](../privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md) | NEW — the sidecar rollout record (recipe, tested table, per-key state, the expired-key catch, quick lookup) |
| [privilege/DOCUMENTATION-INDEX.md](../privilege/DOCUMENTATION-INDEX.md) | Both new docs indexed under "Gateway — AI protection" |
| 5 screenshots in `docs/screenshots/privilege-console-setup/` | `v1261009-{anthropic-key-config,anthropic-models-dropdown,openai-key-config,openai-models-dropdown,provider-dropdown-bedrock}.png` |
| SDD ledger | Plan workspace deleted per skill; the record is in git |

## 3. Sidecar rollout — the state that matters

Every one of the 10 Agent Registry keys now carries: **External Guardrail on,
ML Sidecar URL `http://localhost:8086/inspect`, timeout 1000 ms, auth blank,
Block Agreement "Off — ML Blocks Alone", Sidecar Fail Closed off** (guardrail
Fail Closed also off). llama.cpp was live-verified end to end the same day:
harmless prompt → 200 + sidecar `allow`; injection → 400 `content_blocked`,
sidecar logged `INJECTION (1.00)`, gateway `AIGuard` JSON with mitre_atlas /
nist_ai_rmf / owasp_llm mappings.

Per-key notes (full table in the rollout doc):

- **anthropic** already had the sidecar wired with Block Agreement
  `inspection` — changed to `off`. Lesson: pre-existing configs exist; check,
  don't assume.
- **main-agent** saved with timeout 0 (valid: "0 uses the default 1000 ms"),
  normalized to 1000.
- **langchain-caller** is a2a-only and its Edit wizard still offers the full
  AIGuard step — recipe applied. Not tested: whether the sidecar actually
  fires on A2A traffic with that key.
- **LM-Stuidio** is expired and the wizard refuses to Continue on step 1
  ("Custom Expiry Must Be A Future Date And Time"). Editing an expired key =
  renewing it: expiry bumped 2026-10-05 → **2026-11-12**. Its Allowlist/
  provider settings were not otherwise touched.
- **local**'s first save was eaten by a console outage (AIGuard tab showed
  0/1 after the app's "Reconnecting" modal) — re-applied. The AIGuard tab's
  External Inspection row reading "1 / 1 Active" is the cheap post-save check.

## 4. Rulings made (records for the plan skill + judgment calls)

- **Expired-key renewal.** LM-Stuidio's expiry had to move to save the
  recipe — there is no edit-without-renew path. Cost: that key is now
  technically renewed; revoke it if it should stay dead.
- **anthropic's Block Agreement overridden** `inspection` → `off` per the
  user's "all connections, Block Agreement off". Cost: detector findings now
  block alone on that key.
- **main-agent timeout normalized** 0 → 1000 for table consistency. Cost:
  none (semantically identical).
- **Block Agreement `off` as the fleet standard** (user-chosen from options):
  it is the only mode where the external detector can be proven to block —
  under `unit`/`inspection` a built-in must agree. Built-ins run in every
  mode either way.
- **Commits landed on `main`** mid-run (shell cwd), matching this repo's
  docs-to-main convention; the plan's worktree/branch were already deleted by
  a prior session, so the ledger's final record is git history.
- **P.1 (Bedrock credential) blocked-with-reason** in the runbook — no AWS CLI
  in the environment, `~/.aws` holds an empty `default` profile, and the
  whose-account question is undecided. Everything Bedrock unblocks the moment
  a key lands.
- **llama-tier5 not touched** mid-run (OOM crash-loop was another session's
  in-flight fix; landed as cf3ec0ed0 pinning `--ctx-size 4096` on tier5;
  tier1 = the Llama-3.2 lane). Runbook states tier1 correctly.

## 5. Environment state the next session inherits

- **Console**: `local.procyon.ai:8643`, served by the PingOne Privilege desktop
  app (owns its DNS — never add a hosts entry). It dropped twice on 10-12
  evening; recovery was `open -a "PingOne Privilege"`, wait for :8643, then a
  fresh bsk session + tab (the outage also killed the bsk session and its
  agent tab). Earlier root causes: zombie `CyonAgent` holding 8643; the app
  flapping between AgentState connected/disabled.
- **bsk sessions die with console outages** — refs (`@eN`) also go stale after
  any page transition; re-snapshot before every click.
- **Sidecar**: `mcp-promptguard` container inside the `agentless-mcpgw` pod,
  port 8086, `/inspect` contract, NeMo rails (injection/regex_pii/presidio_pii)
  + ProtectAI deberta. Logs: `kubectl -n ping-devops-cmuir logs <gw-pod> -c
  mcp-promptguard`.
- **The demo's ACTIVE AI policy** `llm-response-pii-withhold` still withholds
  PII completions (policy-deny story); set it to Candidate to demo the AIGuard
  redaction story instead. Both live; see the runbook's AIGuard × AI-policy
  split table.
- Gateways run `privilege-aigw:v1.261009` (both nodes, deployed 9 Oct).

## 6. Unfinished work — the new agent's to-do list, per leaving session

> Every concurrent session's own account of what it left unfinished. Pick up
> by owner; owners are bsk session names on this machine (2026-10-12/13).

**Left by agents-d3 — CLOSED 2026-10-13 (all deployed + live-verified):**

1. **HAProxy stats + LB park/unpark (PRs #1225 → #1232/#1233 → #1234) —
   FULLY LIVE.** Final state, verified: `/lb-stats` on the cluster
   (200-with-password/401-without); **PingOne SSO** gate (#1232/#1233): the
   topology page iframes `/api/admin/lb/runtime/stats-view`, creds only in
   BFF env; **#1234 (merged 12:10 UTC)** softened stats-view to
   authenticateToken-only (any signed-in user) and moved the park/unpark
   admin gate INSIDE the route handler (role admin or admin:read scope,
   403 otherwise); the duplicate bottom "Request Flow" figure is deleted
   (~129 lines). **Frontend set-image DONE** (Curtis ran it himself during
   a concurrent-session race; both pods on
   sha256:2f6c49b5…, hero string absent from the served bundle, stats
   iframe live unconditionally). BFF live on
   sha256:9a3c5e40… with the new gate string confirmed. **Third occurrence
   of the promote gap**: se-update-code.sh's deploy.sh died on a vault
   SECURITY abort (PINGONE_AGENT_CLIENT_SECRET mismatch vs
   demo_hitl_service/.env) before rewriting images → rollout restart
   re-pulled old pinned tags; fixed by kubectl set image by digest.
   Pre-existing smoke FAILs on both deploys (anonymous / 200, llm-proxy
   /v1/models) — not from #1234.

**Left parked by agents-d3 — RESOLVED same day (agents-76 / the #1234 session):**

1. ~~opensearch-mcp-server svc port patch~~ — **MOOT**: helm agentless-mcpgw
   rev 73 "Upgrade complete" 06:08Z; the duplicate-port failure was
   reconciled and a dry-run is clean; svc targetPort verified 9900 live.
   No action needed.
2. **PINGONE_AGENT_CLIENT_SECRET vault/.env drift — ELIMINATED at root**:
   8 keys realigned (AGENT_CLIENT_ID/SECRET, PINGONE_AI_AGENT_ACTOR_CLIENT_SECRET,
   PINGONE_USER_CLIENT_SECRET, PINGONE_CLIENT_SECRET, PINGONE_MCP_EXCHANGER_CLIENT_SECRET,
   ENTERPRISE_IDP_SIGNING_KEY_PEM restored bash-safe single-line), every
   value live-tested against the PingOne token endpoint before writing;
   **create-secrets.sh now runs full with ZERO SECURITY aborts** (the
   deploy.sh blocker is gone). All pods rolled + Running; app 200,
   stats-view 401 anon. Side effect: the BFF agent lane repaired (its baked
   PINGONE_AGENT creds had gone dead at PingOne). *Rule of thumb that
   worked: 401=dead, 400/200=alive.*
3. **Still open (owner, not blockers):** pi.flow login TODO (memory
   p1-login-pf-followup); one browser eyeball — stats iframe as a
   signed-in **non-admin** (route verified to the wall; final hop unproven
   in a real session); pre-existing smoke FAILs (anonymous / 200, llm-proxy
   /v1/models — not ours).
   *Also from d3 + agents-25: the 4+ sequential demo-api-server rollouts on
   13 Oct morning were **both sessions' deliberate deploy/repair steps, not
   an error loop** — d3: stats secret patch → promote-roll → `kubectl set
   image` to sha-dab2bbeb2 (promote doesn't move pinned sha tags — gotcha);
   agents-25: 4-5 `rollout restart`s after patching ai-demo-secrets/
   ai-demo-config for the SE sign-in outage (empty user-app secret →
   invalid_client on every customer login) + replacing a deleted PingOne
   actor-app ghost in the config; brief 502s during restart windows were
   theirs (the persistent fix: ingress proxy-buffer-size 16k for the fat
   session cookie, done with Curtis's OK; **persisted in `k8s/aws/
   se-ingress.yaml` by PR #1237 (merged 12:48 UTC 13 Oct) so a manifest
   re-apply can't silently drop it and reintroduce the 502** — main now
   reflects the live cluster for this ingress). **Attribution note (agents-25):**
   credit the sign-in fix to the secret/configmap/LMDB patches + the 16k
   ingress annotation — all of which survive image changes — not to either
   image; d3's sha-dab2bbeb2 includes code changes agents-25 hasn't
   reviewed. Settled state verified 11:26 UTC: sha-dab2bbeb2, 1/1 Running,
   0 restarts.*

**Left by the hosted-access Bearer-pass agent (PRs #1235/#1236, merged 13 Oct):**

2. **UC1/vertical-tools 401 wall fix — DONE + deployed live:** PR #1191's
   BFF-level hosted-access wall 401'd every in-cluster service-to-server
   call (mcp-server vertical-tool callbacks + banking fetches carry a
   delegated Bearer, no wall cookie) → UC1 rendered "Run failed" with the
   gateway chain fully green. PR **#1235** fixed it: the wall passes any
   `Authorization: Bearer` request through to `authenticateToken` (forged
   Bearers gain nothing); verified in the pod (`hasBearerToken`). Deployed
   to SE on sha-d63058a1a. Two wrinkles resolved the same morning: the
   #1235 merge resurrected `uc1-canary.js` (PR **#1236** re-deleted it,
   CI green) and the image-push race pinned demo-api-server to an older
   digest (9a3c5e40) — re-pointed to sha-d63058a1a, verified live in pod;
   if any digest-pinning automation touches demo-api-server it may race
   again.
   **UC1 IS GREEN (agents-25, browser-verified 13 Oct ~13:00 UTC):** wall
   approved → signed in → wizard skipped → consent allowed → full token
   chain → "Completed — list_gear dispatched" with a real tool result;
   backend confirms POST /api/path/vertical-tool → 200, zero
   hosted_access_required. Two config layers beyond #1235 were still broken
   and are fixed live: (1) the deleted ghost actor app **0b412e8b** still
   sat in k8s secret + `demo_api_server/.env`
   (PINGONE_AI_AGENT_ACTOR_CLIENT_ID / PF_AI_AGENT_ACTOR_CLIENT_ID →
   invalid_client at Exchange #1) — fixed at the source (.env, which
   create-secrets.sh reads); (2) the ACTOR/AGENT secret copies were stale —
   only PINGONE_AI_AGENT_CLIENT_SECRET validated against PingOne (200
   verified live), so all three were synced to it and restarted; both now
   resolve to **f65664b2** (demoUser agent app). No UC1 items remain.*

**Left by agents-ac — #1228 merged 13 Oct, deploy still pending (see §
welcome/invite):**

3. **Bootstrap hosted-access + invite→approval loop + denial visibility
   (PR #1228)** — merged 13 Oct 10:35 UTC (b480271e3); deployed to the local
   stack via deploy-live.sh, but **the SE cluster's demo-api-server/frontend
   shas still predate it** (ancestry-checked) — per-service
   `se-update-code.sh bff frontend` still owed.

**Left by agents-3d — HITL one cell from closure:**

4. **Slack re-OAuth + one retest (Track 2)** — bot token expired 05:50Z
   12 Oct; re-OAuth, then one retest with UI-exact wiring + valid token. If
   still zero dispatch, file the Ping bug (evidence in memory
   `privilege-hitl-track2-probe` + /tmp/procyon-probe/). Fallback demo
   (console-native approvals) already works.

**Left by this session (agents-a3):**

5. **a2a-only sidecar traffic** — langchain-caller key has the sidecar
   config but no A2A call has gone through it; one hostile-a2a probe closes it.
6. **Learning Hub index** — AGENT-REGISTRY-SIDECAR-ROLLOUT.md is in the repo
   MD index only; the Learning Hub page export/manifest wasn't updated
   (privilege-docs-workflow: new docs update both).
7. **Drive PDF** — no PDF export of the rollout doc yet (rclone `gdrive:`
   remote ships SE-guide PDFs).
8. **"Another connection with Block Agreement off"** — answered by the
   rollout (all 10 do), but if the user meant a *separate new* connection key
   as a demo prop, that isn't built — ask first.
9. **llama-tier1 api-key hygiene (from agents-a4)** — the LIVE tier1
   deployment has the llama.cpp `--api-key` value **inline in its args**
   (llm-proxy carries the same value in `LLAMA_TIER_API_KEY`) and works, but
   the secret-backed manifest `k8s/56-llm-stack.yaml` @5507079ce (secret
   `llama-tier-api-keys`, key `tier1`, env `LLAMA_TIER1_API_KEY`) is the
   target state and **hasn't been applied to the live deployment yet**.
   Applying it closes the drift; don't re-derive the value — it's already in
   the live args.

### Reproducing the custom lane (confirmed live by agents-a4, 2026-10-13)

A fresh agent wiring the llama.cpp lane needs exactly:

| What | Value | Where it lives |
| --- | --- | --- |
| CustomUpstream BaseURL | `https://ai-demo.ping-devops.com/llm-gw` — no trailing `/v1`, no trailing slash; AuthType `bearer`; the gateway appends the provider path itself | Console key `llama.cpp` (provider `custom`) |
| Ingress plumbing | `/llm-gw/?(.*)` regex + rewrite-target `/$1` strips the prefix, forwards to `llm-proxy:8090` | `k8s/57-llm-gw-ingress.yaml` |
| Virtual key (BFF → gateway) | env `PRIVILEGE_LLM_VIRTUAL_KEY_CUSTOM` (BFF `demo_api_server/.env`); gateway host from `PRIVILEGE_LLM_GATEWAY_URL` (`https://mcpgw.ai-demo.ping-devops.com`) | BFF env, value never committed |
| RealKey (gateway → llama.cpp) | Gateway injects the key's stored RealKey as `Authorization: Bearer`; tier1's `--api-key` must match it | Console key object (RealKey) + live tier1 args / target-state secret above |

### The OpenAI lane (code-verified by agents-ac; **live-verified 2026-10-13 by this session**)

Same LANES table (`demo_api_server/services/privilegeLlmProxyService.js`):

| What | Value | Confidence |
| --- | --- | --- |
| Route / key env / host | `/llm/openai/v1/chat/completions` + `PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI` + `PRIVILEGE_LLM_GATEWAY_URL` (gatewayUrl() throws when unset); default model `PRIVILEGE_LLM_MODEL_OPENAI` \|\| `gpt-4o-mini` | Confirmed in code + UI test pin (LlmTestPage.test.jsx) |
| **RealKey on console key `openai`** | **VERIFIED LIVE 13 Oct**: `sk-orion-…` virtual key from BFF env → 200 `chatcmpl-…`, `model: gpt-4o-mini-2024-07-18`, `"OK!"` — the RealKey is a real OpenAI key and the lane works end to end | **Live-tested** |
| **Lane exercised with a live key?** | **Yes** — first live call 2026-10-13 (the `keyConfigured:false` UI pin predates this; the pin state on the live page may still show unconfigured until the BFF env is re-read) | Resolved |
| Wrong-key control | Google virtual key on the OpenAI route → `invalid_api_key` "missing Authorization header" (the gateway's provider check strips/refuses the mismatched RealKey) | Live-tested |
| `LLM_DIRECT_OPENAI_KEY` | Exists only in `demo_api_server/.env:173`; **no consumer found** — no mapping to `OPENAI_API_KEY` anywhere (demo_agent_service :3006 has zero OpenAI env, docker-compose doesn't set it, k8s has no reference). Treat as dead/unwired config, not a "direct bypass lane" | Dead config |
| The actual direct OpenAI consumer | `platformAgentRuntime.js:31` — `process.env.OPENAI_API_KEY` against the OpenAI Responses URL, with gateway MCP tools attached. Platform-agent path, **not** a lane contrast surface; no side-by-side UI exists (the only lane-picker is LlmTestPage's per-lane dropdown) | Confirmed in code |

**Unfinished:** nothing pending on either LLM lane — custom lane re-verified
live the same day (200, GGUF model id echoed); OpenAI lane's first live 200 is
above. The remaining lane-level gap is only that no UI shows the two
side-by-side as a contrast story.

### Welcome wizard + invite flow — status (checked 2026-10-13 by this session)

From the SDD ledger (`.superpowers/sdd/2026-10-11-wizard-invite-emails/progress.md`),
PR history and live probes:

| Piece | State |
| --- | --- |
| Welcome wizard itself (`/welcome`) | Live since 11 Oct (PR #1166, sha-8f99e1346); 200 live today; provisions customer+admin accounts, email+SMS MFA, banking seed |
| Task 1 — PingOne spike (native email) | ✅ COMPLETE 12 Oct: `password.sendRecoveryCode` → 200 → `NATIVE_EMAIL_ENABLED = true`; worker-created users need explicit `population.id` (handled by `pingOneUserService`) |
| Task 2 — `POST /api/demo/send-invite` + `sendPasswordSetupEmail` | ✅ COMPLETE + MERGED (PRs #1196/#1197, commits d24d9f923..efa683e3c); in BOTH deployed images (frontend c3b866f20 + api 0cf7c964f verified by ancestry); live endpoint answers 401 unauthenticated (exists, admin-gated) |
| Task 3 — invite form on HostedRegistrationAdminPage | ✅ COMPLETE + MERGED, review clean; registrationUrl contract `…/welcome?welcome=1` (demoProvisioning.js:413) |
| Task 4 — dress rehearsal + onboarding-runbook update | ⚠️ PARTIAL: the runbook (`docs/runbooks/privilege-onboarding-email.md`) **is** updated (Hosted Registrations invite + idempotency + SMS-fail note); PRs merged; but the ledger still shows Task 4 unchecked — **the Curtis dress rehearsal (admin invites themselves → follows link → native email arrives) has no recorded result** |
| Invite→approval loop closure | MERGED (PR #1228, 13 Oct 10:35 UTC) but **NOT LIVE**: deployed frontend (c3b866f20) + api (0cf7c964f) both predate the #1228 merge (b480271e3) — ancestry-checked. Needs the per-service deploy (`se-update-code.sh bff frontend`) |

**Unfinished (welcome/invite):** two items — (1) deploy #1228 to the SE cluster
(per-service `se-update-code.sh bff frontend` only; never full deploy.sh) so
the invite→approval loop closure is actually live, then (2) run the Task 4
dress rehearsal with Curtis's address and record the result (invite → email →
link → temp password → dashboard), then tick the plan's Task 4 checkbox. The
wizard itself and Tasks 1–3 are shipped and deployed.

### Privilege-based HITL — status (peer-confirmed 2026-10-13 by d3, 3d, ac)

Three sessions independently confirmed the same state; nothing new landed:

| Track | Status |
| --- | --- |
| **Track 2 — Privilege native agentapprovals** | Approval flow **works end-to-end** (ApprovalReq POST → Pending → Approve/Deny in the console's Access Request Approvals UI) = the demoable path. **Slack delivery BLOCKED** — zero dispatch, zero errors over the full token×wiring matrix (the "one untested cell" is now closed: no re-OAuth UI exists for Slack integrations — console hides the Authorize button for all SlackIntegration kinds, and xoxb tokens don't natively expire). **Mattermost tried as a second channel — same block**, infra fully up (compose at `~/Development/mattermost-hitl`, bot verified, integration registered). |
| **Root-cause candidate (3d, new)** | The agentless tenant never deploys **privilege-proxy egress**: the cmuirlocal ProxyController has **zero MedusaNodes**, and agent-VM egress is proxied + allowlisted to Ping hosts only — proven with a logging listener (504s). Suspected cause for BOTH channels' silence. Also ruled out: Mattermost on Ping k8s (all 27 EKS nodes arm64; Mattermost is amd64-only). |
| **Track 1 — Recognize-as-HITL** | Parked (recognizeService stubbed; Server-API ops flow implementable with the API key; WebSDK needs Keyless staff). |
| **Ping report** | Evidence complete, draft **not yet written** (not asked for). |
| **Fallback demo** | Console-native approvals work but were **never built into a dedicated demo surface** — a demo run hits the console UI directly. |

**Unfinished (HITL):** write the Ping bug report from the collected evidence
(egress/MedusaNodes root-cause candidate included); optionally build the
console-native fallback into a demo surface so the demo doesn't screen-share
the console. No repo-facing artifacts exist from this work — all state is
console/API-side (memory `privilege-hitl-track2-probe` + /tmp/procyon-probe/).

### "Demo welcome wizard design" — resolved: no separate design effort exists

Triple-checked (ac, 3d, this session's repo search): docs/superpowers/plans,
planning/, and docs/superpowers/specs contain **no welcome-wizard design
plan** — the only artifacts are the invite-emails spec
(`2026-10-11-wizard-invite-emails-design.md`, approved by Curtis 11 Oct) and
its plan. The design phase that preceded the shipped wizard (PR #1166, live
11 Oct) **left no artifact in the repo**. Shipped = PR #1166 + invite flow
#1196/#1197; current per-piece status is in the section above. If a new
wizard-design effort is wanted, it would be net-new work, not a status
check.

**Left blocked (ownerless until a credential lands):**

9. **Bedrock demo pair (runbook P.1)** — needs an AWS Bedrock credential;
   the whose-account question (Curtis's vs Ping SE) is undecided. Everything
   else is ready; P.2 answered (mantle is a first-class key provider).

**agents-ef (privilege docs session, 13 Oct — docs only, all on main, NOTHING open):**

1. **`docs/privilege-agent-field-guide.html`** (7f78935a2) — trainer's page,
   top-10 Privilege agent features in demo-arc order (what/show/say rows +
   pre-session caveats); indexed in DOCUMENTATION-INDEX.md +
   PrivilegeDocsIndexPage.jsx (7f56bad8f), tests 3/3 pass.
2. **`docs/privilege-agent-features.md`** (9ffa06749 + 35f1cd8c2) — master
   index of the same 10 features with descriptions, doc links, demo steps,
   what-it-proves and clickable verified-200 app URLs; **gaps section now
   EMPTY**; indexed in both places.
3. **Coverage-gap docs CLOSED** (5bcbdac86): [HOSTILE-MCP-SIDE-BY-SIDE.md](../privilege/HOSTILE-MCP-SIDE-BY-SIDE.md)
   (rug-pull matrix runbook) + [AGENT-APPROVALS-DEMO.md](../privilege/AGENT-APPROVALS-DEMO.md)
   (console-fallback HITL script).
4. **[AUDIT-EVIDENCE-COMPLIANCE.md](../privilege/AUDIT-EVIDENCE-COMPLIANCE.md)**
   (19ffa81ab) — feature-10 doc, TENANT-VERIFIED 13 Oct from gateway pod logs:
   all 3 event types (llm_request_blocked / llm_response_sanitized /
   llm_policy_response_denied) emit ComplianceMappings under catalog
   aigw-compliance-v1.1.0. Two items flagged unverified in-doc: the deck's
   slide-7 framework and current ping-siem-events index contents (session
   declined OpenSearch credential access mid-check — correct call).
   (UI index rows ride the next frontend rollout; a user-requested
   md/html/pdf deliverable copy lives off-repo on Desktop→Documents.)

**Nothing left unfinished:** agents-a4 (all six shipped; its "runbook not
yet assembled" item was completed by this session), agents-b6 (all merged +
deployed live), agents-25 (UC1 closed GREEN 13 Oct: #1235/#1236 deployed,
ghost actor purged, secrets synced, browser-verified; #1237 persisted the
16k ingress annotation), and agents-ef — coverage gaps closed, no open
in-repo items.

## 7. Gotchas worth keeping

- The wizard's Runtime Protection step enforces **detector-before-endpoint**:
  the ML Sidecar fields stay disabled until the External Guardrail chip is on,
  and Continue is blocked until the URL is filled ("ML Sidecar URL is Required
  When The External Guardrail Detector Is Enabled").
- The review step's "0 ms" Sidecar Timeout is not a misconfiguration — the
  field help states 0 uses the default (1000 ms).
- Provider-specific wizard quirks: openai's Edit requires selecting MCP server
  `agent-gateway` + Remote Agent `langchain-midagent` before Continue.
- ollama's detail page sometimes drops the Edit/Revoke/Delete buttons from the
  aria snapshot while they exist in the DOM — `window.scrollTo(0,0)` +
  re-snapshot recovers them.
- Virtual keys are secrets: only prefixes in docs/chat; gateway logs carry
  them in full (docs warn readers).
- Main checkout is shared and hook-protected; docs commits to `main` are the
  repo convention for these files.
