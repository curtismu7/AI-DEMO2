# Cedar spike for the Privilege demo (read-only research)

Date: 2026-10-20. Nothing in any repo was edited. A throwaway prototype lives outside the repos at
`/private/tmp/claude-502/-Users-cmuir--agents/c7c590a7-9b81-4772-8e0c-fb0d6aba0c83/scratchpad/research/cedar-prototype/`
(`schema.cedarschema`, `policies.json`, `run.mjs`, `counterfactual.mjs`; deps in `../npmprobe/`). Every decision table below was produced by running that code against `@cedar-policy/cedar-wasm@4.14.0`.

Paths are relative to `/Users/cmuir/Development/AI-DEMO2/` unless they start with `/`.

---

## 0. Read this first: three findings that change the question

1. **The "AI Policies" tab already is Cedar, and it belongs to Ping's console, not to any repo we own.**
   It is the console page Access Management -> AI Policies (`/ui/admin/ai-policys`, editor at `/ui/admin/ai-policys/create`),
   "Rules are Cedar, authored from template cards" (`privilege/GATEWAY-RELEASE-v1.261009-DEMO.md:95`).
   The gateway evaluates those rules itself on every agent action (`docs/superpowers/plans/2026-10-12-v1.261009-demo-steps.md:62`).
   So "use Cedar in the AI Policies tab" has two possible meanings, and the plan does not say which:
   - **(A) Drive the real console.** Author Cedar into the real Privilege tenant through `aipolicys`. The engine is Ping's, hosted in the gateway.
   - **(B) Build our own AI Policies tab in the standalone demo**, backed by the open-source Cedar engine, with PF tokens as the identity input.
   **Recommendation: build (B) as the demo's core (it is the only one that works offline, in mock mode, and with PF claims), and keep (A) as an optional "publish to the real tenant" lane that reuses the same policy text.** This needs a user decision (see Open questions).
2. **No "AI Policies" tab exists in any local code.** I searched `AI-DEMO2`, `Privilege-standalone`, `standalone/*`, `demo_mcp_gateway`, `demo_mcpgw`, `demo_api_ui`. The only "Policies" tab is a read-only viewer of `pacpolicys` (the older access grants), not Cedar. Details in section 1.
3. **The real console's Cedar cannot see a PF token today.** A measured investigation (commit `533c993c4`, branch `docs/pf-cedar-claims`, file `privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md`) found: the door trusts only itself, PF is not registered as an IdP, Cedar reads a fixed attribute set with no raw claims, no `act`, no ID-JAG hook. That is exactly why an engine we embed ourselves (B) is the way to make "PF token claims drive Cedar" true on stage. A later memory note says the gateway has a native, non-Cedar external-issuer gate (`AgentWorkloadIdentity` + `PolicyRule.RequiredClaims` in `pacpolicys`) that supersedes part of that doc; that finding is from swagger only and was not exercised live (see section 8).

---

## 1. Where the Privilege "AI Policies" tab lives and how policies work today

### 1.1 What exists, with citations

| Thing | Where | Notes |
|---|---|---|
| Console AI Policies page (Cedar) | Ping's Privilege console, `/ui/admin/ai-policys` | `privilege/GATEWAY-RELEASE-v1.261009-DEMO.md:95`; screens captured 2026-10-12 |
| Policy storage | console API object `aipolicys` (NOT `pacpolicys`) | `planning/HANDOFF-2026-10-13-privilege-docs-and-agents.md:51`; tenant API key authorizes `aipolicys` but not `llmrules`/`aiguardconfigs` (`GATEWAY-RELEASE-v1.261009-DEMO.md:43`) |
| Older access grants | `pacpolicys` (union of grants, per app) | `privilege/PRIVILEGE-POLICIES-IN-DEPTH.md:13-31`; `.claude/skills/privilege-console-api/SKILL.md:93` |
| Demo client "Policies" tab | `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx:213-216` (`inspect: ['mcp','rpc','policies','relay','scopes']`) | Read-only list of doors and `pacpolicys`; helper comment at `:50` says the `pacpolicy` Spec schema is undocumented so it is only text-searched, "MENTIONS a name, never that it grants access". Server side: `demo_api_server/routes/privilegeMcpClient.js:2755-2825` |
| Same viewer in the standalone | `Privilege-standalone/ai-gateway-client` and `standalone/ai-gateway-client/server/lib/relay.js:950,975` | Same `pacpolicys` fetch; **no** `aipolicys` code anywhere in either |
| Cedar vocabulary on record | `privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md` (git: `533c993c4`, unmerged branch `docs/pf-cedar-claims`) and `planning/HANDOFF-2026-10-13-privilege-docs-and-agents.md:29-70` | The only documented Cedar attribute list |
| Diagram of PF to Cedar | `demo_api_ui/src/config/privilegePfCedarDiagram.js` (same commit) | ReactFlow config, "Route A" PF-as-IdP shown dashed (not set up) |
| Standalone Privilege repo | `/Users/cmuir/Development/Privilege-standalone/{ai-gateway-client,llm-gateway,mcp-inspector}` | No policy engine; `llm-gateway` has `residencyPolicy.js`, `promptRedact.js` (own logic, not Cedar) |

