# Standalone Demo Family: Plan and Catalog

Date: 2026-10-20 · Status: plan agreed, nothing built yet · Owner: cmuir

## Goal

Use AI-DEMO2 (31 GB, ~40 services) as the code and skills source for many **small, completely standalone
demos**. Each demo:

- lives in its **own GitHub repo** (`cmuir_pingcorp/<name>-demo`, private; the `cmuir_pingcorp` gh account only)
- has its **own authentication**, picked at setup time: PingOne (P1), PingFederate (PF) or AIC
- has its **own user registration**
- runs with a handful of containers on OrbStack (never Docker Desktop), not the full stack
- is **cheaper and faster**: scoped CI, small images, reused code, reused skills

## Decisions already made

| Decision | Answer |
|---|---|
| First use case | **`~/Development/id-jag-standalone`**, finished first, then used as the template |
| Primary user | **SEs presenting live** |
| Setup path | **One command, run locally** (clone, run `setup`, pick P1/PF/AIC, Docker starts) |
| Pain to remove | Explaining what's happening; customizing for a customer; demos breaking mid-session |
| Scope | **All** demos in the catalog below |
| Phase 0 additions | Presenter mode, talk-track panel, `customer.config`, `doctor`, one-click Reset |
| Distribution of shared code | GitHub **template repo + hash-manifest sync** (as `scripts/sync-to-app.mjs` does today). No npm registry, no `git subtree` |

## Decisions settled 2026-10-20

1. **ID-JAG demo is PF-token-only.** PingFederate issues tokens; P1 or AIC are only the sign-in IdP behind it (ID-JAG and DPoP are PF-only in the Ping stack). The full P1/PF/AIC picker applies to the other demos.
2. **Repo names:** `cmuir_pingcorp/<name>-demo`, private. Testers grouped into suite repos by area, except the MFA tester (own repo).
3. **Source of truth:** once a standalone exists, edit it directly. Shared pieces flow through the base sync. AI-DEMO2 is not where standalones are regenerated from, except the initial extract.
4. **Cedar:** the **Privilege demo uses Cedar for authorization, in its AI Policies tab, using the token from PingFederate.** So Cedar is a policy engine inside the Privilege demo (B3/B5 below), with PF as the token issuer, not a separate positioning exercise. The Authorize side-by-side stays as a possible extra.

## Still open

1. AIC and pi.flow: AIC waits for pi.flow, or a documented redirect exception for AIC only. Default: wait (rule: no redirect logins).
2. Cedar: whether a live Amazon Verified Permissions variant is wanted (default: local open-source engine only).

## Phase 0: Finish ID-JAG standalone and make it the template

