# Agent Privilege — When to Use What

A field guide to the five sections of the PingOne Privilege **Agent Privilege** console area: what each one is, what it can do, when to reach for it, and how it maps to Workforce vs CIAM customer conversations.

Terminology note (Ping deck "ID4AI Workforce - H2 2026"): **Federated Identity** is the new display name for Non-Human Identity (NHI); **Self-Hosted Agents** was "NHI Agents Discovery & Enforcement"; **AI Platform Agents** was "Workload Agent Discovery & Control". The console API still uses `NonHumanIdentity` / `nonhumanidentities` — use the new names with people, the old names in code.

---

## The mental model

Three layers, and every "it doesn't work" ticket is a mismatch between two of them:

1. **Identity** — *what the agent is.* An agent access key (Agent Registry) or a federated/workload identity (Federated Identity). No identity, no call.
2. **Grant** — *what the agent may reach.* Created automatically when you select an Agentic App on a key, or authored as a policy (`pacpolicys`) for federated identities. Scoped to MCP tools, A2A agents, or LLM providers/models.
3. **Guardrail** — *what screens the agent's traffic.* Per-key AI Guard, runtime protection, and the sensor/enforcement layer for discovered agents.

Then, above the layers you control yourself:

4. **Discovery** — *what agents exist that you don't control.* Self-Hosted Agents and AI Platform Agents find them and attach enforcement.

---

## 1) Agent Registry — agent access keys

**What it is.** The place you mint an agent's identity. An access key is one credential that *is* the agent: scopes (`llm` / `mcp` / `a2a`), allowed models, RPM/TPM/budget, expiry, guardrail, and reachable apps all hang off the key. The agent sends `Authorization: Bearer <key>` — no sign-in, no token exchange.

**What it can do.**
- Give each agent its own identity with a **custodian** (the human it acts as — policy is issued to the custodian; if their account goes inactive, the key stops working).
- Gate by scope and app: selecting apps on the key **is** the grant — saving auto-creates a policy. For MCP apps the grant can list tools; the rest are hidden and refused.
- For LLM keys: one provider per key, model allowlist, rate and budget caps; Privilege holds the real provider key and injects it server-side, so the agent only holds a virtual key.
- Per-key AI Guard (runtime protection step), rate limiting enforced natively at the gateway.
- Revoke (`Revoked: true`) as the instant non-destructive kill; expiry for lifecycle.

**Use when.** You (the customer) are building or onboarding your own agents and want governed access to models, MCP servers, and A2A agents — the default starting point for nearly every agent deployment.

**Don't use when.** You can't accept any static secret (a key *is* a static secret) — use Federated Identity instead.

**Workforce vs CIAM.** Primarily a **workforce / enterprise IT** story: internal AI agents, developer-built automations, and service accounts with a named human custodian answering for them. In CIAM it appears where a *customer-facing* AI agent (support copilot, in-app assistant) calls back-end tools on the user's behalf — but the governance, budgeting, and custodian model are enterprise-shaped.

## 2) Agentic Apps

**What it is.** The resource layer — the things agents reach: registered MCP apps (`/<app>/mcp`), A2A agents (`/<app>/a2a/...`), and LLM providers fronted by the AI Gateway.

**What it can do.**
- Register MCP servers and A2A agents behind the agentless gateway, with auth modes (Static Token vs Pass Agent Token), tool lists, and guardrails.
- Aggregate apps (compose several backends behind one door).
- Serve as the *target* of grants: a key or federated identity is authorized per-app (and per-tool).

**Use when.** You are exposing any MCP server, A2A agent, or LLM provider to agents — you cannot issue a grant without an app to point at.

**Workforce vs CIAM.** Same split as the registry: mostly workforce (internal tool surfaces), plus CIAM where the app is a customer-facing assistant's tool backend.

## 3) Federated Identity (NonHumanIdentity) — secretless agents

**What it is.** An **external token issuer** an agent authenticates against instead of holding a key: expected `iss`, mandatory `aud` bound to a specific door, subject pinning, JWKS URI, max token lifetime, and required claims. The agent presents a platform-issued JWT (Kubernetes service account, GitHub Actions OIDC token, SPIFFE, PingFederate-issued token…); there is no secret to leak, rotate, or accidentally commit.

