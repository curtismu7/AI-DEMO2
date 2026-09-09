# Privilege-First Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every LLM call and every MCP tool call from this demo's agents enters through the PingOne Privilege AI Gateway first; Privilege owns credentials, coarse policy, approvals and recording, and hands MCP traffic on to the Agent Gateway, which keeps doing everything it does today (introspection, RFC 8693 exchange, P1AZ per-tool decisions, D-05, HITL, RAR).

**Architecture:** No new services. The Privilege AI Gateway at `https://mcpgw.ai-demo.ping-devops.com` already fronts LLM providers (`/llm/<provider>/…` virtual keys) and MCP backends (`/<AgenticApp>/mcp`). Phase 1 makes the LLM virtual-key lanes the *default* path instead of an opt-in picker item. Phase 2 registers the Agent Gateway itself as a Privilege Agentic App and repoints the BFF's single MCP chokepoint at it, behind a flag. Phase 0 is a measurement spike that decides how identity crosses the Privilege → Agent Gateway hop, because the answer is not in any doc in this repo.

**Tech Stack:** Node >= 22 CommonJS BFF (`demo_api_server`), Jest 29.7, PingOne Privilege console (user-side), PingGateway (`ping-gateway/`) and the Node gateway (`demo_mcp_gateway/`, TypeScript), Docker Compose + SE K8s (`ping-devops-cmuir`, gateway in `ping-devops-curtismuir`).

**Spec:** This plan is its own spec — the user's ask was "Privilege as the first gateway, controls LLM/MCP, then Agent Gateway for the rest. Just a plan." Section 1 below records the current state it argues from (verified 2026-09-08, sources cited).

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

**D1 — Identity across the Privilege → Agent Gateway hop (the fork that gates Phase 2).**
Privilege will not accept the demo-env user token inbound (§1.2), so the BFF's exchanged user token cannot simply *be* the bearer Privilege sees. Three outcomes, chosen by the Phase 0 measurement:

| Outcome | What Privilege does on the backend hop | Phase 2 shape |
|---|---|---|
| **(a) Header pass-through** — Privilege forwards custom request headers unchanged | BFF sends bearer = Privilege session token, plus `X-Subject-Token: <exchanged user token>`; Agent Gateway validates the header token exactly like a bearer when the bearer's `sub` is the allow-listed bridge client, and records the bridge as an `act` hop | Tasks 6–8 as written (recommended if measured) |
| **(b) OAuth machine token only, no header forwarding** | Agent Gateway sees the bridge client as subject; user identity is lost; banking tools DENY for lack of `banking:read` | Ship Phase 2 for tools that need no user scope (weather, brave, opensearch) and make the banking DENY the demo beat ("Privilege let it through, Agent Gateway refused: no delegated user"). Raise the header gap with Ping. |
| **(c) Privilege forwards the inbound bearer verbatim** | Only useful if Privilege trusted the demo-env issuer — it does not | Not reachable today; recorded so nobody re-tests it |

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

- [ ] **Step 3: Measurement 2 — what does Auth Mode OAuth mint?**
  Create a demo-env PingOne app `privilege-bridge` (client_credentials, scope `gateway:mcp:invoke`, resource = the Agent Gateway audience from `service-topology.json:71-79`). Edit `probe-agent-gateway` → Auth Mode **OAuth**, Authorization/Token URLs = demo env `01d89b06…`, the bridge client id/secret. Re-run `tools/list`; read `[GW]` lines for `sub`, `aud`, `act`, `scope`.
  Expected: `sub` = bridge client id, no `act`, `aud` = gateway resource. Confirms (b) is the floor.

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
- Modify: `k8s/03-secrets.yaml.template`, `scripts/create-secrets.sh` (bridge client secret, empty in template) — only if Task 0 chose OAuth mode

- [ ] **Step 1: Console → Agentic Apps → Add Application → MCP Server**

  | Field | Value |
  |---|---|
  | Application Name | `agent-gateway` |
  | MCP Server URL | `http://ping-gateway.ping-devops-cmuir.svc.cluster.local:8080/mcp` (PingGateway lane) — or `http://mcp-gateway.ping-devops-cmuir.svc.cluster.local:3005/mcp` if Task 0 measured against the Node gateway and D4 lands there |
  | Mesh Cluster | `ai-demo-cmuir` |
  | Auth Mode | per Task 0: **OAuth** (demo env `01d89b06…` token URL, client `privilege-bridge`, scope `gateway:mcp:invoke`) |

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

