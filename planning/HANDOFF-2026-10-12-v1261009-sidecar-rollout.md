# Handoff — 2026-10-12 session: v1.261009 demo runbook finished, ML sidecar rolled out to all 10 Agent Registry keys

> Written for the next agent/session. Check your work against this file; if you
> find something here that is wrong or stale, fix it in place and note it.

---

## 0. Demo portfolio at a glance — everything built to date

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
| **Hosted-access plus wall** | Public `/` on SE with `+address` aliases denied; demo allowlist in configmap — revoke by clearing `HOSTED_ACCESS_ALLOWED_IDENTIFIERS` | Live (PR #1191, 12 Oct) |
| **Invite form** | send-invite endpoint; native-email gate = password+emailOTP despite SMS fail | Live (PR #1196, 12 Oct) |
| **LLM gateway page** (`/llm-gateway`) | The custom/llama.cpp lane + OpenRouter lane with the two response-side stories: policy withhold ("Denied by policy", Active) vs AIGuard redact ("4 redacted", Candidate) | Live; stories switch on policy state |
| **Auth recovery** | Signoff drops `id_token_hint`; exchange-reject → 401 force-login; activity panels | Live (62f064435, 12 Oct) |

### In the Privilege console / gateway

| Demo | What it shows | State |
| --- | --- | --- |
| **MCP discovery-gating** | An agent's `tools/list` returns only what its policy grants — permit door, deny-by-default door, grant change live | Tested (10-02…04) |
| **A2A through the gateway** | Agent-to-agent calls, auth modes compared, guardrails on JSON-RPC | Tested (10-03/04) |
| **Red team: hostile A2A agent** | Poisoned Agent-Card attack end to end — what the gateway blocked vs alerted vs passed | Measured (standalone/hostile-a2a-agent) |
| **Hostile-MCP rug-pull** | Side-by-side twin MCP servers: governed twin DENYs 3 dangerous tools, ungoverned (allow-all policy) ALLOWs all; no-policy = DENY ALL on v1.261009 | Verified live (11 Oct) |
| **Hostile-MCP public door** | Re-registered console app on `/mcp`; public door 401-with-metadata, zero entry-path rejections | Resolved (12 Oct) |
| **Gateway release v1.261009 runbook** | Model catalog refresh live in dropdowns; response-side policy denial (`llm_policy_response_denied` + `UpstreamStatus:200` pairing); llama.cpp governed on our own hardware via `/llm/custom/v1`; Bedrock blocked on credential | Built this session (12 Oct) |
| **ML sidecar on every key** | demo_mcp_promptguard (NeMo + ProtectAI) wired into all 10 Agent Registry keys, Block Agreement off — injection blocked end to end on the custom lane | Built this session (12 Oct) |
| **HITL approvals (Track 2)** | Privilege native agentapprovals → Slack/Teams: Privilege side exhaustively verified, **zero Slack delivery = Ping bug**; demo fallback = console-native Access Request Approvals | Parked; fallback demoable |
| **Secrets Hub (GSM)** | Google Secret Manager sync, service-account key in audit log | Tested (10-04) |
| **Sensor (Docker + k8s)** | Node sensor identity, enforcement policies, safe local test | Tested (10-03) |

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

## 6. Open items

1. **"Add another connection that does block agreement off"** — answered by
   the rollout: all 10 connections now do Block Agreement off (llama.cpp was
   already first). If the user meant a *separate, new* connection key created
   specifically as a demo prop, that is not done — ask.
2. **Bedrock demo pair** stays blocked on P.1 (credential); P.2 answered
   (mantle is a first-class key provider in the wizard, screenshot taken).
3. **a2a-only sidecar traffic** unverified (langchain-caller) — worth one
   hostile-a2a probe through that key.
4. **Learning Hub**: the rollout doc is indexed in the repo MD index only; the
   Learning Hub page export/manifest was not updated (privilege-docs-workflow
   says new docs update both indexes).
5. **Drive PDF**: the new doc has no PDF export; SE-guide PDFs ship via the
   shared Drive folder (rclone `gdrive:` remote).
6. **Slack HITL (Track 2)** remains parked: Privilege side exhaustively
   verified, zero Slack delivery, zero errors — bug report material, demo
   fallback is console-native approvals (see memory).

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
