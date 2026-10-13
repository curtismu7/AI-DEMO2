# Privilege agent features — master index

The ten agent-facing Privilege features this demo trains on, in demo arc
order, each with a one-line description and links to the detailed docs. The
presenter-facing version of this list (with say/show lines and pre-session
checks) is the [Agent Field Guide](privilege-agent-field-guide.html).

Arc: **identity → policy → LLM surface → MCP surface → human control →
proof.**

| # | Feature | What it is | Detailed docs | How to demo — and what it proves |
|---|---|---|---|---|
| 1 | **Agent Registry** | Every agent enrolls with its own key — owner, expiry, lifecycle, per-key policy; expired keys are edit-locked until renewed | [AGENT-REGISTRY-SIDECAR-ROLLOUT](../privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md) · [Setting up a calling agent](../privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md) | [Rollout recipe](../privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md) · console. Show the 10 enrolled keys with their owners/expiries, the `/inspect` sidecar check, and the expired-key edit lock. **Proves:** agents are first-class identities with a lifecycle — not anonymous API keys. |
| 2 | **Per-credential inspection policy** | Allow / alert / sanitize / block attach to the credential or application, not the network; one credential can observe while another enforces | [AIGuard console walkthrough](../privilege/GATEWAY-AIGUARD.md) · [Guardrails & the external detector](../privilege/GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md) | [Console walkthrough](../privilege/GATEWAY-AIGUARD.md) · key → Runtime Protection. Set one credential to alert-only and walk its events while another enforces. **Proves:** policy attaches to the credential — observe before you enforce. |
| 3 | **Virtual keys** | The app never holds a provider API key — a virtual key is useless outside the gateway; Privilege injects the real key server-side | [LLM routing & virtual keys](../privilege/GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md) · [LLM protection in the demo stack](privilege-llm-protection.md) | [Demo steps](privilege-llm-protection.md) · `/privilege-mcp-client`. Send a prompt and point at the gateway-route + latency line under the reply. **Proves:** the app never holds the provider key — the call visibly went through Privilege. |
| 4 | **Attributable denial** | A policy denies a call before the provider and the denial names provider, route, and the policy's own reason (`llm_policy_denied` / `llm_policy_response_denied`) | [v1.261009 demo runbook](../privilege/GATEWAY-RELEASE-v1.261009-DEMO.md) · [LLM protection](privilege-llm-protection.md) | [Demo steps](privilege-llm-protection.md) → **Prove the policy** · `/privilege-mcp-client`. One click sends a PII prompt the active policy withholds; the panel renders provider, route, and the policy's reason. **Proves:** the denial is the feature working, and it names why. |
| 5 | **Model allowlists** | A virtual key restricted to a subset of its provider's models, enforced at the gateway as a 403 in ~40 ms — nothing leaves the gateway | [LLM routing & virtual keys](../privilege/GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md) · [verified allowlist table](privilege-llm-protection.md) | [Demo steps](privilege-llm-protection.md) · `/llm-gateway` model dropdown. Pick a blocked model: "Privilege stopped this", "Reached the model: no", ~40 ms refusal. **Proves:** enforcement happens at the gateway — nothing left to wait for. |
| 6 | **Three routes, two wire shapes** | Anthropic native Messages API vs OpenAI-compatible for OpenAI/Google — same policy and gateway, only the wire shape changes | [LLM protection — the three routes](privilege-llm-protection.md) | [Demo steps](privilege-llm-protection.md) · `/llm-gateway` lanes + Raw Request tab. Send the same prompt down all three lanes; show the untouched wire on Raw Request. **Proves:** one gateway, one policy, three providers — only the wire shape differs. |
| 7 | **MCP tool-call inspection** | Two enforcement surfaces: model request/response AND the MCP tool-call boundary incl. tool results; governed twin DENYs dangerous tools, ungoverned ALLOWs all, no policy = DENY ALL | [Hostile MCP side-by-side](../privilege/HOSTILE-MCP-SIDE-BY-SIDE.md) · [Red team: hostile A2A](../privilege/RED-TEAM-HOSTILE-A2A.md) | [Side-by-side runbook](../privilege/HOSTILE-MCP-SIDE-BY-SIDE.md) · twin hostile servers. Run the matrix: governed twin DENYs `create_transfer`/`delete_all_records`/`grant_admin`, ungoverned ALLOWs, no policy = DENY ALL. **Proves:** the same poison lands in both, but only the governed agent's dangerous actions die — the tool-call boundary is the enforcement point. |
| 8 | **Human-in-the-loop approvals** | Native `agentapprovals`: a high-risk agent action becomes an ApprovalReq, the human decides in the console, the grant is time-bound and auditable. Slack/Teams delivery is an open Ping case; the console path is the demo | [Agent approvals — the demo that works today](../privilege/AGENT-APPROVALS-DEMO.md) | [Demo script](../privilege/AGENT-APPROVALS-DEMO.md) · console → Access Request Approvals. Create an ApprovalReq, show it in HITL Requests, approve as the human, show the terminal state and expiry. **Proves:** the agent pauses, a human decides, the audit shows who — and the grant dies on schedule. |
| 9 | **Attack Lab** | Eight attack types against the real agent — Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, Malicious Content — with strict verdict attribution | [AIGuard training guide](privilege-aiguard-training.md) | [Presenter table](privilege-aiguard-training.md) · `/llm-gateway?tab=attacks`. Run Tool Poisoning live, then read the enforcement-component field aloud. **Proves:** the attacks are real against the real agent, and a block counts only when Privilege signs it. |
| 10 | **Audit evidence** | Every governed call leaves a Privilege event with an enforcement-component field and framework mappings (MITRE ATLAS / NIST AI RMF / OWASP LLM, catalog `aigw-compliance-v1.1.0` — verified in the gateway log 2026-10-13) | [Audit evidence & compliance mappings](../privilege/AUDIT-EVIDENCE-COMPLIANCE.md) · [Logging with Elasticsearch](../privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md) | [Where to show each piece](../privilege/AUDIT-EVIDENCE-COMPLIANCE.md) · gateway log → Kibana. Grep the log for `llm_request_blocked` / `llm_response_sanitized` and show the MITRE/NIST/OWASP arrays. **Proves:** every verdict names its frameworks, every denial names the policy and principal — if the audit can't show it, it didn't happen. |

## Coverage gaps (docs that would complete this index)

None — all ten features have dedicated docs as of 2026-10-13. Two tenant
re-verifications remain, flagged in [AUDIT-EVIDENCE-COMPLIANCE](../privilege/AUDIT-EVIDENCE-COMPLIANCE.md):
the AIGuard deck's slide-7 control framework (dated 2026-09-22) and the
current contents of the `ping-siem-events` index.

*(Previously open, closed 2026-10-13: feature 7's side-by-side matrix →
[HOSTILE-MCP-SIDE-BY-SIDE](../privilege/HOSTILE-MCP-SIDE-BY-SIDE.md);
feature 8's approval flow →
[AGENT-APPROVALS-DEMO](../privilege/AGENT-APPROVALS-DEMO.md).)*

Known demo caveats before any session: the Google lane's virtual key is
misconfigured (`403 wrong_provider` — demo Anthropic/OpenAI), and allowlists,
policies, and enrolled keys are console config — re-verify before quoting.