**What it can do.**
- Bind trust to a specific platform and even a specific workload (e.g. `RequiredClaims` = GitHub repository + workflow).
- Cap token lifetime (rejects tokens whose `exp - iat` exceeds the limit — necessary because self-signing workloads choose their own `exp`).
- Gate grants on token claims (`PolicyRule.RequiredClaims` — e.g. `act.sub` must equal the agent id for on-behalf-of flows).
- Back an agent key: a key whose custodian is the NHI authenticates with the federated token — never both a key-level `WorkloadIdentity` *and* an NHI custodian (the API refuses).

**Use when.** The agent already has a platform identity you trust (k8s pod, CI job, PF-issued token), security requires zero static credentials, or you need claim-level binding (which key, which repo, which human delegated). The default for anything Kubernetes- or CI-hosted.

**Caveat.** An NHI does not authenticate anyone by itself — it needs a key behind it (watch for the gateway log tell `rebuilding 0 key(s)`) and a grant.

**Workforce vs CIAM.** **Workforce / infrastructure** story through and through: platform engineers, DevOps pipelines, service meshes. CIAM rarely issues workload tokens for end customers — if a customer-facing agent needs user identity, that flows as user context on the call, not as an NHI.

## 4) Self-Hosted Agents — discovery & enforcement

**What it is.** Discovery and enforcement for agents **you run yourself** in your own infrastructure. A sensor (Docker or Kubernetes) discovers agent activity in the environment, reports it to Privilege, and enforces policies on it.

**What it can do.**
- Find agents nobody registered — shadow agents — and surface them for governance.
- Attach enforcement policies to discovered agents (SENSOR-ENFORCEMENT-POLICIES): allow/deny/step-up on what they may do.
- Pair with the sensor identity story (a signing key the sensor mints; workload-identity-backed where possible).

**Use when.** The customer has agents running in their own VMs, containers, or clusters that weren't onboarded through the registry — the "find and control what's already there" motion.

**Workforce vs CIAM.** Almost purely **workforce / enterprise**: shadow AI in the corporate estate is a workforce-security problem.

## 5) AI Platform Agents — discovery & control

**What it is.** Discovery and control for agents running inside **third-party AI platforms** (hosted copilots, managed agent runtimes) — workloads whose identity and runtime belong to a platform, not to the customer's infrastructure.

**What it can do.**
- Discover agent activity emitted by AI platforms and bring it under the same policy model.
- Control what platform-hosted agents may reach when they cross into the customer's estate (tools, data, models via the gateway).

**Use when.** The customer has adopted external AI platforms (Copilot-class tools, SaaS agent builders) and wants visibility and control over what those agents do against enterprise resources.

**Workforce vs CIAM.** **Workforce**: these are employee-facing platform agents. The CIAM-adjacent concern is only at the boundary — what a platform agent may access on behalf of a user.

---

## Workforce vs CIAM — the summary table

| | Workforce | CIAM |
|---|---|---|
| **Who the agent acts as** | An employee (custodian) or a workload | An end customer (user context on calls) |
| **Agent Registry** | Core: internal agents with human custodians, budgets, guardrails | Only for the customer-facing assistant's tool access; governance stays enterprise-shaped |
| **Agentic Apps** | Internal MCP/A2A/LLM surfaces | The assistant's back-end tool apps |
| **Federated Identity** | Core: k8s/CI/PF workload tokens, zero static secrets | Rare — customers don't present workload tokens |
| **Self-Hosted Agents** | Core: shadow-agent discovery in the corporate estate | Not applicable |
| **AI Platform Agents** | Core: Copilot-class platform agents | Boundary control only |

**The one-line pitch per audience.**
- *Workforce:* "Every agent gets an identity, a human custodian, a grant, and a guardrail — including the ones you didn't onboard yourself."
- *CIAM:* "Your customer-facing assistant gets governed, auditable, budget-capped access to tools and models — with per-agent guardrails in front of every call."

---

## Related repo docs

- `privilege/WORKLOAD-IDENTITY-AGENT-CALLERS.md`, `privilege/GATEWAY-WORKLOAD-IDENTITY-SETUP.md` — federated identity deep dives
- `privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md` — end-to-end key setup
- `privilege/SENSOR-DOCKER-GUIDE.md`, `privilege/SENSOR-KUBERNETES-GUIDE.md` — sensors for self-hosted discovery
- `privilege/PRIVILEGE-POLICIES-IN-DEPTH.md` — grants and policy rules
- `privilege/GATEWAY-A2A-AUTH-MODES-COMPARED.md` — Static Token vs Pass Agent Token