### 1.2 How policies are modeled and evaluated today (real gateway)

Two separate policy systems, easy to conflate:

**`pacpolicys` (access grants, not Cedar).**
- Effective grant = union of every non-expired policy binding the identity, deduplicated at `tools/list` (`PRIVILEGE-POLICIES-IN-DEPTH.md:13-31`).
- A freshly registered app denies everything until a policy exists (`:78-86`). Default-deny, no inheritance, policies are per-app (`:104-108`).
- Denied tools are dropped from `tools/list`, so the client sees absence rather than a 403 (`:52-66`). The catalog an agent sees IS its privilege level.
- Spec schema is undocumented (`privilegeMcpClient.js:50`), `NotAfter` is a real top-level field.

**`aipolicys` (Cedar, evaluated per call).**
- Vocabulary (measured from the editor and 5 live policies, `PF-CLAIMS-IN-CEDAR-POLICIES.md` "What Cedar can see"):

  | Protect on | Cedar expression |
  |---|---|
  | token scope | `context.token.scopes.contains("x")` |
  | agent-key scope | `context.agent.scopes.contains("x")` |
  | caller's group | `principal in Group::"x"` |
  | named agent | `principal == Agent::"x"` |
  | door/app | `context.app == "x"` |
  | tool | `resource == Tool::"x"` |
  | tool args | `context.args.<name>` |
  | approval state | `context has approval_count && context.approval_count >= 1` |
  | content findings | `context.aiguard.pii_kinds`, `context.aiguard.categories` |

  Actions: `mcp:Invoke` (refuse), `mcp:InvokeUnattended` (hold for a human), `llm:Receive` (LLM replies).
- Annotations used by the real policies: `@grant("capability")`, `@ttl`, `@request_ttl`, `@approvers("<id>")`, `@reason("...")` (`PF-CLAIMS-IN-CEDAR-POLICIES.md` step 3).
- States: **Active** (enforced) vs **Candidate** (validated, stored, never enforced) (`GATEWAY-RELEASE-v1.261009-DEMO.md:95`). A policy created through the API lands with `State:''` and is never enforced until `PUT` to `Active` (memory `ai-demo2-opensearch-hitl-demo`; `HANDOFF...:51`).
- Principal registry reported in the gateway log: `125 entities: 4 users (+4 email aliases), 4 agents, 1 groups, 112 resources`. Callers match Privilege users by email alias (inferred, untested) (`PF-CLAIMS-IN-CEDAR-POLICIES.md`).
- Decision events: `Event: llm_policy_response_denied`, `Decision: deny`, `PolicyIDs: ["llm-response-pii-withhold:1"]`, `Principal: User::"03de..."`, `GrantShape`, `msg: "AIPolicy"` (`GATEWAY-RELEASE-v1.261009-DEMO.md:109-112`; `privilege/AUDIT-EVIDENCE-COMPLIANCE.md:39-52`). MCP side: `mcp_policy_denied`, `mcp_policy_approval_required` with `PolicyIDs`; a hold opens an `ins_...` approval in `agentapprovals` and the client retries after approval (memory `ai-demo2-opensearch-hitl-demo`; `privilege/AGENT-APPROVALS-DEMO.md:85-87`).
- Policy text can be template-authored (the console builds the Cedar from template cards: refuse a prompt with PII, withhold a completion with PII, restrict a tool to a scope, a named agent may never call a tool, per-team rules). Hand-written Cedar was not exercised in the PII runbook (`demo-steps.md:66`).

