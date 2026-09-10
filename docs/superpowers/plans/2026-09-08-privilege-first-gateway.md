# Privilege-First Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every LLM call and every MCP tool call from this demo's agents enters through the PingOne Privilege AI Gateway first; Privilege owns credentials, coarse policy, approvals and recording, and hands MCP traffic on to the Agent Gateway, which keeps doing everything it does today (introspection, RFC 8693 exchange, P1AZ per-tool decisions, D-05, HITL, RAR).

**Architecture:** No new services. The Privilege AI Gateway at `https://mcpgw.ai-demo.ping-devops.com` already fronts LLM providers (`/llm/<provider>/…` virtual keys) and MCP backends (`/<AgenticApp>/mcp`). Phase 1 makes the LLM virtual-key lanes the *default* path instead of an opt-in picker item. Phase 2 registers the Agent Gateway itself as a Privilege Agentic App and repoints the BFF's single MCP chokepoint at it, behind a flag. Phase 0 is a measurement spike that decides how identity crosses the Privilege → Agent Gateway hop, because the answer is not in any doc in this repo.

**Tech Stack:** Node >= 22 CommonJS BFF (`demo_api_server`), Jest 29.7, PingOne Privilege console (user-side), PingGateway (`ping-gateway/`) and the Node gateway (`demo_mcp_gateway/`, TypeScript), Docker Compose + SE K8s (`ping-devops-cmuir`, gateway in `ping-devops-curtismuir`).

**Spec:** This plan is its own spec — the user's ask was "Privilege as the first gateway, controls LLM/MCP, then Agent Gateway for the rest. Just a plan." Section 1 below records the current state it argues from (verified 2026-09-08, sources cited).

**Corrected 2026-09-09** (nothing had been executed yet; each change is marked inline):
- **D1 / Task 0 / Task 5 / Task 8** — the backend hop cannot use Auth Mode OAuth (it gates the *client* too and kills discovery, measured on `banking-mcp`), and the Agent Gateway accepts JWTs only (`tokenValidator.ts:221-226`; no opaque-token path, broker has no `client_credentials`). The bridge is therefore a **Static Token** shared secret, and Task 8 is required in every outcome.
- **Task 0 COMPLETE 2026-09-10 — D1 resolved to outcome (a).** Privilege forwards custom request headers to the backend unchanged (measured with a live call through a throwaway Agentic App into a header-logging backend), and forwards **no** `Authorization` under Auth Mode None. So `X-Subject-Token` reaches the Agent Gateway and the delegated user identity survives the hop; the bearer slot must be filled by Auth Mode **Static Token**. Full method and the header table: `privilege/CURRENT-CONFIGURATION.md`, "Backend hop: what the Node gateway accepts". **Phase 2 has no unknowns left — execute Tasks 5–9 as written.**
- **Task 2 / Task 3** — the resolver alias alone breaks the tool-calling reason loop (`reasoningGraph.ts:531` logs `unknown provider` and the BFF drops to heuristics) and leaves open-question answers off the lane (`geminiNlIntent.js:339-354, 869-876`). Both now have explicit steps.

## Global Constraints

- **Feature flags default OFF** in code, tests and mocks (`ai-demo2-ff-default-off`). Both new flags ship `default: 'false'`.
- **Do not change the Privilege transport** (user, 2026-09-04). Agent-based deployment, OAuth retained, client URL `https://mcpgw.ai-demo.ping-devops.com/<app>/mcp`. Register backends on `/mcp`, never `/sse` (`privilege/CURRENT-CONFIGURATION.md`, corrected 2026-09-08).
- **Do not change any frozen LLM setting** (resident tiers, `LLAMACPP_MAX_TOKENS`, `REASON_LOOP_TIMEOUT_MS`, `reasoning_effort`). Local models on `:8090` are out of Privilege's reach and stay local (see Decision D2).
- **`tokenValidator.ts` / `authorizeMcpRequestCore.ts` / `GatewayTokenPolicy.ts` invariants stay**: `sub` required, `act.sub` non-empty when present, `aud` checked on every hop (ARCHITECTURE-TRUTHS T-5). Phase 2 may *add* an accepted input; it must not relax a check.
- **Virtual keys and bridge client secrets are credentials**: secrets path only (`k8s/03-secrets.yaml.template`, `scripts/create-secrets.sh`), never a configmap, never printed.
- `demo_api_server` is CommonJS. BFF errors use `{ error }`. BFF tests: `CI=true npx jest <paths> --forceExit` from `demo_api_server/`.
- **Worktree required.** Stage with `git add <files>`, never `git add -A`. Check `git status` in the main checkout after every subagent dispatch (`ai-demo2-subagent-worktree-drift`).
- Any new public-facing URL key goes in `service-topology.json` with `"public"` marking, or it is right locally and wrong on SE.

---

## 1. Current state (verified, not assumed)

### 1.1 The two paths today

```
LLM today
  BFF chat  → llmProviderResolver.js:65 (default helix) → vendor direct (google/anthropic/openai/groq)
            → privilege_llm / privilege_claude ONLY when picked in the agent-mode picker
                → privilegeLlmProxyService.js → PRIVILEGE_LLM_GATEWAY_URL/llm/{google|anthropic|openai}/v1/…
  sidecars  (openai/pydantic/mastra/llamaindex/langchain/librechat) → :8090 demo_llm_proxy (local tiers, NO auth, NO Privilege)
  agent-service :3006 → reasoningGraph.ts hardcoded vendor base URLs

MCP today
  BFF → mcpToolPipeline.js → mcpGatewayTransport.resolveMcpGatewayTransport()
      → mcpGatewayClient.getMcpGatewayHttpUrl()  (mcpGatewayClient.js:1116 — THE chokepoint)
          ff_mcp_gateway_pinggateway=true (default) → ping-gateway:8080 /mcp   (PingGateway, "Real PingOne Agent Gateway")
          false / forced tools                      → mcp-gateway:3005 /mcp    (Node demo gateway)
      → mcp-server:8080 / mcp-resource-server:8081 / mcp-weather / mcp-brave
  Privilege sits BESIDE this: façade doors `agentless` (banking-mcp) and `privilege-gateway` go
  Privilege → mcp-resource-server directly, bypassing both Agent Gateways (mcpFacade.js:49-221).
```

### 1.2 Facts the design depends on

