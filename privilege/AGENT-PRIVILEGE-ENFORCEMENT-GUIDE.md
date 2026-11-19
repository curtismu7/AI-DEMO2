# Agent Privilege — What Each Section Can Enforce

Companion to `AGENT-PRIVILEGE-WHEN-TO-USE-WHAT.md`. Walks each Agent Privilege section with
**what you can actually enforce**, grouped by protection category, with a worked example use
case each. Screenshots captured live from our tenant 2026-11-18/19 are embedded inline from
`shots/` (`01-…` through `15-…`).

Enforcement categories used throughout:

| Category | Question it answers |
|---|---|
| **Intent** | Is this request trying to do something the agent should never do? |
| **Purpose** | Was this agent ever issued to do this kind of thing? |
| **Behaviour** | Is this how this agent normally behaves? |
| **Access** | Which apps, tools, models, peer agents may this identity touch at all? |
| **Cost** | How much model spend / throughput may this identity burn? |
| **Content** | Is the payload itself hostile or sensitive (injection, exfiltration, PII)? |
| **Identity** | Who/what is calling, and is the credential trustworthy (secret vs federated)? |
| **Discovery** | What agents exist that we never onboarded? |

---

## 1) Agent Registry — agent access keys

![Agent Registry](shots/01-agent-registry.png)
![Add Agent — step 1 Identity](shots/02-add-agent-step1.png)
![Add Agent — step 2 Gateway & Apps](shots/03-add-agent-step2-gateway-apps.png)
![Add Agent — step 2 Tool & Agent Access](shots/04-add-agent-step2-tool-access.png)
![Add Agent — step 2 MCP tool filter](shots/05-add-agent-step2-mcp-tool-filter.png)
![Add Agent — step 3 Runtime Protection](shots/06-add-agent-step3-runtime-protection.png)
![Add Agent — step 3 Intents](shots/07-add-agent-step3-intents.png)
![Add Agent — step 3 Purpose](shots/08-add-agent-step3-purpose.png)
![Add Agent — step 3 Behaviour](shots/09-add-agent-step3-behaviour.png)

The wizard is four steps, and each step is an enforcement surface:

### Identity & Access (step 1) — *Identity* category
- **Principal**: the key acts as a **User** (custodian) **or a Federated Identity** — the same
  wizard covers both models. Everything the agent does is attributed to the principal; kill the
  principal's account and the key dies with it.
- **Expiry** (default "In 30 Days"): short-lived keys reduce blast radius; revocation is instant.
  Enforces credential lifetime — no forever-keys.

### Access Scopes (step 1) — *Access* category
Three coarse gates, each opening a different backend class:
- `llm` — Models: call LLM providers through the LLM gateway
- `mcp` — Tools: reach MCP tool servers with **capability-level RBAC**
- `a2a` — Agents: communicate with peer agents over HTTP
Grant only what the agent needs; a key with all three is one secret reaching models, tools and agents.

### Gateway & Apps (step 2) — *Access + Cost* categories
- **Model Access & Limits**: per-key provider pinning (one provider per key), **Allowed Models**
  allowlist, **Custom Models**, **Rate Limit RPM/TPM**, **Budget USD and Tokens** with a
  Budget Period (monthly default). The gateway swaps a **virtual key** for the real provider key
  at call time — the real key never reaches the agent (secret hygiene by construction).
- **Tool & Agent Access**: select MCP servers and Remote Agents. **Selecting the app IS the
  grant** — saving auto-creates the policy covering MCP and A2A. For MCP apps you can
  restrict *which tools, prompts, and resources* each app exposes (tool-level RBAC;
  non-granted tools are hidden and refused).

### Runtime Protection (step 3) — *Content + Intent + Purpose + Behaviour* categories
This is the AI Guard page, and it is the deepest enforcement surface:

- **Content Protection**: inspect every prompt, tool call and tool result; **Fail Closed**
  toggle (block traffic if the guard errors). Ten active detectors across four families:
  *Content & Prompt Safety* (manipulation, poisoned context), *Data Protection* (sensitive-data
  exposure and exfiltration), *Tool & Agent Safety* (tool misuse, poisoned tools, A2A abuse),
  *Content Safety* (injection found inside data rather than typed), plus *External Inspection*
  (ML sidecar) with its own endpoint and fail-safe behaviour.