### 1.3 What the UI lets a user do (real console)

From the runbook and the PF-claims investigation: pick a **template card**, fill detector ids/tools/groups/scopes/approvers, choose **State** (Active or Candidate), save; the editor also shows a Cedar vocabulary example. Propagation to the gateway takes about 30 s with a log line `aipolicy: ... compiled N policies`. CRUD for rules via API needs the console session cookie; the tenant API key reaches `aipolicys` only.
What it cannot do (as far as recorded): test a request against policies, show which policy would have decided, dry-run a token. That gap is what the standalone tab adds.

---

## 2. Engine options (verified with `npm view` / registry calls, 2026-10-20)

| Option | Version | License | Verdict |
|---|---|---|---|
| **`@cedar-policy/cedar-wasm`** | **4.14.0** (published 2026-10-19; dist-tags `latest` 4.14.0, `v3.4-x` 3.4.3) | Apache-2.0 | **Use this.** Maintained by AWS (maintainer `cedar-wasm-team@amazon.com`), npm trusted-publisher via GitHub Actions. Three targets: `.` (ESM/bundler), `./nodejs`, `./web` (needs `init()`). Cedar lang 4.6 (`getCedarLangVersion()`). Unpacked 13.5 MB across the three builds; each `.wasm` is 4.2 MB (1.46 MB gzip). |
| `@cedar-policy/mcp-schema-generator-wasm` | 0.6.1 (2026-09-23) | Apache-2.0 | Optional. Generates a Cedar schema from the `tools` array of `tools/list` (`generateSchema(stub, toolsJson)`), from `github.com/cedar-policy/cedar-for-agents`. Useful for the Inspector-style "paste a server, get a schema". Not exercised by me beyond reading its README. |
| `@cedar-policy/cedar-authorization` | 0.2.0 (2026-03-27) | Apache-2.0 | JS/TS authz helpers on top of Cedar. Pre-1.0, unreviewed. Skip. |
| `@cedar-policy/cedar-js` | does not exist (404) | n/a | Do not use that name. |
| `cedar-policy` (unscoped npm) | 1.0.0 (2023, empty 208-byte package) | ISC | Squatted/empty. Never install. |
| `@highflame/policy` 2.8.0 (Apache-2.0), `@stackone/policy` 0.20.1 (ISC) | third-party wrappers | | Vendor-specific; no reason to adopt. |
| Rust crate `cedar-policy` | 4.14.0 (crates.io, updated 2026-10-17) | Apache-2.0 | The reference engine; what the wasm wraps. Only relevant if the server were Rust. |
| Java `com.cedarpolicy:cedar-java` | 4.10.0 (Maven Central metadata) | per repo (UNVERIFIED) | Lags the Rust core by 4 minors. Relevant only if a JVM piece (PingGateway, PF plugin) must call Cedar. |

Wasm API surface actually present in 4.14.0 (read from `nodejs/cedar_wasm.d.ts`): `isAuthorized`, `isAuthorizedPartial`, `statefulIsAuthorized`, `validate`, `checkParseSchema/PolicySet/Entities/Context`, `policyToJson`, `policyToText`, `policySetTextToParts`, `formatPolicies`, `schemaToJson`, `getCedarVersion`. `preparsePolicySet`/`statefulIsAuthorized` exist for caching a parsed policy set.

Measured on this machine (Node 26.8.2, wasm nodejs target): about 0.8 ms per `isAuthorized` without a schema, about 3.3 ms with schema plus `validateRequest`. Fast enough for live clicks; use `preparsePolicySet` + `statefulIsAuthorized` only if volume ever matters.

---

## 3. Where evaluation runs