| Fact | Source |
|---|---|
| Privilege LLM lanes exist for anthropic, google, openai; policy denial normalised to `err.code='llm_policy_denied'` | `demo_api_server/services/privilegeLlmProxyService.js:27-31` |
| BFF only dispatches `privilege_llm` (Gemini) and `privilege_claude`; there is no `privilege_openai` provider in `geminiNlIntent.js` | `geminiNlIntent.js:132-133, 688, 714` |
| Sidecar agents read ONE env for the LLM base URL: `AGENT_LLM_BASE_URL` (+ `AGENT_LLM_API_KEY`) | `docker-compose.yml:1466,1506,1545`; `openai_agent/src/config.py:26-29` |
| Privilege's `/llm/openai/v1/chat/completions` is OpenAI-wire-compatible | `privilegeLlmProxyService.js:11-13` |
| MCP URL ladder: flag → `MCP_PINGGATEWAY_URL` → `MCP_DEMO_GATEWAY_URL` → `MCP_GATEWAY_HTTP_URL` | `mcpGatewayClient.js:1116-1146` |
| Flag registry + env alias map | `routes/featureFlags.js:759, 1004`; `configStore.js:380, 986` |
| Privilege inbound auth is gateway-managed OAuth against the **Privilege tenant `0428ba4f…`** (RFC 7591 + PKCE, human sign-in); the BFF holds that session in memory | `privilegeGatewaySession.js`; `privilege/CURRENT-CONFIGURATION.md` |
| Privilege **rejects** tokens issued by the demo env `01d89b06…` (`JWT signature validation failed`) | `privilege/PRIVILEGE-MCP.md:470-500` |
| Privilege → backend hop has Auth Modes None / Static Token / OAuth; OAuth mode once carried "a real PingOne token" to `mcp-server` | `privilege/PRIVILEGE-MCP.md:524-529` |
| Agent Gateway (Node) requires a validated bearer with `sub` for `tools/list` and `tools/call`; bridges actor identity from BFF headers `X-Act-Client-Id` / `X-May-Act-Sub` under an allowlist | `demo_mcp_gateway/src/index.ts:270-282, 539-549, 1212-1223`; `GatewayTokenPolicy.ts:44-66` |
| Banking tools need user scope `banking:read` that only the BFF's RFC 8693 exchange produces; a machine token is denied | `privilege/CURRENT-CONFIGURATION.md` "The banking door"; `docs/TOKEN_FLOW.md` |
| Privilege AI Gateway is **SE only**; the compose `mcpgw`/`ping-mcpgw` services are inert / profile-gated | `docker-compose.yml:815, 1771`; spec `2026-09-04-mcp-lanes…` §4.1 |
| The Privilege gateway does not relay MCP elicitation | `privilege/CURRENT-CONFIGURATION.md` (measured 2026-09-07) |
| A 403 from Privilege is a policy answer (missing or **expired** policy), never a code bug | `privilege/CURRENT-CONFIGURATION.md` "Rules that still bite" |

## 2. Target topology

```
Agents (BFF chat · sidecar agents · LM Studio / LibreChat)
   │
   ▼
[1] PingOne Privilege AI Gateway   https://mcpgw.ai-demo.ping-devops.com          ← FIRST GATE
    ├─ /llm/{openai|anthropic|google}/v1/…   virtual key: provider key never leaves Privilege,
    │                                        policy deny surfaces as llm_policy_denied
    └─ /agent-gateway/mcp                    Agentic App "agent-gateway": who, which tools,
                │                            time-box, approval, session recording
                │  backend hop — Auth Mode decided by Phase 0
                ▼
[2] Agent Gateway  (ping-gateway:8080 /mcp by default; mcp-gateway:3005 when flag off)   ← "THE REST"
    introspection · RFC 8693 exchange · P1AZ per-tool PERMIT/DENY/HITL · D-05 · aud · RAR · rate limit
                ▼
    mcp-server:8080 · mcp-resource-server:8081 · mcp-weather · mcp-brave
```

Privilege is the **coarse, human-governed** gate (Privilege-tenant identity, app/tool allow-list, time-boxed policy, approvals, recording). Agent Gateway stays the **fine-grained, delegated** gate (demo-env identity, `act` chain, per-tool P1AZ). Two identities per call is the point of the story, not a bug.

## 3. Decisions and open forks

**D1 — Identity across the Privilege → Agent Gateway hop (the fork that gates Phase 2).** *(corrected 2026-09-09)*
Privilege will not accept the demo-env user token inbound (§1.2), so the BFF's exchanged user token cannot simply *be* the bearer Privilege sees. Two constraints measured since the first draft bound the backend hop: **Auth Mode OAuth also gates the inbound client** (tokenless discovery 401s, console Tools panel empties — `privilege/CURRENT-CONFIGURATION.md`, "The call hop is a platform blocker", 2026-09-09), so the hop is Auth Mode **None** or **Static Token** only; and **the Agent Gateway accepts JWTs only** — measured live 2026-09-09 from inside the gateway pod: a non-JWT bearer answers `401 invalid_token` with `Token has no kid header and the JWKS exposes 4 keys`, raised in `_decodeAndVerify` (`demo_mcp_gateway/src/tokenValidator.ts:221-226`) **before any policy, audience or scope check**. (`Malformed JWT` at `:374` is only the fallback for a non-`TokenValidationError` throw and never fires for this input — an earlier draft of this line cited it wrongly.) Introspection runs after decode, and `OAuthBrokerRouter.ts:89-90` offers `authorization_code` only, so Privilege cannot mint a machine token from the broker either. Whatever Privilege puts in the bearer slot is therefore a static value the Agent Gateway must learn to recognise — Task 8 is required in **every** outcome.

**DECIDED 2026-09-10: outcome (a), measured.** A custom header (`x-pingone-admin-token`, which the BFF adds in `fetchMcp`) arrived at a header-logging backend through the gateway with its value unmodified, while no `Authorization` header arrived at all. Build Tasks 6–8 with `X-Subject-Token`; do not build the degraded (b) shape. The table below is kept for the reasoning, not as an open question:

| Outcome | What Privilege does on the backend hop | Phase 2 shape |
|---|---|---|
| **(a) Header pass-through** — Privilege forwards custom request headers unchanged | Bearer = Static Token bridge secret; `X-Subject-Token: <exchanged user token>` rides alongside. Agent Gateway matches the bearer against `MCP_GW_PRIVILEGE_BRIDGE_SECRET` (constant-time), validates the subject token exactly like a bearer, and records the bridge as an `act` hop | Tasks 6–8 (recommended if measured) |
| **(b) No header forwarding** | Same bridge secret, no user token. Agent Gateway maps the bridge to a machine subject with no user scope; banking tools DENY (`insufficient_scope`), weather/brave/opensearch pass | Ship Phase 2 with `X-Subject-Token` omitted (Task 7) and Task 8's machine-subject branch; make the banking DENY the demo beat ("Privilege let it through, Agent Gateway refused: no delegated user"). Raise header forwarding with Ping. |
| **(c) Privilege forwards the inbound bearer verbatim** | The inbound bearer is Privilege's own opaque DCR token — not a JWT, never accepted | Not reachable; recorded so nobody re-tests it |