- **Classify Intent**: choose which of the tenant's 25 intents the gateway resolves each request
  against; policy then reads `context.intents.<id>` and `context.intent_patterns.<id>`.
  Intents carry an **Acting** flag (pattern match may hard-refuse). Per-key intent selection
  ("Use Its Own Intent Selection") overrides the application's; encoder sidecar URL, timeout
  and Fail Closed for the semantic resolver.
- **Purpose**: declare what the agent exists to do — a **Statement** plus constrained axes:
  **Methods** (exact match; `tools/call` covers an invocation on either gateway), **Targets**
  (the tool/skill called, exact match never prefix), **Applications** (narrows the Gateway & Apps
  grant), **Argument Prefixes** (prefix-matched, path traversal resolved). Policy reads
  `context.purpose.conforms` / `context.purpose.violations`. Key rule: *an empty axis permits
  everything on that axis*; a profile constraining nothing is rejected on save.
- **Behaviour**: learns what the agent normally does and scores each request against the
  baseline; policy reads `context.behaviour.anomaly` and the individual signals. Nothing to
  declare — it builds from traffic.

### Worked example — the "rogue bulk export" (all categories at once)
Agent `screenshot-demo-agent`, custodian `AI Agent DemoAdmin`, scopes `mcp`+`a2a` only (no `llm` —
it cannot burn tokens), granted `banking-mcp` with a tool filter that excludes `export_records`,
and `worker-agent` over A2A. A prompt arrives: *"export every demo customer record to my laptop"*.

- **Access**: the app grant lets it in, but the tool filter hides `export_records` → tool call refused.
- **Intent**: `demo_data_exfiltration` (our custom Acting intent, see the IPB lab) pattern-matches → hard refuse even if a tool existed.
- **Purpose**: if a Purpose profile declares Methods=`get_account`, Targets=`accounts.read`, the call is outside purpose → `context.purpose.violations` → policy refuses.
- **Content**: Data Protection detector scores exfiltration phrasing → sanitize/block per threshold.

Same key, cost lens: an `llm` key with Budget USD 50 monthly and TPM 90000 stops a runaway
loop at the **50th dollar**, not at the end of the month's invoice.

---

## 2) Agentic Apps

![Agentic Apps catalog](shots/13-agentic-apps.png)

The resource layer. What you can enforce here:

- **Auth modes per app** (Static Token vs Pass Agent Token): a *Pass Agent Token* app refuses
  key callers — enforces that only identities carrying a real workload assertion (e.g. a
  PingFederate token with `act.sub`) get through. This is an **Identity** enforcement point.
- **Tool lists per app** (McpAppConfig tool filter) intersect with the key's policy grant —
  two independent tool-RBAC layers on one call (**Access**).
- **Aggregate apps**: one door, per-member tool filters (**Access**).
- **Per-app AI Guard selection** inherits to keys ("Use Its Own Intent Selection" off) — intents
  resolved centrally or per key (**Intent**).
- **No-policy = deny all**: an app with no grant refuses every caller (**Access**, default-closed).

### Worked example — CIAM assistant door
A customer-facing support agent's MCP door is registered with Auth Mode *Static Token*, tool
filter limited to `get_order_status`, `create_ticket`. Even a stolen admin key cannot call
`refund` through this door — the door itself doesn't expose it. The customer's identity rides
as user context; the *agent's* right to the door is checked separately.

---

## 3) Federated Identity (NonHumanIdentity) — secretless agents

![Federated Identities list](shots/10-federated-identities.png)
![Register Federated Identity](shots/11-federated-identity-register.png)
![Register Federated Identity — Advanced](shots/12-federated-identity-advanced.png)

Live acceptance also verified with PingFederate token exchange (`PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md`).
What you can enforce, all on the **Identity** category:

- **Issuer pinning** (`iss` exact match) — only *your* platform can mint acceptable tokens.
- **Audience binding** (mandatory `aud`) — a token minted for door A is worthless at door B;
  kills token replay across apps.