| Option | For | Against |
|---|---|---|
| **Server (Node, `cedar-wasm/nodejs`)** | Raw tokens never reach the browser (base requirement 4); the server is the policy enforcement point (PEP) in front of the MCP backend, so a "block" really blocks; emits the trace envelope (F2) at the hop; one engine for mock and live | Needs a server (the kits already have one) |
| Browser wasm (`cedar-wasm/web`) | Instant editor feedback: validate policy text against the schema while typing, "what would this policy do" preview, no round trip | 4.2 MB wasm (1.46 MB gzip) shipped to every viewer; Vite/ESM wasm loading is **UNVERIFIED** here (I only ran the Node target); a browser decision proves nothing about enforcement; sending a decoded token into the browser conflicts with the redaction rule unless claims are pre-redacted |

**Recommendation: server is authoritative; browser wasm only for editor lint and preview, pinned to the same package version, fed redacted claim fixtures, never a raw token.** In v1 even the lint can go through a `POST /api/policies/validate` that runs the same server wasm, which avoids shipping the wasm to the browser at all. Add browser wasm later if latency of the editor feels bad (UNVERIFIED that it will).

Pin `@cedar-policy/cedar-wasm` exactly (no caret): the package updates frequently (4.14.0 landed yesterday) and Cedar validation messages are part of the demo output.

---

## 4. Mapping a PF access token to Cedar

Principle: Cedar never sees the JWT. The server verifies the token (JWKS, `iss`, `aud`, `exp`), then builds **entities** and a **context** from the verified claims. This one function is the entire mapping layer, so it is also the talk-track ("here is exactly what the policy sees").

What PF claims actually exist in the kit today (sources: `/Users/cmuir/Development/id-jag-standalone/docs/setup-guides.md:50-70,85-86` for the ID token: `email`, `email_verified` as a JSON boolean, `name`, multi-valued `groups`; `docs/resource-as.md:126-135` for the resource-AS access token: `iss`, `sub`, `aud`, `client_id`, `scope`, `jti`, `iat`, `exp`; `docs/interop-lab.md:10` shows `act.sub` in a third-party AS token). **Our own `resource-as` access token carries no `act` and no `groups`** (only the ID token has `groups`). So S08-style `act` policies need the token to carry `act`, which PF only does as an object with server-wide OGNL on; with OGNL off it is a string (`privilege/WORKLOAD-IDENTITY-AGENT-CALLERS.md`, SPIFFE section). Treat `act` as a conditional input.

| Token claim | Cedar element | Notes |
|---|---|---|
| `sub` | principal `User::"<sub>"` | Entity id. Never put raw `sub` in a policy; use groups. |
| `groups` (array) | `parents` of the principal: `Group::"<g>"` | Enables `principal in Group::"finance"`. Same shape the real console uses. PF must emit `groups` in the token that is evaluated (ID token has it; the access-token path needs the mapping added: **UNVERIFIED** in the kit). |
| `scope` (space string) | `context.token.scopes` (Set<String>) | Split on space. Mirrors the console's `context.token.scopes`. |
| `client_id` | `context.token.client_id` (demo extension) or `Agent::"<client_id>"` when the caller is an agent | Console has `principal == Agent::"x"` for named agents. |
| `act.sub` | `context.token.actor` (optional, demo extension) | Lets a policy require delegation (see optional policy 7). Only when PF emits `act` as an object. |
| `email`, `email_verified` | not a principal attribute by default | Keep out unless a story needs it; the kit's admin gate already uses it. If wanted: add as `User` attributes in the schema. |
| `aud`, `iss`, `exp`, `jti` | not in Cedar | Checked by the verifier before Cedar runs (they are authentication, not authorization). |
| tool name | `resource == Tool::"<name>"` | From the MCP `tools/call` params. |
| door/app | `context.app` | From the route. |
| tool arguments | `context.args.<name>` | From `tools/call`. Typed per tool in a fuller schema. |
| approval state | `context.approval_count` | From the HITL service. |

Keep the schema vocabulary a **subset of the real console's** (`context.app`, `context.args`, `context.token.scopes`, `principal in Group`, `context.approval_count`, `Action::"mcp:Invoke"/"mcp:InvokeUnattended"`). Then a policy written in the standalone can be pasted into the real console unchanged, which is what makes lane (A) cheap and the story honest. Attributes marked "(demo)" in the schema below are extensions the real console does not have.