Open detail the spike settles: whether the Static Token field must be a well-formed JWT. `privilege/PRIVILEGE-MCP.md:526-529` saw `JWT parsing failed … STaticToken` on the old `cyonproxy` binary. If the current build parses it too, mint the bridge secret as a long-lived self-signed JWT; the Agent Gateway still matches the whole string and never verifies its signature.

**D2 — Local models stay local.** Privilege has no lane for llama.cpp / MLX on `:8090`. Phase 1 covers cloud providers only. If Privilege supports a custom OpenAI-compatible provider, `:8090` could be registered as one — user question for Ping, not designed here.

**D3 — Local Docker vs SE.** LLM-first works from local Docker today (the gateway is a public URL; Plan C proved it). MCP-first is **SE only**: the Agentic App backend must reach `ping-gateway.ping-devops-cmuir.svc.cluster.local:8080` from the gateway pod's namespace. Both flags default OFF; local runs keep today's paths.

**D4 — Which Agent Gateway sits behind Privilege.** Whichever `ff_mcp_gateway_pinggateway` already selects. Task 8 implements the header acceptance in the Node gateway (where the actor-bridge precedent lives). The PingGateway route equivalent is listed as Task 8b and is blocked on the same spike outcome.

**D5 — Ungoverned agent** (`demo_ungoverned_agent`) deliberately bypasses everything and is untouched.

---

## Phase 0 — Spike: measure the backend hop (SE, no code)

### Task 0: Measure what Privilege sends to a backend

**Files:**
- Read only: `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md`, `privilege/CURRENT-CONFIGURATION.md`
- Record results in: `privilege/CURRENT-CONFIGURATION.md` (new section "Backend hop: what the gateway forwards")

**Interfaces:**
- Produces: a measured answer to D1 — (a), (b) or (c) — plus the exact claims of any token Privilege mints, and the list of request headers that survive the hop.

> **TASK 0 IS COMPLETE — skip this entire task.** The answer is D1 outcome (a); see the changelog at the top and `privilege/CURRENT-CONFIGURATION.md`. The steps below are kept only as the record of how it was measured.
>
> **Already done 2026-09-09, do not repeat** (recorded in `privilege/CURRENT-CONFIGURATION.md`, "Backend hop: what the Node gateway accepts"): the cross-namespace hop is open (gateway pod reaches `mcp-gateway…:3005/health`, 200), and all three bearer shapes the backend hop can carry were probed against the Node gateway — none is accepted, and the rejection happens inside `_decodeAndVerify` before any policy. What remains below is only the part the cluster cannot answer: whether Privilege **forwards** a custom header. That still needs the console app and an armed gateway session (checked the same day: `gatewaySession.ready:false`).

- [ ] **Step 1: Point a throwaway Agentic App at the Node gateway (it logs decoded claims).**
  Console → Agentic Apps → Add Application → **MCP Server**:

  | Field | Value |
  |---|---|
  | Application Name | `probe-agent-gateway` |
  | MCP Server URL | `http://mcp-gateway.ping-devops-cmuir.svc.cluster.local:3005/mcp` |
  | Mesh Cluster | `ai-demo-cmuir` |
  | Auth Mode | **None** (measurement 1) |

  Attach a policy to your Privilege-tenant user (a new app starts with none → bare 403).