**Only if Task 0 measured (a).** Skip entirely under (b).

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts` — HTTP `/mcp` handler where the bearer is read (near the `X-Act-Client-Id` bridge at `:1212-1223`) and the WS upgrade path at `:539`
- Modify: `demo_mcp_gateway/src/config.ts` — new `MCP_GW_PRIVILEGE_BRIDGE_CLIENT_ID` (empty = feature off)
- Modify: `demo_mcp_gateway/.env.example`
- Test: `demo_mcp_gateway/src/__tests__/privilegeBridge.test.ts`

**Interfaces:**
- Consumes: `validateInboundToken(token, audience)` (existing), `GatewayTokenPolicy` (existing).
- Produces: when `config.privilegeBridgeClientId` is set **and** the validated bearer's `sub` equals it **and** `X-Subject-Token` is present: the subject token is run through `validateInboundToken` with the same audience, and becomes `decoded` for the rest of the pipeline with `act` extended by `{ sub: <bridge client id> }` (so P1AZ and the audit rail see Privilege as an actor hop). Any failure of the subject token → the same `-32001 login_required` the bearer path emits. A bearer whose `sub` is not the bridge **ignores** the header (it is never trusted from an arbitrary caller). Both transports (HTTP and WS).

- [ ] **Step 1: Write the failing tests** — (i) bridge bearer + valid subject token → pipeline sees the user's `sub` and an `act` chain ending in the bridge; (ii) bridge bearer + bad subject token → `-32001`; (iii) non-bridge bearer + header → header ignored, original `sub` kept; (iv) config unset → header ignored.
- [ ] **Step 2: Run** `npm test -- privilegeBridge` in `demo_mcp_gateway/` → FAIL.
- [ ] **Step 3: Implement** a single helper used by both transports:
```ts
// src/auth/privilegeBridge.ts
import { validateInboundToken, type DecodedToken } from '../tokenValidator';

/** If the bearer is the Privilege bridge, swap in the user's subject token and
 *  record the bridge as an act hop. Never trusts the header from anyone else. */
export async function applyPrivilegeBridge(
  decoded: DecodedToken, subjectToken: string | undefined, audience: string, bridgeClientId: string,
): Promise<DecodedToken> {
  if (!bridgeClientId || decoded.sub !== bridgeClientId || !subjectToken) return decoded;
  const user = await validateInboundToken(subjectToken, audience); // throws TokenValidationError
  return { ...user, act: { sub: bridgeClientId, ...(user.act ? { act: user.act } : {}) } };
}
```
  Call it immediately after `validateInboundToken` on both paths, reading `req.headers['x-subject-token']` (string, single value, ≤ 8 KB — reject otherwise). Do **not** relax `GatewayTokenPolicy`: the merged `act` chain already satisfies "act.sub non-empty", and `actChainDepth` grows by one — confirm the A2A depth tests in `__tests__` still pass.
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
- **Type/name consistency:** `ff_privilege_llm_first` / `FF_PRIVILEGE_LLM_FIRST` (Tasks 1, 2, 4); `ff_mcp_gateway_privilege_first` / `FF_MCP_GATEWAY_PRIVILEGE_FIRST` / `MCP_PRIVILEGE_GATEWAY_URL` (Tasks 6, 7, 9); `X-Subject-Token` and `MCP_GW_PRIVILEGE_BRIDGE_CLIENT_ID` (Tasks 7, 8); error codes `llm_privilege_first_unsupported`, `privilege_session_unavailable`.
- **Known ceilings, stated:** no OpenAI dispatch in the BFF (refused loudly, Task 2); local models not governed (D2); MCP-first SE-only (D3); PingGateway header acceptance deferred (Task 8b); elicitation does not cross Privilege (§1.2), so HITL-via-elicitation tools will hang behind it — CIBA-based HITL is unaffected.