**Action naming vs the brief:** the brief says action `tool:call`. I used the console's `mcp:Invoke` (and `mcp:InvokeUnattended` for hold) so policies stay portable. Renaming is a one-line schema change if you prefer `tool:call`.

---

## 5. Cedar schema for MCP tool calls

Validated clean (0 errors, 0 warnings) by `cedar.validate` in strict mode, and used by `isAuthorized` with `validateRequest: true`. File: `.../research/cedar-prototype/schema.cedarschema`.

```cedarschema
// Vocabulary deliberately mirrors what the real Privilege console editor exposes (see PF-CLAIMS-IN-CEDAR-POLICIES.md):
// Action::"mcp:Invoke" / "mcp:InvokeUnattended", Tool::"x", context.app, context.args.*, context.token.scopes,
// principal in Group::"x", context.approval_count. Fields marked (demo) are extensions the real console does not have.
entity Group;
entity User in [Group];                 // sub, groups claim -> parents; no attributes needed
entity Agent in [Group];                // a named agent (client_id)
entity Tool;

type ToolCallContext = {
  app: String,                          // the door / MCP app, e.g. "booking"
  args: { amount?: Long },              // tool arguments (typed per tool in a fuller schema)
  token: {
    scopes: Set<String>,
    client_id: String,                  // (demo) from the PF token
    actor?: String,                     // (demo) act.sub from the PF token
  },
  approval_count: Long,
  pinnedHash: String,                   // (demo) schema hash approved at onboarding
  observedHash: String,                 // (demo) hash of what the server advertises now
};

action "mcp:Invoke", "mcp:InvokeUnattended" appliesTo {
  principal: [User, Agent],
  resource: Tool,
  context: ToolCallContext,
};
```

Mapping to the brief: principal User/Agent (yes), action tool call (`mcp:Invoke`), resource Tool (yes; the "Server" level is `context.app`, because the real console has no Server entity), context (scopes, args, token, approvals, hashes).
Schema is how vocabulary drift is caught: a policy written against a made-up `context.claims` is rejected at save time with `attribute 'claims' in context for Action::"mcp:Invoke" not found` (verified). That doubles as the talk-track for "Cedar reads a fixed vocabulary, here is why".

---

## 6. Six sample policies (S04, S05, S01, S23), with verified outcomes

File: `.../research/cedar-prototype/policies.json` (ids are the policy ids that appear in decisions). All six validate against the schema.

```cedar
// s04-analysts-search-ticketing   (S04: Mary gets 2 of 3 tools)
@reason("Analysts may use Search and Ticketing")
permit (principal in Group::"analysts", action == Action::"mcp:Invoke", resource)
when { context.app == "search" || context.app == "ticketing" };

// s04-payments-finance-only       (S04: the third tool needs a different group AND a scope)
@reason("Payments is for finance, with the payments:write scope")
permit (principal in Group::"finance", action == Action::"mcp:Invoke", resource)
when { context.app == "payments" && context.token.scopes.contains("payments:write") };

// s05-rugpull-pin                 (S05: forbid when the tool schema is no longer the approved one)
@reason("Tool schema changed since it was approved")
forbid (principal, action, resource)
when { context.pinnedHash != context.observedHash };

// s01-hold-large-fare             (S01: hold for a human; same shape as the live hitl-opensearch policy)
@reason("Fares over 1000 need a second pair of eyes")
@approvers("priya")
forbid (principal, action == Action::"mcp:InvokeUnattended", resource == Tool::"book_fare")
when { context.args has amount && context.args.amount > 1000 }
unless { context.approval_count >= 1 };

// s23-permit-travel-agents        (S23: a permit that says yes)
@reason("Travel agents may book fares")
permit (principal in Group::"travel-agents", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { context.app == "booking" };

// s23-forbid-over-cap             (S23: a forbid that overrides it)
@reason("Hard cap: no booking over 10000 for anyone")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource == Tool::"book_fare")
when { context.args has amount && context.args.amount > 10000 };
```

A delegation-required rule for S08 (Dot may only book when the token carries `act`) worked in an earlier flat-context version of the prototype (allow with `act`, deny without) but is not in the final six and was not re-run in the final context shape. It also depends on PF emitting `act` as an object.