- [ ] **Step 2: Measurement 1 — does the inbound bearer or any custom header reach the backend?**
  From `/privilege-mcp-client` (Privilege door, app `probe-agent-gateway`) run `tools/list`. Meanwhile:
  ```bash
  kubectl -n ping-devops-cmuir logs deploy/mcp-gateway -f | grep -E '\[GW\]|login_required|missing_sub|X-'
  ```
  Expected under (c): a validated `sub` from the demo env. Expected under (a)/(b): `-32001 … login_required` (no usable bearer). Then repeat with the client sending a custom header `X-Subject-Token: probe` (the façade's `forwardHeaders` path in `mcpFacade.js:735-760` can carry it) and grep the Node gateway's raw request log for `x-subject-token`. Header present → (a) is possible.

- [ ] **Step 3: Measurement 2 — does a Static Token arrive verbatim, and must it be a JWT?** *(corrected 2026-09-09 — Auth Mode OAuth is dead here, see D1)*
  Edit `probe-agent-gateway` → Auth Mode **Static Token**, value `probe-static-1`. Re-run `tools/list`; grep the Node gateway's raw request log for `authorization: Bearer probe-static-1`. Record whether the console or the gateway rejects a non-JWT value (then retry with any self-signed JWT). Confirms the bearer slot Task 8 will match on.

- [ ] **Step 4: Record the outcome** in `privilege/CURRENT-CONFIGURATION.md` under a new heading, including the literal log lines, then delete `probe-agent-gateway` from the console.

- [ ] **Step 5: Decide.** (a) measured → execute Phase 2 in full. Only (b) → execute Tasks 5, 6, 7 with `X-Subject-Token` omitted, skip Task 8, and add the banking-DENY beat to the demo steps. Stop and report before Phase 2 either way — this is a user decision point (`ai-demo2-checkin-before-fixes`).

---

## Phase 1 — LLM first (no unknowns; works local and SE)

### Task 1: Flag `ff_privilege_llm_first`

**Files:**
- Modify: `demo_api_server/services/configStore.js:380` (defaults block) and `:986` (env alias map)
- Modify: `demo_api_server/routes/featureFlags.js:759` (registry, next to `ff_mcp_gateway_pinggateway`) and `:1004` (`PINNED_ENV_ALIASES`)
- Test: `demo_api_server/routes/__tests__/featureFlags.privilegeLlmFirst.test.js` (create)

**Interfaces:**
- Produces: flag id `ff_privilege_llm_first` (boolean, default `'false'`), env alias `FF_PRIVILEGE_LLM_FIRST`, readable via `configStore.getEffective('ff_privilege_llm_first')`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { FLAG_REGISTRY } = require('../featureFlags');
const configStore = require('../../services/configStore');

describe('ff_privilege_llm_first', () => {
  it('is registered, boolean, and defaults OFF', () => {
    const f = FLAG_REGISTRY.find((x) => x.id === 'ff_privilege_llm_first');
    expect(f).toBeDefined();
    expect(f.type).toBe('boolean');
    expect(f.defaultValue).toBe(false);
    expect(configStore.getEffective('ff_privilege_llm_first')).toBe('false');
  });
});
```

- [ ] **Step 2: Run it** — `CI=true npx jest routes/__tests__/featureFlags.privilegeLlmFirst.test.js --forceExit` → FAIL (`f` undefined).

- [ ] **Step 3: Add the flag.** In `configStore.js` defaults:
```js
  ff_privilege_llm_first:          { public: true, default: 'false' }, // Route google/anthropic/openai chat through the Privilege virtual-key lanes instead of vendor-direct
```
  In the env alias map: `ff_privilege_llm_first: ['FF_PRIVILEGE_LLM_FIRST'],`.
  In `featureFlags.js` registry, after `ff_mcp_gateway_pinggateway`:
```js
  {
    id:           'ff_privilege_llm_first',
    name:         'Privilege first: LLM',
    category:     'LLM',
    description:
      'When **ON**, the BFF resolves `google` → `privilege_llm`, `anthropic` → `privilege_claude` and refuses ' +
      '`openai` (no Privilege dispatch exists yet, see Task 2), so every cloud LLM call enters the PingOne ' +
      'Privilege AI Gateway first and the provider API key never leaves Privilege. Requires ' +
      '`PRIVILEGE_LLM_GATEWAY_URL` and the virtual keys. Local models (llama.cpp / MLX) are unaffected.',
    impact:       'OFF (default) = vendor-direct as today. ON = Privilege virtual keys are the only cloud LLM path; a policy denial is shown, not hidden.',
    type:         'boolean',
    defaultValue: false,
  },
```
  In `PINNED_ENV_ALIASES`: `ff_privilege_llm_first: 'FF_PRIVILEGE_LLM_FIRST',`.

- [ ] **Step 4: Run it** → PASS. Also run `CI=true npx jest routes/__tests__/featureFlags --forceExit` to confirm the registry-shape tests still pass.

- [ ] **Step 5: Commit** — `git add demo_api_server/services/configStore.js demo_api_server/routes/featureFlags.js demo_api_server/routes/__tests__/featureFlags.privilegeLlmFirst.test.js && git commit -m "feat(privilege): ff_privilege_llm_first flag (default off)"`.

### Task 2: Resolver aliases cloud providers to the Privilege lanes

**Files:**
- Modify: `demo_api_server/services/llmProviderResolver.js:24-36`
- Test: `demo_api_server/tests/llmProviderResolver.privilegeFirst.test.js` (create)

**Interfaces:**
- Consumes: `configStore.getEffective('ff_privilege_llm_first')` (Task 1), `process.env.PRIVILEGE_LLM_GATEWAY_URL`.
- Produces: `resolveLlmProvider({provider:'google'})` → `{provider:'privilege_llm'}`; `'anthropic'` → `'privilege_claude'`; `'openai'` → throws `Error` with `code='llm_privilege_first_unsupported'` (no OpenAI dispatch in `geminiNlIntent.js` today — adding one is a separate feature, not this plan). `'auto'`/unset still resolves to Helix (Helix is a PingOne service, not a third-party key — leave it).

**Design note:** `geminiNlIntent.js:505` already routes `provider === 'auto'` through this resolver and dispatches on the *resolved* name, and `PRIVILEGE_LLM_PROVIDERS`/`PRIVILEGE_CLAUDE_PROVIDERS` (`:132-133`) already dispatch the aliased names with the denial-propagation contract. Aliasing here is the whole change — ARCHITECTURE-TRUTHS T-3: no other module may inline a provider default.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
jest.mock('../services/configStore', () => ({ getEffective: jest.fn() }));
const configStore = require('../services/configStore');
const { resolveLlmProvider } = require('../services/llmProviderResolver');

describe('ff_privilege_llm_first', () => {
  beforeEach(() => { process.env.PRIVILEGE_LLM_GATEWAY_URL = 'https://mcpgw.example'; });
  afterEach(() => { delete process.env.PRIVILEGE_LLM_GATEWAY_URL; });

  it('OFF: cloud providers pass through unchanged', () => {
    configStore.getEffective.mockReturnValue('false');
    expect(resolveLlmProvider({ provider: 'google' }).provider).toBe('google');
    expect(resolveLlmProvider({ provider: 'anthropic' }).provider).toBe('anthropic');
  });

  it('ON: google → privilege_llm, anthropic → privilege_claude, model preserved', () => {
    configStore.getEffective.mockReturnValue('true');
    expect(resolveLlmProvider({ provider: 'google', model: 'gemini-2.0-flash' }))
      .toEqual({ provider: 'privilege_llm', model: 'gemini-2.0-flash' });
    expect(resolveLlmProvider({ provider: 'anthropic' }).provider).toBe('privilege_claude');
  });

  it('ON: openai is refused loudly rather than silently going vendor-direct', () => {
    configStore.getEffective.mockReturnValue('true');
    expect(() => resolveLlmProvider({ provider: 'openai' }))
      .toThrow(expect.objectContaining({ code: 'llm_privilege_first_unsupported' }));
  });

  it('ON but gateway URL unset: falls back to vendor-direct and warns', () => {
    configStore.getEffective.mockReturnValue('true');
    delete process.env.PRIVILEGE_LLM_GATEWAY_URL;
    expect(resolveLlmProvider({ provider: 'google' }).provider).toBe('google');
  });
});
```

- [ ] **Step 2: Run it** → FAIL (aliases missing).

- [ ] **Step 3: Implement.** Replace the pass-through branch at `llmProviderResolver.js:34-37`:

```js
const PRIVILEGE_FIRST_ALIAS = { google: 'privilege_llm', anthropic: 'privilege_claude' };

function privilegeFirstOn() {
  const configStore = require('./configStore');
  return configStore.getEffective('ff_privilege_llm_first') === 'true';
}

  if (requested === 'openai' || requested === 'anthropic' || requested === 'google') {
    if (privilegeFirstOn()) {
      if (!process.env.PRIVILEGE_LLM_GATEWAY_URL) {
        console.warn('[llmProvider] ff_privilege_llm_first is ON but PRIVILEGE_LLM_GATEWAY_URL is unset — vendor-direct');
        return { provider: requested, model };
      }
      const alias = PRIVILEGE_FIRST_ALIAS[requested];
      if (!alias) {
        const err = new Error(`ff_privilege_llm_first: no Privilege dispatch for provider "${requested}"`);
        err.code = 'llm_privilege_first_unsupported';
        throw err;
      }
      return { provider: alias, model };
    }
    // Pass-through: :3006 enforces credential presence and fails fast.
    return { provider: requested, model };
  }
```
  Update the JSDoc return union to include `'privilege_llm'|'privilege_claude'`. Note the `require('./configStore')` is inside the function on purpose: `llmProviderResolver.bedrock.test.js` and the lmstudio regression tests load this module without a configStore mock.

- [ ] **Step 3b: Keep open questions on the lane** *(added 2026-09-09)*. `answerConversational` / `conversationalSource` (`geminiNlIntent.js:339-354`) and the open-question guard at `:869-876` list every provider except the two Privilege ids, so an aliased provider drops to heuristics for anything the JSON router misses. Add `PRIVILEGE_LLM_PROVIDERS` → an answer via `callPrivilegeGemini` and `PRIVILEGE_CLAUDE_PROVIDERS` → via `callPrivilegeClaude` (both already imported at `:688-737`), with sources `privilege_llm_fallback` / `privilege_claude_fallback` and matching labels in `demo_api_ui/src/config/agentModes.js`. One test each in `tests/geminiNlIntent*.test.js`: an open question under the aliased provider calls the Privilege service, not Helix.

- [ ] **Step 4: Run** the new test and the three existing resolver tests (`CI=true npx jest tests/llmProviderResolver --forceExit`) → all PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(privilege): alias google/anthropic to Privilege lanes when ff_privilege_llm_first"`.

### Task 3: Sidecar agents and LibreChat enter Privilege by env

**Files:**
- Modify: `docker-compose.yml:1466, 1506, 1545` (openai / pydantic / mastra `AGENT_LLM_BASE_URL`), plus `AGENT_LLM_API_KEY` on the same three services
- Modify: `librechat/librechat.yaml:26-30`
- Modify: `.env.example` (root) — document the two knobs
- Modify: `demo_agent_service/src/reasoningGraph.ts:189-192` (Anthropic) and the Google branch at `:305-310`
- Test: `scripts/check-privilege-first-env.test.js` (create, `node:test`, drift guard like `scripts/check-privilege-llm-config.test.js`)

**Interfaces:**
- Produces: root env `AGENT_LLM_BASE_URL` (default `http://host.docker.internal:8090/v1`) and `AGENT_LLM_API_KEY` (default `none`). Privilege-first posture = `AGENT_LLM_BASE_URL=${PRIVILEGE_LLM_GATEWAY_URL}/llm/openai/v1`, `AGENT_LLM_API_KEY=${PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI}`. This is a **deployment posture, not a runtime flag** — the sidecars have no configStore.

**Design note (ponytail):** zero agent code changes. The three sidecars already read one base-URL env and one key env; Privilege's OpenAI lane is wire-compatible. The runtime flag from Task 1 governs the BFF; the env governs sidecars. Both are reported by Task 4 so the two cannot silently disagree.

- [ ] **Step 1: Write the drift guard** `scripts/check-privilege-first-env.test.js`: assert that every `AGENT_LLM_BASE_URL:` line in `docker-compose.yml` reads `"${AGENT_LLM_BASE_URL:-http://host.docker.internal:8090/v1}"` and is paired with `AGENT_LLM_API_KEY: "${AGENT_LLM_API_KEY:-none}"`, and that `.env.example` documents both keys.

```js
'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

it('every sidecar AGENT_LLM_BASE_URL is env-driven, with a key beside it', () => {
  const lines = compose.split('\n');
  const hits = lines.map((l, i) => [l, i]).filter(([l]) => /^\s+AGENT_LLM_BASE_URL:/.test(l));
  assert.ok(hits.length >= 3, 'expected openai/pydantic/mastra agents');
  for (const [l, i] of hits) {
    assert.match(l, /\$\{AGENT_LLM_BASE_URL:-http:\/\/host\.docker\.internal:8090\/v1\}/, `line ${i + 1}`);
    const window = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
    assert.match(window, /AGENT_LLM_API_KEY: "\$\{AGENT_LLM_API_KEY:-none\}"/, `no key near line ${i + 1}`);
  }
});

it('.env.example documents the Privilege-first posture', () => {
  assert.match(envExample, /^#?\s*AGENT_LLM_BASE_URL=/m);
  assert.match(envExample, /^#?\s*AGENT_LLM_API_KEY=/m);
});
```

- [ ] **Step 2: Run** `node --test scripts/check-privilege-first-env.test.js` → FAIL.

- [ ] **Step 3: Edit compose.** For each of the three services replace the hardcoded line with:
```yaml
      AGENT_LLM_BASE_URL: "${AGENT_LLM_BASE_URL:-http://host.docker.internal:8090/v1}"
      AGENT_LLM_API_KEY: "${AGENT_LLM_API_KEY:-none}"
```
  In `.env.example` add:
```bash
# Privilege-first LLM posture for the sidecar agents (openai/pydantic/mastra, LibreChat).
# Default = local model proxy. To enter PingOne Privilege first, set:
#   AGENT_LLM_BASE_URL=${PRIVILEGE_LLM_GATEWAY_URL}/llm/openai/v1
#   AGENT_LLM_API_KEY=<PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI>
# AGENT_LLM_BASE_URL=http://host.docker.internal:8090/v1
# AGENT_LLM_API_KEY=none
```
  In `librechat/librechat.yaml:26-30` change `baseURL`/`apiKey` to `${AGENT_LLM_BASE_URL}` / `${AGENT_LLM_API_KEY}` (LibreChat expands env in its YAML).

- [ ] **Step 4: agent-service (:3006).** The Anthropic and Google branches hardcode vendor origins. Add env-driven base URLs, SDK-native names so nothing else changes:
```ts
// reasoningGraph.ts — Anthropic branch, in the `else` of `if (isLmStudio)`:
        if (process.env.ANTHROPIC_BASE_URL) clientOpts.baseURL = process.env.ANTHROPIC_BASE_URL;
// Google branch: pass baseUrl through to ChatGoogleGenerativeAI
        ...(process.env.GOOGLE_BASE_URL ? { baseUrl: process.env.GOOGLE_BASE_URL } : {}),
```
  **Map the aliased names** *(added 2026-09-09)*: the BFF reason loop passes the *resolved* provider to `:3006` (`demoAgentLangGraphService.js:2131`), and `reasonOnce` answers `unknown provider` for anything it lacks (`reasoningGraph.ts:531`), so with Task 2 ON the chat agent would silently fall to heuristics. At the top of `reasonOnce`, fold `privilege_claude` into the Anthropic branch and `privilege_llm` into the Google branch with the Privilege base URL and virtual key (`PRIVILEGE_LLM_GATEWAY_URL`, `PRIVILEGE_LLM_VIRTUAL_KEY_{ANTHROPIC,GOOGLE}` — add them to `demo_agent_service/.env.example` and the compose service). One test in `demo_agent_service/src/__tests__`: `provider: 'privilege_claude'` constructs the Anthropic client with `baseURL = <gateway>/llm/anthropic` and the virtual key.
  `@langchain/openai` / `openai` already honour `OPENAI_BASE_URL`. Document in `demo_agent_service/.env.example`: Privilege-first = `OPENAI_BASE_URL=${PRIVILEGE_LLM_GATEWAY_URL}/llm/openai/v1`, `ANTHROPIC_BASE_URL=${PRIVILEGE_LLM_GATEWAY_URL}/llm/anthropic`, `GOOGLE_BASE_URL=${PRIVILEGE_LLM_GATEWAY_URL}/llm/google`, with the matching `*_API_KEY` = the virtual key. (`compliance_agent/agent.py:24` gets the same via the Anthropic Python SDK's `ANTHROPIC_BASE_URL` — env only, no edit.)

- [ ] **Step 5: Run** the drift guard → PASS. Then `./run-docker.sh restart openai-agent` with `AGENT_LLM_BASE_URL` set to the Privilege lane and send one chat: expect a real completion; then set a model the virtual key's policy forbids and expect the agent to surface the gateway's `data.error.message`, not a stack trace.

- [ ] **Step 6: Commit** — `git commit -m "feat(privilege): sidecar agents and LibreChat take the LLM base URL/key from env so Privilege can be first"`.

### Task 4: `/api/check` proves the posture

**Files:**
- Create: `demo_api_server/services/checks/privilegeLlmFirstCheck.js`
- Modify: `demo_api_server/services/checks/index.js` (require after `llmDeepCheck`)
- Test: `demo_api_server/tests/checks/privilegeLlmFirstCheck.test.js`

**Interfaces:**
- Produces: check id `llm.privilege_first`, category `LLM`, severity `advisory`, `appliesWhen: flags.ff_privilege_llm_first === true`. `pass` when `PRIVILEGE_LLM_GATEWAY_URL` is set and one cheap Gemini call via `callPrivilegeGemini` succeeds or is policy-denied (denial is a working gate); `fail` on network error or unset URL; `warn` when the sidecar env (`AGENT_LLM_BASE_URL`) still points at `:8090` while the flag is on (posture disagreement).

- [ ] **Step 1: Write the failing test** — mock `../../services/privilegeLlmProxyService` and assert the three outcomes above.
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** following `gatewayMetadataCheck.js`'s `register({...})` shape; the cheap call is `callPrivilegeGemini([{role:'user',content:'ping'}], { maxTokens: 1 })` wrapped so `err.code === 'llm_policy_denied'` → `pass` with `detail: 'Privilege denied by policy (gate is live)'`.
- [ ] **Step 4: Run** → PASS. Open `/check` with the flag on and confirm the row renders.
- [ ] **Step 5: Commit.**

---

## Phase 2 — MCP first (SE only; gated on Task 0's outcome)

### Task 5: Register the Agent Gateway as a Privilege Agentic App (console, user-side)

**Files:**
- Modify: `privilege/CURRENT-CONFIGURATION.md` (apps table: add `agent-gateway` row)
- Modify: `k8s/03-secrets.yaml.template`, `scripts/create-secrets.sh` (`MCP_GW_PRIVILEGE_BRIDGE_SECRET`, empty in template)

- [ ] **Step 1: Console → Agentic Apps → Add Application → MCP Server**

  | Field | Value |
  |---|---|
  | Application Name | `agent-gateway` |
  | MCP Server URL | `http://ping-gateway.ping-devops-cmuir.svc.cluster.local:8080/mcp` (PingGateway lane) — or `http://mcp-gateway.ping-devops-cmuir.svc.cluster.local:3005/mcp` if Task 0 measured against the Node gateway and D4 lands there |
  | Mesh Cluster | `ai-demo-cmuir` |
  | Auth Mode | **Static Token** = `MCP_GW_PRIVILEGE_BRIDGE_SECRET` (secrets path only; a JWT-shaped value if Task 0 Step 3 measured that the field is parsed) — *corrected 2026-09-09, OAuth mode gates the client too* |

  Check the hostname character by character (`cmuir`, not `curtismuir`).

- [ ] **Step 2: Policy.** Attach a policy to the demo's Privilege-tenant users; narrow the tool list (start with `get_weather`, `brave_search`, `list_banking_accounts`); set a time-box you will remember expires (an expired policy is a bare 403).
- [ ] **Step 3: Verify discovery** — console shows the Agent Gateway's merged tool list. If the console shows stale tools, read the app-container JSON on the pod, not the form.
- [ ] **Step 4: Record** the row in `privilege/CURRENT-CONFIGURATION.md` and commit the doc.

### Task 6: Flag `ff_mcp_gateway_privilege_first` and the URL ladder

**Files:**
- Modify: `demo_api_server/services/configStore.js:380, 986`; `demo_api_server/routes/featureFlags.js:759, 1004`
- Modify: `demo_api_server/services/mcpGatewayClient.js:1116-1146` (`getMcpGatewayHttpUrl`)
- Modify: `service-topology.json` (add `MCP_PRIVILEGE_GATEWAY_URL`, `"public"`)
- Test: `demo_api_server/tests/mcpGatewayClient.privilegeFirst.test.js`

**Interfaces:**
- Produces: flag `ff_mcp_gateway_privilege_first` (default `'false'`, env `FF_MCP_GATEWAY_PRIVILEGE_FIRST`); env `MCP_PRIVILEGE_GATEWAY_URL` (default `${MCP_FACADE_PRIVILEGE_GATEWAY_BASE}/agent-gateway/mcp`, i.e. `https://mcpgw.ai-demo.ping-devops.com/agent-gateway/mcp`); `getMcpGatewayHttpUrl()` returns it when the flag is on, **before** the PingGateway branch.

- [ ] **Step 1: Write the failing test** — with `configStore.getEffective` mocked: flag on + URL set → the Privilege URL; flag on + URL unset → falls through to today's ladder and logs a warning; flag off → unchanged.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** at the top of `getMcpGatewayHttpUrl()`:
```js
    // Privilege-first: the Privilege AI Gateway is the first hop and forwards to
    // whichever Agent Gateway its Agentic App "agent-gateway" is registered
    // against. Checked BEFORE the PingGateway flag so the two compose: Privilege
    // in front, PingGateway behind. SE only — see plan D3.
    if (configStore.getEffective('ff_mcp_gateway_privilege_first') === 'true') {
        const privUrl = process.env.MCP_PRIVILEGE_GATEWAY_URL
            || (process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE
                ? `${process.env.MCP_FACADE_PRIVILEGE_GATEWAY_BASE.replace(/\/$/, '')}/agent-gateway/mcp`
                : '');
        if (privUrl) return privUrl.replace(/\/$/, '');
        console.warn('[mcpGateway] ff_mcp_gateway_privilege_first ON but no MCP_PRIVILEGE_GATEWAY_URL — using next lane');
    }
```
  Flag registry entry mirrors Task 1's shape with name `Privilege first: MCP`, category `MCP / Agent`, description naming the chain Privilege → Agent Gateway → MCP servers and the SE-only constraint.
- [ ] **Step 4: Run** the new test plus `CI=true npx jest tests/mcpGatewayClient --forceExit` → PASS. Run `node scripts/gen-service-topology.js check` → clean.
- [ ] **Step 5: Commit.**

### Task 7: Transport kind `privilege` — bearer swap and subject header

**Files:**
- Modify: `demo_api_server/services/mcpGatewayTransport.js`
- Modify: `demo_api_server/services/mcpGatewayClient.js` — `callToolViaGateway` header assembly near `:337` (where `mcpActorBridge` headers are merged)
- Test: `demo_api_server/tests/mcpGatewayTransport.privilege.test.js`

**Interfaces:**
- Consumes: `privilegeGatewaySession.getAccessToken()` / `.status()` (existing), `getMcpGatewayHttpUrl()` (Task 6).
- Produces: `resolveMcpGatewayTransport()` → `{ kind: 'privilege', url }` when the Privilege-first flag is on. `callToolViaResolvedGateway()` for that kind sends `Authorization: Bearer <privilege session token>` and, when Task 0 measured (a), `X-Subject-Token: <exchanged user token>`; the `X-Act-Client-Id` / `X-May-Act-Sub` bridge headers are sent unchanged. When no session is armed it throws `{ code: 'privilege_session_unavailable', remedy: 'Sign in at /privilege-mcp-client' }` — the same contract the façade's 503 already carries (`mcpFacade.js:678-695`).

- [ ] **Step 1: Write the failing test** — mock `privilegeGatewaySession` and `mcpGatewayClient.callToolViaGateway`; assert (i) bearer is the session token, not the user token; (ii) `X-Subject-Token` equals the user token; (iii) no session → the coded error; (iv) flag off → `kind: 'demo'` and no new headers.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
```js
function privilegeFirstOn() {
  return require('./configStore').getEffective('ff_mcp_gateway_privilege_first') === 'true';
}

function resolveMcpGatewayTransport() {
  if (isBedrockGatewayEffective()) { /* unchanged */ }
  const { getMcpGatewayHttpUrl } = require('./mcpGatewayClient');
  return { kind: privilegeFirstOn() ? 'privilege' : 'demo', url: getMcpGatewayHttpUrl() };
}

async function callToolViaResolvedGateway(gatewayUrl, bearerToken, tool, params = {}, opts = {}) {
  if (isBedrockGatewayEffective()) { /* unchanged */ }
  const { callToolViaGateway } = require('./mcpGatewayClient');
  if (!privilegeFirstOn()) return callToolViaGateway(gatewayUrl, bearerToken, tool, params, opts);

  const session = require('./privilegeGatewaySession');
  const gatewayToken = await session.getAccessToken();
  if (!gatewayToken) {
    const err = new Error('Privilege gateway session unavailable');
    err.code = 'privilege_session_unavailable';
    err.remedy = 'Sign in at /privilege-mcp-client to arm the gateway session';
    throw err;
  }
  // Privilege is the bearer's audience; the user's exchanged token rides in a header
  // the Agent Gateway validates exactly like a bearer (Task 8). ponytail: one header,
  // no envelope format — revisit if Privilege ever forwards the inbound bearer itself.
  const extraHeaders = { ...(opts.extraHeaders || {}), 'X-Subject-Token': bearerToken };
  return callToolViaGateway(gatewayUrl, gatewayToken, tool, params, { ...opts, extraHeaders });
}
```
  In `callToolViaGateway`, merge `opts.extraHeaders` into the outbound headers where the actor-bridge headers are merged (`mcpGatewayClient.js:337`). If Task 0 chose (b), omit the `X-Subject-Token` line and keep everything else.
- [ ] **Step 4: Run** → PASS; also `CI=true npx jest tests/mcpGatewayTransport --forceExit` (bedrock routing tests must stay green — they load this file without configStore, hence the lazy require).
- [ ] **Step 5: Commit.**

### Task 8: Agent Gateway (Node) accepts the subject token from the Privilege bridge

**Required in every outcome** *(corrected 2026-09-09; was "only if (a)")* — the bearer Privilege sends is a static value, never a JWT the validator accepts. Under (a) the subject token supplies the user; under (b) only the machine-subject branch is exercised.

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts` — HTTP `/mcp` handler where the bearer is read (near the `X-Act-Client-Id` bridge at `:1212-1223`) and the WS upgrade path at `:539`
- Modify: `demo_mcp_gateway/src/config.ts` — new `MCP_GW_PRIVILEGE_BRIDGE_SECRET` (empty = feature off; ≥ 32 bytes, secrets path)
- Modify: `demo_mcp_gateway/.env.example`
- Test: `demo_mcp_gateway/src/__tests__/privilegeBridge.test.ts`

**Interfaces:**
- Consumes: `validateInboundToken(token, audience)` (existing), `GatewayTokenPolicy` (existing).
- Produces: when `config.privilegeBridgeSecret` is set **and** the raw bearer equals it (`crypto.timingSafeEqual`, checked **before** `validateInboundToken`, which would otherwise reject it at JWKS key selection — measured, see `privilege/CURRENT-CONFIGURATION.md`): with `X-Subject-Token` present, the subject token is run through `validateInboundToken` with the same audience and becomes `decoded` for the rest of the pipeline with `act` extended by `{ sub: 'privilege-bridge' }` (so P1AZ and the audit rail see Privilege as an actor hop); without it, `decoded` = `{ sub: 'privilege-bridge', aud, scope: '' }` so scope-gated tools DENY as `insufficient_scope` rather than `login_required`. Any failure of the subject token → the same `-32001 login_required` the bearer path emits. A bearer that is not the bridge secret **ignores** the header (it is never trusted from an arbitrary caller). Both transports (HTTP and WS).

- [ ] **Step 1: Write the failing tests** — (i) bridge bearer + valid subject token → pipeline sees the user's `sub` and an `act` chain ending in the bridge; (ii) bridge bearer + bad subject token → `-32001`; (iii) non-bridge bearer + header → header ignored, original `sub` kept; (iv) config unset → header ignored, bridge bearer rejected as today; (v) bridge bearer, no header → machine subject, scope-gated tool → `insufficient_scope`.
- [ ] **Step 2: Run** `npm test -- privilegeBridge` in `demo_mcp_gateway/` → FAIL.
- [ ] **Step 3: Implement** a single helper used by both transports:
```ts
// src/auth/privilegeBridge.ts
import { validateInboundToken, type DecodedToken } from '../tokenValidator';

/** If the bearer is the Privilege bridge, swap in the user's subject token and
 *  record the bridge as an act hop. Never trusts the header from anyone else. */
export function isPrivilegeBridgeBearer(bearer: string, secret: string): boolean {
  if (!secret || bearer.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(bearer), Buffer.from(secret));
}

export async function resolvePrivilegeBridge(
  subjectToken: string | undefined, audience: string,
): Promise<DecodedToken> {
  const BRIDGE = 'privilege-bridge';
  if (!subjectToken) return { sub: BRIDGE, aud: audience, scope: '' } as DecodedToken;
  const user = await validateInboundToken(subjectToken, audience); // throws TokenValidationError
  return { ...user, act: { sub: BRIDGE, ...(user.act ? { act: user.act } : {}) } };
}
```
  Call `isPrivilegeBridgeBearer` **before** `validateInboundToken` on both paths (a bridge bearer never reaches the JWT decoder), reading `req.headers['x-subject-token']` (string, single value, ≤ 8 KB — reject otherwise). Do **not** relax `GatewayTokenPolicy`: the merged `act` chain already satisfies "act.sub non-empty", and `actChainDepth` grows by one — confirm the A2A depth tests in `__tests__` still pass.
- [ ] **Step 4: Run** the gateway test suite → PASS. Rebuild the image (`demo_mcp_gateway` is not bind-mounted).
- [ ] **Step 5: Commit.**

**Task 8b (follow-on, not in this plan's scope):** the PingGateway route equivalent lives in `ping-gateway/` route config (`McpProtectionFilter` chain); the same rule applies — accept `X-Subject-Token` only when the introspected bearer's `sub` is the bridge. Design it once Task 8 is proven on the Node gateway.

### Task 9: Inventory, check, preflight

**Files:**
- Modify: `demo_api_server/data/serverInventory.js:56-90` (add the Privilege AI Gateway as a server with the `agent-gateway` app URL)
- Create: `demo_api_server/services/checks/privilegeMcpFirstCheck.js`; register in `checks/index.js` after `gatewayMetadataCheck`
- Modify: `scripts/lib/preflightRows.js` (Plan A's door table) — add door `agent-gateway` under the Privilege gateway
- Test: `demo_api_server/tests/checks/privilegeMcpFirstCheck.test.js`

**Interfaces:**
- Produces: check `gateway.privilege_first` (`appliesWhen: flags.ff_mcp_gateway_privilege_first === true`): `pass` when `privilegeGatewaySession.status()` is armed **and** an authenticated `tools/list` against `MCP_PRIVILEGE_GATEWAY_URL` returns ≥ 1 tool; `warn` with `remedy` when the session is absent/expired (the demo-killer from spec §2.2); `fail` on 403 with detail "Privilege policy missing or expired for app agent-gateway".

- [ ] **Step 1: Write the failing test** (mock session + fetch; three outcomes).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; reuse the JSON-RPC probe helper in `scripts/check-mcp-preflight.js` rather than a new one.
- [ ] **Step 4: Run** tests → PASS; run `npm run demo:preflight -- --target se` and confirm the new row.
- [ ] **Step 5: Commit.**

### Task 10: Docs and the demo beat

**Files:**
- Modify: `docs/ARCHITECTURE-TRUTHS.md` — new truth "T-17: Privilege-first is a chain, not a lane" (Privilege → Agent Gateway → servers; two identities per call by design; SE-only; both flags default off). Also fix the stale citation at `:585` (`getMcpGatewayHttpUrl.js` → `services/mcpGatewayClient.js:1116`) since the file is already being edited.
- Modify: `privilege/CURRENT-CONFIGURATION.md` — Task 0 findings + `agent-gateway` app row (done in Tasks 0/5; verify).
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx` — one step "Privilege first" that flips both flags via `/config`, runs one chat + one tool, and (under D1 outcome b) a banking tool showing the Agent Gateway DENY with reason.

- [ ] **Step 1:** Write the truth and the step. No new UI page — the LLM Gateway page (`LlmGatewayPage.jsx`) and the Agent Gateway inspector already render the two halves.
- [ ] **Step 2:** Run the UI test suite for `DemoStepsDropdown` (`npx vitest run DemoSteps` in `demo_api_ui/`) → PASS.
- [ ] **Step 3: Commit**, open the PR with the Task 0 measurement transcript in the body.

---

## Self-review

- **Coverage of the ask:** Privilege first for LLM → Tasks 1–4. Privilege first for MCP → Tasks 5–9. Agent Gateway "for the rest" → unchanged pipeline behind Privilege; Task 8 only *adds* an accepted input. Visibility/repro → Tasks 4, 9, 10.
- **Placeholders:** none; the one deliberately open item (D1) is a measurement with a written decision rule (Task 0 Step 5), not a TBD.
- **Type/name consistency:** `ff_privilege_llm_first` / `FF_PRIVILEGE_LLM_FIRST` (Tasks 1, 2, 4); `ff_mcp_gateway_privilege_first` / `FF_MCP_GATEWAY_PRIVILEGE_FIRST` / `MCP_PRIVILEGE_GATEWAY_URL` (Tasks 6, 7, 9); `X-Subject-Token` and `MCP_GW_PRIVILEGE_BRIDGE_SECRET` (Tasks 5, 7, 8); error codes `llm_privilege_first_unsupported`, `privilege_session_unavailable`.
- **Known ceilings, stated:** no OpenAI dispatch in the BFF (refused loudly, Task 2); local models not governed (D2); MCP-first SE-only (D3); PingGateway header acceptance deferred (Task 8b); elicitation does not cross Privilege (§1.2), so HITL-via-elicitation tools will hang behind it — CIBA-based HITL is unaffected.
