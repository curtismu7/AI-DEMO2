# Privilege agent features — master index

The ten agent-facing Privilege features this demo trains on, in demo arc
order, each with a one-line description and links to the detailed docs. The
presenter-facing version of this list (with say/show lines and pre-session
checks) is the [Agent Field Guide](privilege-agent-field-guide.html).

Arc: **identity → policy → LLM surface → MCP surface → human control →
proof.**

| # | Feature | What it is | Detailed docs | Demo surface |
|---|---|---|---|---|
| 1 | **Agent Registry** | Every agent enrolls with its own key — owner, expiry, lifecycle, per-key policy; expired keys are edit-locked until renewed | [AGENT-REGISTRY-SIDECAR-ROLLOUT](../privilege/AGENT-REGISTRY-SIDECAR-ROLLOUT.md) · [Setting up a calling agent](../privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md) | Privilege console → Agent Registry |
| 2 | **Per-credential inspection policy** | Allow / alert / sanitize / block attach to the credential or application, not the network; one credential can observe while another enforces | [AIGuard console walkthrough](../privilege/GATEWAY-AIGUARD.md) · [Guardrails & the external detector](../privilege/GATEWAY-GUARDRAILS-AND-THE-EXTERNAL-DETECTOR.md) | Console key → Runtime Protection |
| 3 | **Virtual keys** | The app never holds a provider API key — a virtual key is useless outside the gateway; Privilege injects the real key server-side | [LLM routing & virtual keys](../privilege/GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md) · [LLM protection in the demo stack](privilege-llm-protection.md) | `/privilege-mcp-client` |
| 4 | **Attributable denial** | A policy denies a call before the provider and the denial names provider, route, and the policy's own reason (`llm_policy_denied` / `llm_policy_response_denied`) | [v1.261009 demo runbook](../privilege/GATEWAY-RELEASE-v1.261009-DEMO.md) · [LLM protection](privilege-llm-protection.md) | `/privilege-mcp-client` → "Prove the policy" |
| 5 | **Model allowlists** | A virtual key restricted to a subset of its provider's models, enforced at the gateway as a 403 in ~40 ms — nothing leaves the gateway | [LLM routing & virtual keys](../privilege/GATEWAY-LLM-ROUTING-AND-VIRTUAL-KEYS.md) · [verified allowlist table](privilege-llm-protection.md) | `/llm-gateway` model dropdown |
| 6 | **Three routes, two wire shapes** | Anthropic native Messages API vs OpenAI-compatible for OpenAI/Google — same policy and gateway, only the wire shape changes | [LLM protection — the three routes](privilege-llm-protection.md) | `/llm-gateway` lanes + Raw Request tab |
| 7 | **MCP tool-call inspection** | Two enforcement surfaces: model request/response AND the MCP tool-call boundary incl. tool results; governed twin DENYs dangerous tools, ungoverned ALLOWs all, no policy = DENY ALL | [Hostile MCP side-by-side](../privilege/HOSTILE-MCP-SIDE-BY-SIDE.md) · [Red team: hostile A2A](../privilege/RED-TEAM-HOSTILE-A2A.md) | Attack Lab `/llm-gateway?tab=attacks` + Catalog tab live tests |
| 8 | **Human-in-the-loop approvals** | Native `agentapprovals`: a high-risk agent action becomes an ApprovalReq, the human decides in the console, the grant is time-bound and auditable. Slack/Teams delivery is an open Ping case; the console path is the demo | [Agent approvals — the demo that works today](../privilege/AGENT-APPROVALS-DEMO.md) | Console → Access Request Approvals |
| 9 | **Attack Lab** | Eight attack types against the real agent — Tool Abuse, Tool Poisoning, Schema Violation, Inter-Agent Abuse, Malicious Content — with strict verdict attribution | [AIGuard training guide](privilege-aiguard-training.md) | `/llm-gateway?tab=attacks` |
| 10 | **Audit evidence** | Every governed call leaves a Privilege event with an enforcement-component field, mappable to compliance controls | [Logging with Elasticsearch](../privilege/GATEWAY-LOGGING-WITH-ELASTICSEARCH.md) · [ES/Kibana runbook](privilege-elasticsearch-kibana-runbook.md) | Kibana via port-forward |

## Coverage gaps (docs that would complete this index)

- **Feature 10** — compliance mapping exists only on AIGuard deck slide 7
  (dated 2026-09-22); recheck against the tenant before quoting.

*(Closed 2026-10-13: feature 7's side-by-side matrix →
[HOSTILE-MCP-SIDE-BY-SIDE](../privilege/HOSTILE-MCP-SIDE-BY-SIDE.md);
feature 8's approval flow →
[AGENT-APPROVALS-DEMO](../privilege/AGENT-APPROVALS-DEMO.md).)*

Known demo caveats before any session: the Google lane's virtual key is
misconfigured (`403 wrong_provider` — demo Anthropic/OpenAI), and allowlists,
policies, and enrolled keys are console config — re-verify before quoting.