### Verified decisions (`node run.mjs`, cedar 4.14.0)

| Story | Request | Decision | `diagnostics.reason` |
|---|---|---|---|
| S04 | mary (analysts) -> `search_docs` | allow | `s04-analysts-search-ticketing` |
| S04 | mary -> `create_ticket` | allow | `s04-analysts-search-ticketing` |
| S04 | mary -> `pay_invoice` (no policy matches) | **deny (default-deny example)** | `[]` (empty) |
| S04 | fin1 (finance + `payments:write`) -> `pay_invoice` | allow | `s04-payments-finance-only` |
| S05 | mary -> `search_docs` with `observedHash != pinnedHash` | deny | `s05-rugpull-pin` |
| S01 | ta1 -> `book_fare` 2400, `mcp:InvokeUnattended`, approvals 0 | deny (the hold) | `s01-hold-large-fare` |
| S01 | same, `approval_count: 1` | allow | `s23-permit-travel-agents` |
| S01 | ta1 -> `book_fare` 400 | allow | `s23-permit-travel-agents` |
| S23 | ta1 -> `book_fare` 12000 (permit AND forbid both match) | **deny (forbid overrides permit)** | `s23-forbid-over-cap` only |
| S23 | ta1 -> `book_fare` 900 | allow | `s23-permit-travel-agents` |

Three facts the demo must handle, all observed:
- **Default deny returns an empty `reason` list.** The trace must synthesize `rule: "default-deny"`; there is no policy id to show.
- **When a forbid wins, `reason` lists only the forbid.** The overridden permit is not reported. For S23's "even though another rule says yes", run a counterfactual evaluation with the forbids removed (verified: `permits only -> allow [s23-permit-travel-agents]`, full set `-> deny [s23-forbid-over-cap]`) and show both. `counterfactual.mjs` does exactly this.
- **Cedar scope `resource in [..]` is rejected** (`expected single entity uid ... found set`); only `action in [..]` takes a set. I hit this and moved the app test into `when` (`context.app == ...`). Useful for anyone hand-writing policies live.

### Hold vs deny (inferred, not verified against the real gateway)
Cedar returns only allow/deny. The real console turns a forbid on `mcp:InvokeUnattended` that carries `@approvers` into a hold (`Decision:"hitl"`, `mcp_policy_approval_required`). The standalone PEP should do the same: evaluate `mcp:Invoke` first (deny -> deny), then `mcp:InvokeUnattended` (deny with `@approvers` -> **hold**, else deny). The exact real-gateway ordering is **UNVERIFIED**.

---

## 7. Feeding the decision into the trace envelope (plan F2) and the talk-track

Plan envelope (`planning/standalone-demo-family-plan.md:220-223`): `{ trace_id, span_id, parent_span_id, product, hop, subject, actor, spiffe_id, decision {result, rule}, latency_ms, llm {...}, ts }`.

Mapping from one Cedar evaluation:

| Envelope field | From |
|---|---|
| `product` | `"cedar"` (or `"privilege-policy"`); add `engine_version: "4.14.0"` |
| `hop` | `"policy:ai-policy"` |
| `subject` | principal `sub` (the verified claim, not the token) |
| `actor` | `context.token.actor` (`act.sub`) when present |
| `decision.result` | `allow`, `deny`, or `hold` (hold = deny + `@approvers` on the deciding forbid on `mcp:InvokeUnattended`) |
| `decision.rule` | `diagnostics.reason[0]`, or `"default-deny"` when empty |
| extra (propose adding `decision.rules[]`) | all of `diagnostics.reason`, plus `overridden: [ids]` from the counterfactual run when a forbid won |
| `latency_ms` | wall time around `isAuthorized` (about 1-4 ms measured) |
| never in the envelope | the token, `jti`, signatures |

Talk-track: the `@reason("...")` annotation is the one-line "why". Verified `policyToJson` returns annotations as `{ approvers: "priya", reason: "Fares over 1000 ..." }`, so the panel can show reason text straight from the policy, with no second source of truth. The story file `stories/<id>.json` (stories doc, rule 7) then only names the policy ids it expects per step, and a test asserts the engine returns them. The "decision record" proof the stories ask for (S01, S22, S23) is: principal, action, resource, context (redacted), decision, deciding policy id + reason text, counterfactual.