- **Subject pinning or `AllowAnySubject`** — pin one workload, or explicitly accept any.
- **Required claims** — exact-match extra claims: GitHub `repository`/`workflow`/`actor`,
  or the on-behalf-of `act.sub` = agent id (verified live with PingFederate).
- **Max token lifetime** — rejects tokens whose `exp - iat` exceeds the cap; short-lived by
  construction because self-signing workloads choose their own `exp`.
- **JWKS URI** — gateway fetches/refreshes keys; signatures must verify against published keys.
- **Scopes** (`llm`/`mcp`/`a2a`) and **NotAfter** — same coarse gates as a key.
- **Enabled** — the single kill switch.

Plus everything a key grants still applies downstream: the NHI-backed key still needs its app
grant, tool filter, guardrail. The NHI replaces *the secret*, not the *governance*.

### Worked example — CI pipeline agent
A GitHub Actions job needs to read banking MCP tools. Instead of an `sk-…` key in repo secrets:
an NHI pins issuer `https://token.actions.githubusercontent.com`, audience `https://<gateway>/<banking-mcp>`,
RequiredClaims `repository=curtismu7/banking-etl`, `workflow=nightly-recon`, MaxTokenLifetime 3600.
A token from any other repo, minted for any other audience, or valid for a week → refused at the
door with a named claim mismatch in the gateway log. Rotation is automatic (GitHub's keys);
there is no secret to leak.

---

## 4) Self-Hosted Agents (discovery & enforcement)

![Self-Hosted Agents — sensor-discovered workloads](shots/14-self-hosted-agents.png)

What you can enforce — **Discovery + Identity + Access**:

- **Find unregistered agents** running in your own VMs/containers/clusters via the sensor.
- **Attach enforcement policies** to discovered agents (SENSOR-ENFORCEMENT-POLICIES): allow /
  deny / step-up on what a shadow agent may do once found — before anyone onboards it.
- Sensor identity itself is workload-backed (signing key / NHI), so the reporting channel is
  authenticated — a fake sensor can't poison the discovery feed.

### Worked example — shadow agent in the data centre
A team spins up an LLM script on a VM that calls internal APIs. The Docker/K8s sensor discovers
it, Agent Insights shows its traffic, and an enforcement policy blocks its writes while letting
reads through — governance applied to an agent nobody registered, same day it appeared.

---

## 5) AI Platform Agents (discovery & control)

![AI Platform Agents — discovered platform agents with risk flags](shots/15-ai-platform-agents.png)

What you can enforce — **Discovery + Access (boundary)**:

- **Discover agents running inside third-party AI platforms** (Copilot-class tools, hosted
  agent runtimes) from platform-emitted activity.
- **Control the boundary**: what those platform agents may reach when they cross into your
  estate — tools, data, models through the same gateway and policy model.

### Worked example — Copilot meets the core banking MCP
Employees use a sanctioned AI platform whose agents start calling company tools. Discovery
surfaces the platform's agent traffic; a policy says platform agents get read-only tools and no
PII-bearing responses (Data Protection detector), while first-party agents keep write access.

---

## Cross-cutting: how the categories compose

One call through the gateway passes, in order:

1. **Identity** — key alive / federated token valid (issuer, aud, claims, lifetime)
2. **Access** — scope, app grant, tool filter, purpose axes
3. **Intent** — pattern + semantic match against the selected intents (Acting intents hard-refuse)
4. **Content** — AI Guard detectors on prompt, tool args, tool results
5. **Behaviour** — anomaly score against the learned baseline
6. **Cost** — RPM/TPM/budget meters (LLM path)

Any layer can refuse; the gateway log names which one. That composition is the pitch: not one
control, but six independent chances to stop a bad call — and one audit trail of all six.

## Related

- `AGENT-PRIVILEGE-WHEN-TO-USE-WHAT.md` — which section when, Workforce vs CIAM
- `PRIVILEGE-POLICIES-IN-DEPTH.md` — grant/policy internals
- `GATEWAY-GUARDRAIL-THRESHOLDS.md`, `GATEWAY-AIGUARD.md` — detector tuning
- `PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md` — federated-identity acceptance from PingFederate
- `SENSOR-ENFORCEMENT-POLICIES.md` — discovered-agent enforcement