Work in a worktree of `id-jag-standalone`. Local `main` is 2 PRs behind origin (#28 inspector-reveal and its follow-up).

| # | Work | Done when |
|---|---|---|
| 0.1 | Pull pending PRs; clean-clone baseline | Fresh clone builds, tests pass, mock mode runs with no network |
| 0.2 | **Phase 3B:** sign-in and self-registration, IdP chosen at setup; admin rights for the Trusted IdPs registry | A new user registers, signs in; an admin approves a trusted IdP |
| 0.3 | Rest of Phase 3: real `pf-pf` setup; adapt `pingfederate/sync-id-jag-trusted-idps.js` | `pf-pf` runs end to end on a fresh PF |
| 0.4 | **Presenter mode** | Fullscreen, larger type, step counter, admin UI hidden; playground runs start to finish |
| 0.5 | **Talk-track panel** | Per step: what's happening, what to say, why it matters; data-driven; every step in every mode has one |
| 0.6 | **`customer.config`** | Brand, vertical, IdP, persona; validated; one file re-skins the demo in under 2 minutes |
| 0.7 | **`doctor` command** | Checks tenant, ports, certs, env, backend reachability; names the fix; green on a good setup |
| 0.8 | **One-click Reset** | Clears users, sessions, held states, trusted-IdP registry; result identical to fresh setup |
| 0.9 | **Phase 4:** one `setup` command, CI, secrets handling, README without "Phase" language | One command from clone to running |
| 0.10 | Forbidden-string gate | grep for AI-DEMO2 environment IDs, client IDs and secrets returns nothing |

Verification: clean clone, full run in each mode, deliberate-failure tests for `doctor` and Reset.

## Phase 1: Extract `demo-kit-base`

A GitHub template repo plus `sync-to-base.mjs [--check]` (hash manifest, CI-enforced). Contents:

- setup wizard and P1/PF/AIC picker
- auth, registration, admin group
- presenter mode, talk-track panel, `customer.config`, `doctor`, Reset
- app shell, Ping brand (Montserrat, official 2026 logo, Ping Red), ReactFlow diagram components (movable boxes, Simulate, Reset, speed control), Learn plumbing, token decode and redaction
- Docker, CI, hygiene gates (forbidden-string, no-secrets)
- **Mock mode** and **preflight checks** as base requirements for every demo

ID-JAG is rebased onto the template as proof.

## Base requirements for every demo

Every demo repo must ship all of these:

1. Mock mode (the safe fallback when a tenant or network fails live)
2. Preflight check before each live step (names the fix; sends nothing while failing)
3. `doctor`, Reset, presenter mode, talk track, `customer.config`
4. Decoded tokens and redacted requests (raw tokens never reach the browser)
5. A ReactFlow diagram per flow (never mermaid) with movable boxes, Simulate, Reset, speed control
6. A Learn pack (glossary, sources) in the Learning Hub content-pack format
7. Own short `CLAUDE.md` and only the skills it needs
8. Its own CI scoped to its own tests
9. The diagram, demo and Learning Hub entry stay a synced trio
10. Emits the shared **trace envelope** (F2) for every hop and renders the built-in trace timeline (F3); optional `--profile otel` for the OTel and Grafana view (F4)

## Catalog: standalone apps we can build

Legend. **Seed** = existing code in AI-DEMO2 or a sibling folder. ✅ = substantial code exists, 🟡 = partial, ❌ = nothing yet.
**Kind**: **Demo** = a story for customers. **Tester** = a small utility an SE uses to prove or debug one thing.

### A. Identity and authentication: Ping products

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| A1 | **MFA tester** | Tester | Enroll and test every PingOne MFA method (SMS, email, TOTP, FIDO2/passkey, push), policy by policy, with the policy decision visible | ✅ MFA pi.flow work, mock phone |
| A2 | **Passkey / FIDO2 tester** | Tester | Register and authenticate a passkey; shows the WebAuthn request and attestation | 🟡 `fido2-fix` |
| A3 | **Passwordless sign-in** | Demo | Passkey, OTP, magic link, CIBA approval as sign-in | ✅ passwordless CIBA work |
| A4 | **CIBA lab** | Tester | Decoupled approval on a phone; binding-message limits (8 chars on PingOne), error cases | ✅ CIBA on PingOne+DaVinci, consent mock phone |
| A5 | **Step-up auth** | Demo | Policy-driven step-up on a sensitive action | ✅ |
| A6 | **PingOne Protect / Risk** | Demo | Risk score changes the experience: allow, step-up, block; signal simulator | 🟡 Protect policies |
| A7 | **Risk signal simulator** | Tester | Fire fake risky signals (new device, impossible travel, bot) and see the evaluation | 🟡 |
| A8 | **PingOne Recognize** | Demo | Authentication by recognition | 🟡 service stubbed |
| A9 | **PingOne Verify / Credentials** | Demo | ID verification, issue and present a verifiable credential | ❌ |
| A10 | **DaVinci flow runner** | Demo/Tester | Run a DaVinci flow through pi.flow with the flow state visible | ✅ DaVinci kit, `pingone-sample-apps` skill |
| A11 | **pi.flow native sign-in kit** | Demo | Embedded sign-in with no redirect; the architecture explained | ✅ |
| A12 | **User registration and self-service** | Demo | Registration, verification, profile, password reset | ✅ `user-registration` samples |
| A13 | **Population / group / attribute explorer** | Tester | Users, groups, populations and the claims they produce | ✅ vertical groups |
| A14 | **AIC journeys** | Demo | Advanced Identity Cloud journeys, with PingOne behind it | ✅ AIC external IdP work |
| A15 | **PingFederate token factory** | Demo | Access-token managers, mappings, exchange policies, token translation | ✅ much already in the ID-JAG kit |
| A16 | **PingFederate SAML SP/IdP lab** | Demo/Tester | SAML SSO, SLO, assertion inspection | 🟡 SAML playground |
| A17 | **PingDirectory / consent and attribute access** | Demo | Attribute-level access and consent | ❌ |
| A18 | **PingAccess rules lab** | Demo | Policy-based web and API access | ❌ |
| A19 | **PingGateway route lab** | Demo/Tester | Route conditions, WWW-Authenticate shape, introspection | ✅ `ping-gateway` |
| A20 | **Social / external IdP login** | Demo | Bring an external IdP into PingOne or PF | ✅ AIC and external-IdP work |
| A21 | **Branding / theming** | Demo | Per-customer login and app branding | ✅ THEMING.md, PF login theme |
| A22 | **Session, SSO and logout tester** | Tester | Front-channel and back-channel logout, id_token_hint, session lifetime | ✅ auth recovery logout fix |
| A23 | **Email / SMS delivery tester** | Tester | Whether OTP and notification messages actually arrive | ❌ |

### B. Authorization and policy

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| B1 | **PingOne Authorize (P1AZ)** | Demo | Fine-grained decisions with an explainer ("why was I denied") | ✅ group-policy board, p1az predictor |
| B2 | **Authorize policy playground** | Tester | Edit a policy, pick a request, see the decision and the deciding rule | 🟡 |
| B3 | **Cedar demo** | Demo | Cedar vs PingOne Authorize on the same request, side by side | ❌ |
| B4 | **Cedar policy playground** | Tester | Edit Cedar policy locally (open-source engine), see permit/forbid | ❌ |
| B5 | **Cedar for agent tool calls** | Demo | Permit and forbid rules on MCP tool calls; forbid overrides permit; default deny | ❌ |
| B6 | **Amazon Verified Permissions variant** | Demo | Same, against live AVP (only if confirmed) | ❌ |
| B7 | **Group / vertical policy board** | Demo | One decision per vertical, group-driven | ✅ |
| B8 | **Policy-as-code drift checker** | Tester | PAC policy drift against the tenant | ✅ `check-pac-policy-drift` |
| B9 | **Consent and delegation** | Demo | Act-only consent, `may_act` | ✅ act-only consent |

### C. Tokens and protocols (teaching tools)

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| C1 | **ID-JAG** | Demo | Identity Assertion JWT Authorization Grant: issue, check, redeem, call | ✅ `id-jag-standalone` (Phase 0) |
| C2 | **Token-flow workbench** | Demo | PAR, RAR, DPoP, mTLS, JAR, PKCE side by side with pass/fail | 🟡 `par` skill |
| C3 | **Token decoder / inspector** | Tester | Decode and validate any token type (ID, access, ID-JAG, SAML) | ✅ ID-JAG Inspector |
| C4 | **OIDC discovery checker** | Tester | Fetch and sanity-check `.well-known` metadata and JWKS | 🟡 |
| C5 | **JWKS / key-rotation tester** | Tester | Kid handling, rotation, missing-kid failure modes | ✅ PF missing-kid findings |
| C6 | **Token exchange / OBO** | Demo | RFC 8693 delegation with `act` and `may_act` | ✅ OBO demo and runbook |
| C7 | **PAR tester** | Tester | Pushed Authorization Request flow against a tenant | ✅ `par` skill |
| C8 | **RAR tester** | Tester | Rich Authorization Requests (`authorization_details`) | 🟡 |
| C9 | **DPoP tester** | Tester | Sender-constrained tokens (PF only in the Ping stack) | 🟡 |
| C10 | **mTLS tester** | Tester | Certificate-bound tokens | ❌ |
| C11 | **Device authorization grant tester** | Tester | RFC 8628 flow | ❌ |
| C12 | **Introspection and revocation tester** | Tester | RFC 7662, RFC 7009; revoke and prove it | ✅ step 6 of ID-JAG |
| C13 | **Client-authentication matrix** | Tester | secret, `private_key_jwt`, mTLS per client | 🟡 |
| C14 | **SCIM tester** | Tester | Provisioning calls and responses | ❌ |
| C15 | **CORS / redirect-URI tester** | Tester | Why a redirect or origin is rejected | ❌ |
| C16 | **Webhook / event viewer** | Tester | Receive and show PingOne notifications and audit events | ❌ |
| C17 | **PingOne API explorer** | Tester | Management API with the MCP-first rule | 🟡 `pingone-mcp` skill |
| C18 | **SPIFFE / workload identity** | Demo | Agent or service identity with no secrets | ✅ `spiffe` |
| C19 | **JWT claim mapping lab** | Tester | SpEL and attribute-mapping recipes (e.g. the act-object recipe) | ✅ OBO recipe |

### D. Agents, MCP and AI security

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| D1 | **PingOne Privilege (AI gateway)** | Demo | MCP allow/deny, agent keys, rug-pull defense | ✅ `Privilege-standalone`, `privilege/` |
| D2 | **MCP auth lab** | Demo/Tester | RFC 9728 metadata, DCR/CIMD, what ChatGPT and Claude require | ✅ ChatGPT login work, mcpgw wildcard metadata |
| D3 | **MCP inspector** | Tester | Connect to an MCP server and inspect tools and auth | ✅ `standalone/mcp-inspector` |
| D4 | **MCP scanner** | Tester | Scan an MCP server for risky tools | ✅ `standalone/mcp-scanner` |
| D5 | **MCP toolkit / discovery agent** | Tester | Discover and enumerate servers | ✅ `standalone/mcp-toolkit`, `mcp-discovery-agent` |
| D6 | **Hostile MCP / rug-pull** | Demo | Ungoverned vs governed side by side | ✅ `standalone/hostile-mcp-server` |
| D7 | **Hostile A2A agent** | Demo | Malicious agent card and tasks | ✅ `standalone/hostile-a2a-agent` |
| D8 | **Prompt-injection side by side** | Demo | Same attack against ungoverned and governed agent | 🟡 |
| D9 | **A2A** | Demo | Agent-to-agent with delegated auth | ✅ A2A page and workbench |
| D10 | **A2A agent-card validator** | Tester | Validate cards, scopes, auth schemes | 🟡 |
| D11 | **Agent Registry / onboarding** | Demo | Register, scope, rotate, retire an agent | ✅ privilege agent-key facts |
| D12 | **AI Guard** | Demo | Guardrails and prompt-guard decisions | ✅ `demo_mcp_promptguard` |
| D13 | **Caught errors** | Demo | Every denial and block, explained | 🟡 |
| D14 | **Kill switch / runaway agent** | Demo | Rate and cost caps, revoke and watch it stop | ✅ killswitch plan |
| D15 | **HITL approvals** | Demo | Hold, approve, retry | ✅ OpenSearch HITL demo, `demo_hitl_service` |
| D16 | **Shadow-agent discovery** | Demo | Find ungoverned agents | 🟡 |
| D17 | **Audit trail** | Demo | Who did what through which agent | ✅ `demo_mcp_audit` |
| D18 | **Cost and token usage** | Demo | Per-agent LLM spend and timings | ✅ PostHog work |
| D19 | **LLM gateway** | Demo | Provider routing, custom and OpenRouter lanes, secured | ✅ `Privilege-standalone/llm-gateway`, `demo_llm_proxy` |
| D20 | **AI gateway client** | Tester | Client for the AI gateway | ✅ `standalone/ai-gateway-client` |
| D21 | **Personal agent (Dot)** | Demo | A user's own agent with consent | ✅ Dot |
| D22 | **Worker agent** | Demo | Autonomous agent under policy | 🟡 `PLAN-autonomous-vs-worker-agents.md` |
| D23 | **Digital worker** | Demo | Unattended agent; UC38 live run | ✅ digital worker demo |
| D24 | **Standard AI use cases** | Demo | A curated subset of the 84 use cases | ✅ needs a manifest |
| D25 | **ChatGPT / Claude connector login** | Demo | OAuth for remote MCP from real clients | ✅ |
| D26 | **Banking/MCP REST adapter** | Demo | Existing REST API exposed to agents | ✅ `demo_mcp_banking_rest` |

### E. Learning and enablement

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| E1 | **Learning Hub standalone** | Demo | Glossary, sources, Learn index, RAG Q&A; content-pack format that every demo contributes to | ✅ Learning Hub, Tika-RAG plan |
| E2 | **SE demo shelf (launcher)** | Tool | One page: every demo, status light (ready / needs setup / broken), start button | ❌ |
| E3 | **Diagram gallery** | Demo | All ReactFlow diagrams in one place | ✅ `/diagrams` index |
| E4 | **Talk-track library** | Tool | Searchable talk tracks across demos | ❌ (comes from the Phase 0 panel) |
| E5 | **Industry skins** | Theme packs | Banking, healthcare, retail, airline, as packs on the base | ✅ vertical picker, United docs |
| E6 | **Customer-specific packs** | Theme packs | e.g. the United engagement, applied via `customer.config` | ✅ United docs |
| E7 | **Demo health dashboard** | Tool | Readiness across the whole family | ✅ demo readiness catalog |

### F. Telemetry, transaction tracing and workload identity

Decided 2026-10-20: a transaction trace must prove **all four**: one correlation ID end to end, the identity chain at each hop,
the policy decision at each hop, and latency plus LLM cost per hop. Viewable **both** ways: a built-in trace timeline in every demo
(works offline in mock mode), and an optional compose profile adding an OpenTelemetry stack plus Grafana.

| ID | Name | Kind | What it shows | Seed |
|---|---|---|---|---|
| F1 | **AI transaction trace (cross-product)** | Demo | One transaction followed from sign-in, through agent, gateway, policy, MCP tool and audit record, with identity, decision, latency and cost at every hop | ✅ observability demo (`/architecture/observability`, Grafana dashboard `ai-demo-agent-observability`), token-chain trace rail, policy-decision trace history, `E2E_CARECONNECT_TRACE.md` |
| F2 | **Trace envelope and emitter library** | Base | The shared event shape every demo emits (see below) so traces from separate repos join | 🟡 New Relic correlation-spans design, `llm-directive-and-trace.md` |
| F3 | **Trace timeline panel** | Base | The built-in Jaeger-style timeline component, in the base, mock-capable | ✅ Jaeger trace UI port design, telemetry page design |
| F4 | **OTel + Grafana profile** | Base | `--profile otel` adds collector, trace store and Grafana with the dashboards | ✅ `monitoring/` (Prometheus, Alloy, Grafana, alerts) |
| F5 | **Correlation-ID propagation tester** | Tester | Send a request through N hops and show where the ID is dropped or rewritten | ❌ |
| F6 | **Cost and latency per hop** | Demo | LLM tokens and dollars, plus time, per hop | ✅ PostHog gap closure |
| F7 | **Audit-to-trace join** | Demo | Click an audit line, land on its trace, and back | 🟡 `demo_mcp_audit` |
| F8 | **SPIFFE workload identity for agents** | Demo | Agents and MCP servers get SVIDs instead of static secrets; the SPIFFE ID is shown as the layer under the user token | ✅ `spiffe/`, `docs/SPIFFE_PLAN.md` |
| F9 | **SVID-to-Ping token exchange** | Demo | An SVID is exchanged for a PingFederate/PingOne token, then the usual user-and-agent chain applies | 🟡 `spiffe/pingfederate` |
| F10 | **SPIFFE lab** | Tester | Issue, rotate and verify SVIDs; shows what a failed verification looks like | 🟡 `spiffe/docker-compose` |

**Trace envelope (F2), proposed:** every hop emits `{ trace_id, span_id, parent_span_id, product, hop, subject (sub), actor (act),
spiffe_id (if any), decision {result, rule}, latency_ms, llm {tokens_in, tokens_out, cost}, ts }`. No raw tokens ever. W3C `traceparent`
is the propagation header, so it also works with real OTel. Each demo repo emits this envelope; the shelf (E2) or the trace page
(F1) joins them by `trace_id` across repos.

## Suggested order (waves)

| Wave | Demos |
|---|---|
| 0 | **C1 ID-JAG** (Phase 0), then Phase 1 base extraction |
| 1 | **E1 Learning Hub**, **E2 demo shelf**, **C2 token-flow workbench**, **C3 token inspector**, **A1 MFA tester**, **F2/F3 trace envelope and timeline** (base) |
| 2 | **D1 Privilege**, **D2 MCP auth lab**, **D3 to D5 MCP tools**, **C6 OBO**, **D9 A2A**, **D8 prompt-injection**, **D6 and D7 hostile servers** |
| 3 | **B1 Authorize**, **B3 to B5 Cedar**, **A6 Protect**, **A3/A4 passwordless and CIBA**, **A10 DaVinci**, **A15 PF token factory**, **A19 PingGateway** |
| 4 | **D12 AI Guard**, **D13 caught errors**, **D14 kill switch**, **D15 HITL**, **D11 Agent Registry**, **D16 shadow agents**, **D17 audit** |
| 5 | **D21 personal agent**, **D22 worker agent**, **D23 digital worker**, **D24 standard use cases**, **F8/F9/F10 SPIFFE (replaces C18)**, **F1/F4/F5/F6/F7 transaction trace and OTel profile** (needs several demos emitting first), **A14 AIC**, **A8 Recognize** |
| 6 | **A9 Verify/Credentials**, **A17 PingDirectory**, **A18 PingAccess**, **E5/E6 skins**, remaining testers (C-series, A22, A23) |

Testers are small. They can be batched into a single "tester suite" repo per area (identity testers, token testers, MCP testers)
where one repo per tester is more overhead than value. Decision pending: **one repo per tester, or a suite repo per category**.
Default: demos get their own repo; testers are grouped into suites, except MFA tester (A1), which is its own repo.

## Open questions

1. Cedar: positioning, and whether AVP is in scope (see Defaults 5).
2. Tester packaging: one repo each, or suites (default above).
3. The four defaults above (ID-JAG PF-only, AIC and pi.flow, repo naming, source of truth).
4. Verify/Credentials and PingDirectory have no existing code; confirm they stay in scope given the cost.
5. Is the demo shelf (E2) SE-only, or shared externally?

## Facts this plan rests on

- `id-jag-standalone` is on Phase 3A. README says 3B (sign-in, admin rights), the rest of Phase 3, and Phase 4 remain. It already has Mock, `pf-as`, `pf-pf`, `byo` modes, preflight, resource AS, MCP sample, Inspector, SAML path, interop docs, and a sync script.
- Existing extraction tooling: `scripts/export-edition.js` (manifest-driven, placeholder IDs, forbidden-string gate) and the kit's `sync-to-app.mjs` (vendored files, hash manifest). Both are reusable.
- Existing standalones: `AI-DEMO2/standalone/` (9) and `~/Development/Privilege-standalone` (3).
- Related notes: edition-split design (`docs/superpowers/specs/2026-10-03-edition-split-design.md`); `planning/cloudflare-hybrid-migration.md`.
- Working rules: worktrees for AI-DEMO2 (the main checkout is shared and gets clobbered); `cmuir_pingcorp` gh account; OrbStack, not Docker Desktop; no redirect logins (pi.flow only); all diagrams ReactFlow.

## Next step

Phase 0.1: pull the 2 pending PRs in `id-jag-standalone` and do the clean-clone baseline, in a worktree.