Real-console parity: the live gateway's event already carries `Decision`, `PolicyIDs`, `Principal` (`GATEWAY-RELEASE-v1.261009-DEMO.md:109-112`); the standalone envelope reuses those names so lane (A) events map one-to-one.

---

## 8. Integration lanes: can the gateway call out to Cedar at all?

| Lane | What it is | Status |
|---|---|---|
| **B (core): standalone PEP** | The demo's own server proxies `tools/call` to a mock or real MCP backend and asks local Cedar first. Policies live in `data/policies/*.cedar` with Active/Candidate state. | Fully in our control; works offline; **recommended** |
| **A (optional): publish to the real tenant** | Same policy text `PUT` to `aipolicys` with `State:'Active'`, run a call through the real door, show Ping's own log line next to ours | Needs the console session cookie, a shared-tenant write (explicit OK required), and the PF token is **not** what the door evaluates. Writes are blocked without approval in this environment. |
| **C: gateway calls our Cedar** | Real gateway delegating decisions to an external PDP | **UNVERIFIED and probably impossible today.** I found no external-PDP/callout setting in `privilege/*.md`; the only outbound hook documented is AI Guard's webhook (`privilege/AGENTLESS-CONFIGURATION.md:11,39`, `aiguard.WebhookResponse`). Do not promise it. Verify by asking Ping or reading the swagger for a PDP/authorizer object. |

Related native feature the team should know about before promising "PF claims in Cedar": memory note `privilege-external-issuer-requiredclaims` (2026-10-20, swagger only, live state unread because the console was down) says Privilege can trust an external issuer (PF) through `AgentWorkloadIdentity` (Issuer, Audience, JwksURI, RequiredClaims) and gates on token claims through `PolicyRule.RequiredClaims` in `pacpolicys`, which is **not Cedar**, and applies to agent callers presenting a JWT, not the human door login. Treat that as a lead to verify, not a fact.

---

## 9. Mock-mode strategy (works offline)

Cedar is local, so mock mode needs no stub of the engine, only of the inputs:
1. `@cedar-policy/cedar-wasm` is an npm dependency with the wasm inside the package. No network at runtime. Verified: the prototype ran with only local files.
2. Identity input in mock mode = **fixture claim sets** (decoded-token JSON per persona: Mary, finance user, travel agent with `act`), stored in `stories/<id>.json` with the policies they expect. The mapper (section 4) runs on the fixture exactly as on a verified token, so mock and live share the code path after verification.
3. Tool catalog and arguments = fixtures. Backend responses = story mock responses.
4. Policy store = files in the repo; Reset restores the shipped set (ties to Phase 0.8).
5. A preflight check: wasm loads, schema parses, every shipped policy validates, every story's expected `(decision, policy id)` still holds. Run it in `doctor` and CI. If it fails, the demo refuses to start in mock mode rather than showing a wrong decision.
6. Live mode only swaps the token source (PF verify) and, optionally, adds lane A.

Failure mode to design for: a Cedar upgrade changing validation text or wasm API. Exact pin plus the story-assertion test above catches it.

---

## 10. Optional extra: Cedar vs PingOne Authorize side by side (B3)

Same request object (principal, action, resource, context) sent to both engines, results shown in two columns with deciding rule each. The repo already has PingOne Authorize plumbing: decision-endpoint config (`demo_api_server/services/configStore.js:781`, `demoReadinessAuditService.js:212`), the group-policy board and the `p1az` predictor, and `demo_api_ui/src/components/education/AuthZenPanel.js` (an AuthZEN explainer that mentions Cedar). For S23, the interesting contrast is conflict resolution: Cedar is fixed (forbid beats permit, default deny); how Authorize resolves conflicting rules depends on its policy structure and combining algorithm, **which I did not verify**. Keep this out of the first release. Prerequisites: a live PingOne Authorize tenant (not available offline) and a mapping from the Cedar context to an Authorize request, so it can only be a live-mode extra with a recorded fixture for mock mode.
Caution: the 2026-08 spec `docs/superpowers/specs/2026-08-02-intent-routing-and-p1az-authz-design.md:105-106` explicitly rejected adding Cedar/OPA to the AI-DEMO2 stack because PingOne Authorize is the product being demonstrated. The family plan decision (Cedar inside Privilege) overrides it for this demo; the positioning should say "Cedar is Privilege's policy language", not "Cedar replaces Authorize".

---

## 11. Risks and unknowns (honest list)

1. **Ambiguity of "AI Policies tab" (largest).** Lane A vs B (section 0). If the user means the real console, most of this document's engine work is unnecessary and the work becomes "script `aipolicys` PUTs and read logs", with a vocabulary that cannot see PF claims.
2. **Real console Cedar vocabulary is fixed and unreadable to PF claims** (measured, `PF-CLAIMS-IN-CEDAR-POLICIES.md`). Anything beyond group/scope/app/tool/args in our schema is a demo-only extension and will not paste into the real console. Mitigation: mark extensions in the schema; test pasteability only if lane A is built.
3. **Whether the gateway can call external Cedar: UNVERIFIED, probably not** (section 8 lane C).
4. **Divergence between our Cedar and Ping's.** Their engine version, schema, entity registry and hold semantics are not published. Our PEP behaves like Cedar 4.14, not like their gateway. The honest label is "Cedar, the language Privilege uses", not "this is the gateway".
5. **`groups` and `act` availability in the PF access token is UNVERIFIED.** Our resource-AS token has neither; the ID token has `groups`. S04/S23 group policies need `groups` in whatever token we evaluate (add the claim to the PF access-token mapping or evaluate the ID token's verified claims). `act` as an object needs PF OGNL, a tenant-wide setting.
6. **Default-deny and forbid-wins are not self-explaining in Cedar's output** (empty `reason`; overridden permits not listed). The demo needs the synthesized `default-deny` rule and the counterfactual run, both small but easy to forget.
7. **Browser wasm packaging is UNVERIFIED** (Vite ESM loading, 4.2 MB asset). Server-only lint avoids it.
8. **Hold semantics are inferred.** Real gateway ordering of `Invoke` / `InvokeUnattended` and the approval-count lifecycle (`@ttl`, `@request_ttl`, `@grant`) are unverified; my S01 policy copies the shape of the live `hitl-opensearch` policy, which the PF doc itself calls "adapted, not yet run".
9. **Dependency freshness.** cedar-wasm shipped 4.14.0 one day ago and moves quickly; `cedar-java` is at 4.10.0 and `mcp-schema-generator-wasm` at 0.6.1 (pre-1.0).
10. **Branch state:** the PF-claims doc, diagram and handoff update are on `origin/docs/pf-cedar-claims` (PR #1623 per memory, unmerged). Anything citing them depends on that merging or on copying them.
11. **Shared-tenant writes** for lane A are blocked without explicit approval and touch a live environment; the earlier probe already left a throwaway DCR client (`pf-claims-probe`) behind.
12. **Licensing:** Cedar packages are Apache-2.0 (compatible with a private repo; keep the NOTICE if redistributing). I did not read each transitive dependency's license.

## 12. Proposed minimal build (for the Privilege standalone, when approved)

1. `server/cedar/` : load pinned wasm, `loadPolicies()`, `validate()`, `decide(claims, call)` returning `{result, rules, reasons, counterfactual}`, `mapClaims()` (section 4). About 150 lines.
2. `data/policies/*.cedar` + `schema.cedarschema` + Active/Candidate state file; the six policies above as the shipped set.
3. PEP route in front of the MCP backend (mock first), emitting the F2 envelope.
4. AI Policies tab: list (state, story, reason), editor with server-side validate, "Test a request" panel (persona fixture + tool + args), result card with deciding policy, reason, counterfactual toggle. ReactFlow diagram of claims -> entities -> Cedar -> decision, per base requirement 5.
5. Tests: the table in section 6 as a vitest suite; `doctor` check; Reset.
6. Later: lane A publisher, lane B3 Authorize column.

Rough size: 1-2 agent-sessions for engine + PEP + tests, 1-2 more for the tab and diagram. Biggest assumption: the user chooses lane B as the core.
