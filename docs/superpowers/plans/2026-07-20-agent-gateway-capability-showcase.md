# Agent Gateway — Capability Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 7 Agent Gateway capabilities (validate & audit MCP requests, throttle & transform tokens, enforce OAuth/policy/metadata) visible and demoable — closing two real walkthrough gaps and adding honest PingGateway-vs-Node attribution — without touching real enforcement logic in either gateway.

**Architecture:** One new config file (`agentGatewayCapabilities.js`) is the single source of truth, read by a new standalone tour page, a reusable callout dropped into 5 existing panels, and a new additive strip section on `/use-cases`. Two small, isolated gateway changes (a 429 audit-visibility fix and a reused live-config-push mechanism for a new sim) close the only two capabilities with no live walkthrough coverage. Everything else is UI composition of data that already exists.

**Tech Stack:** React (demo_api_ui), Express (demo_api_server), TypeScript (demo_mcp_gateway), Jest + React Testing Library / Jest + injectable-deps harness for gateway tests.

## Global Constraints

- No changes to real enforcement logic in `demo_mcp_gateway` or `ping-gateway` — only additive, isolated, demo-scaffolding changes (matches the approved spec's "reframe only, keep code").
- No live dual-runtime toggle; no trimming of Node's fallback checks.
- Emoji allowlist only if any UI copy needs one: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` (per project CLAUDE.md §0). Prefer no emoji.
- `demo_mcp_gateway` is a separate container from `demo_api_server` (the BFF) — they do not share memory or LMDB. The only proven live-update path from BFF to gateway without a restart is `POST /admin/config` (`demo_mcp_gateway/src/adminConfig.ts`, `ADMIN_CONFIG_ALLOWED_KEYS`).
- Working directory for all tasks: this git worktree (`.claude/worktrees/agent-gateway-capability-showcase`), branch `worktree-agent-gateway-capability-showcase`. Never edit the main checkout.

---

## Task 1: Capability Ledger config

**Files:**
- Create: `demo_api_ui/src/config/agentGatewayCapabilities.js`
- Test: `demo_api_ui/src/config/agentGatewayCapabilities.test.js`

**Interfaces:**
- Produces: `AGENT_GATEWAY_CAPABILITIES` (array of 7 objects, shape below), `CAPABILITY_GROUPS` (array of 3 `{id, label}` objects in display order), `allRelatedUCIds()` (function, returns deduped flat array of every `relatedUCIds` entry across all 7 capabilities — used by Task 11).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/agentGatewayCapabilities.test.js
import { AGENT_GATEWAY_CAPABILITIES, CAPABILITY_GROUPS, allRelatedUCIds } from './agentGatewayCapabilities';

describe('agentGatewayCapabilities', () => {
  it('has exactly 7 capabilities', () => {
    expect(AGENT_GATEWAY_CAPABILITIES).toHaveLength(7);
  });

  it('every capability has a unique id and belongs to a known group', () => {
    const groupIds = CAPABILITY_GROUPS.map((g) => g.id);
    const ids = new Set();
    for (const cap of AGENT_GATEWAY_CAPABILITIES) {
      expect(ids.has(cap.id)).toBe(false);
      ids.add(cap.id);
      expect(groupIds).toContain(cap.group);
      expect(['pinggateway', 'node', 'node-only']).toContain(cap.enforcedByDefault);
      expect(cap.evidence.node).toEqual(expect.any(String));
    }
  });

  it('groups split 2/2/3 across validate-audit, throttle-transform, oauth-policy-metadata', () => {
    const counts = CAPABILITY_GROUPS.map(
      (g) => AGENT_GATEWAY_CAPABILITIES.filter((c) => c.group === g.id).length
    );
    expect(counts).toEqual([2, 2, 3]);
  });

  it('RAR is the one node-only capability, with no pingGateway evidence', () => {
    const rar = AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === 'metadata-controls');
    expect(rar.enforcedByDefault).toBe('node-only');
    expect(rar.evidence.pingGateway).toBeNull();
  });

  it('allRelatedUCIds returns a deduped union of every relatedUCIds', () => {
    const ids = allRelatedUCIds();
    expect(ids).toEqual(expect.arrayContaining(['UC1', 'UC18', 'UC29', 'UC14b']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/config/agentGatewayCapabilities.test.js`
Expected: FAIL with "Cannot find module './agentGatewayCapabilities'"

- [ ] **Step 3: Write the ledger**

```js
// demo_api_ui/src/config/agentGatewayCapabilities.js
/**
 * Single source of truth for the Agent Gateway capability showcase: the
 * standalone tour page, the existing-panel callouts, and the /use-cases
 * "Agent Gateway" group all read from here.
 */

export const CAPABILITY_GROUPS = [
  { id: 'validate-audit', label: 'Validate & audit MCP requests' },
  { id: 'throttle-transform', label: 'Throttle requests & transform tokens' },
  { id: 'oauth-policy-metadata', label: 'Enforce OAuth, policy & metadata controls' },
];

export const AGENT_GATEWAY_CAPABILITIES = [
  {
    id: 'mcp-validation',
    group: 'validate-audit',
    title: 'Validate MCP requests',
    oneLiner: 'Method allowlist plus per-tool Ajv schema validation — fail closed on an unknown tool or malformed call.',
    evidence: {
      node: 'demo_mcp_gateway/src/validation/mcpRequestValidation.ts:15-69',
      pingGateway: 'ping-gateway/scripts/groovy/mcp-request-validation.groovy:1-30',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC1', 'UC5', 'UC11'],
  },
  {
    id: 'audit-logging',
    group: 'validate-audit',
    title: 'Audit every MCP call',
    oneLiner: 'Every tool-call outcome is shipped to durable storage with the acting agent, subject, and decision.',
    evidence: {
      node: 'demo_mcp_gateway/src/gatewayAudit.ts:41-118',
      pingGateway: 'demo_api_server/services/unifiedTrace.js:128-141',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC20'],
  },
  {
    id: 'rate-limiting',
    group: 'throttle-transform',
    title: 'Throttle requests',
    oneLiner: 'Sliding-window per-agent, per-tool rate limit — a burst past quota gets 429 with Retry-After.',
    evidence: {
      node: 'demo_mcp_gateway/src/rateLimit.ts:38-97',
      pingGateway: 'ping-gateway/scripts/groovy/uc18-rate-limit.groovy:1-20',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC18', 'UC29'],
  },
  {
    id: 'token-transformation',
    group: 'throttle-transform',
    title: 'Transform tokens',
    oneLiner: 'RFC 8693 token exchange rewrites the inbound gateway-audience token to the backend resource audience.',
    evidence: {
      node: 'demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts:1-24',
      pingGateway: 'ping-gateway/scripts/groovy/olb-token-exchange.groovy:1-20',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC1'],
  },
  {
    id: 'oauth-enforcement',
    group: 'oauth-policy-metadata',
    title: 'Enforce OAuth',
    oneLiner: 'RFC 7662 introspection confirms the token is active before anything else runs — fails closed on outage.',
    evidence: {
      node: 'demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts:110-187',
      pingGateway: 'ping-gateway/config/routes/01-mcp-olb.json:33,41',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC1', 'UC29'],
  },
  {
    id: 'policy-enforcement',
    group: 'oauth-policy-metadata',
    title: 'Enforce policy',
    oneLiner: 'Every call is evaluated against PingOne Authorize (P1AZ) — PERMIT, DENY, or INDETERMINATE, failing closed if the PDP is unreachable.',
    evidence: {
      node: 'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:1-36',
      pingGateway: 'ping-gateway/scripts/groovy/p1az-decision.groovy:1-19',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC6', 'UC10'],
  },
  {
    id: 'metadata-controls',
    group: 'oauth-policy-metadata',
    title: 'Enforce metadata controls (RAR)',
    oneLiner: 'RFC 9396 rich-authorization-request subset check — the actual tool-call params must be covered by what was granted.',
    evidence: {
      node: 'demo_mcp_gateway/src/rarEnforce.ts:1-41',
      pingGateway: null,
    },
    enforcedByDefault: 'node-only',
    fallbackNote: 'No Groovy equivalent exists yet — this one runs on the Node path only, live or not.',
    relatedUCIds: ['UC14b'],
  },
];

export function allRelatedUCIds() {
  const seen = new Set();
  for (const cap of AGENT_GATEWAY_CAPABILITIES) {
    for (const id of cap.relatedUCIds) seen.add(id);
  }
  return Array.from(seen);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/config/agentGatewayCapabilities.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/agentGatewayCapabilities.js demo_api_ui/src/config/agentGatewayCapabilities.test.js
git commit -m "feat(agent-gateway): add capability ledger config"
```

---

## Task 2: CapabilityCallout component

**Files:**
- Create: `demo_api_ui/src/components/CapabilityCallout.jsx`
- Create: `demo_api_ui/src/components/CapabilityCallout.css`
- Test: `demo_api_ui/src/components/CapabilityCallout.test.jsx`

**Interfaces:**
- Consumes: `AGENT_GATEWAY_CAPABILITIES` from `../config/agentGatewayCapabilities` (Task 1).
- Produces: `<CapabilityCallout capabilityId="rate-limiting" />` — default export, degrades to `null` render for an unknown id.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/CapabilityCallout.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CapabilityCallout from './CapabilityCallout';

describe('CapabilityCallout', () => {
  it('renders the capability title and a link to the tour for a known id', () => {
    render(<CapabilityCallout capabilityId="rate-limiting" />);
    expect(screen.getByText(/Throttle requests/)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/agent-gateway-capabilities#rate-limiting');
  });

  it('renders nothing for an unknown capability id', () => {
    const { container } = render(<CapabilityCallout capabilityId="does-not-exist" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/CapabilityCallout.test.jsx`
Expected: FAIL with "Cannot find module './CapabilityCallout'"

- [ ] **Step 3: Write the component**

```jsx
// demo_api_ui/src/components/CapabilityCallout.jsx
import React from 'react';
import { AGENT_GATEWAY_CAPABILITIES } from '../config/agentGatewayCapabilities';
import './CapabilityCallout.css';

export default function CapabilityCallout({ capabilityId }) {
  const capability = AGENT_GATEWAY_CAPABILITIES.find((c) => c.id === capabilityId);
  if (!capability) return null;

  return (
    <a
      className="capability-callout"
      href={`/agent-gateway-capabilities#${capability.id}`}
    >
      <span className="capability-callout__label">Agent Gateway capability:</span>{' '}
      <span className="capability-callout__title">{capability.title}</span>
      <span className="capability-callout__arrow"> →</span>
    </a>
  );
}
```

```css
/* demo_api_ui/src/components/CapabilityCallout.css */
.capability-callout {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #c7d2fe;
  background: #eef2ff;
  color: #3730a3;
  text-decoration: none;
  margin-bottom: 12px;
}

.capability-callout:hover {
  background: #e0e7ff;
}

.capability-callout__label {
  opacity: 0.75;
}

.capability-callout__title {
  font-weight: 600;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/CapabilityCallout.test.jsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/CapabilityCallout.jsx demo_api_ui/src/components/CapabilityCallout.css demo_api_ui/src/components/CapabilityCallout.test.jsx
git commit -m "feat(agent-gateway): add CapabilityCallout component"
```

---

## Task 3: Gateway 429 audit-visibility fix

**Problem:** In `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, the rate-limit check (lines 182-218) returns early — via the raw `res.end()` — before the audit-hook wrapper is installed (lines 220-272). A rate-limited call today produces no `X-Gw-Audit-Trail` header and no POST to `/internal/mcp-audit`, so `AgentGatewayLogPanel`'s "Decisions" table never shows it.

**Files:**
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts:203-215` (the rate-limit-exceeded branch)
- Test: `demo_mcp_gateway/tests/authorizeMcpRequest-rateLimit.test.ts` (existing file — add a new test)

**Interfaces:**
- Consumes: `recordGatewayAudit(event: GatewayAuditEvent, config: GatewayConfig): void` from `../gatewayAudit` (already imported in this file at line 50).

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('UC18 rate-limiting in buildAuthorizeMcpRequest', ...)` block in `demo_mcp_gateway/tests/authorizeMcpRequest-rateLimit.test.ts`:

```ts
  it('rate-limit ON: a 429 sets X-Gw-Audit-Trail so it is visible in the shared audit panel', async () => {
    const config = makeConfig({ rateLimitEnabled: true, rateLimitMaxRequests: 1, rateLimitWindowMs: 10000 });
    await callMiddleware(config, TOOL_CALL_BODY); // consume the one allowed slot
    const { fakeRes } = await callMiddleware(config, TOOL_CALL_BODY); // this one is rate-limited
    expect(fakeRes.statusCode).toBe(429);
    expect(fakeRes.setHeader).toHaveBeenCalledWith('X-Gw-Audit-Trail', expect.any(String));
    const auditTrailArg = fakeRes.setHeader.mock.calls.find((c: any[]) => c[0] === 'X-Gw-Audit-Trail')[1];
    const auditTrail = JSON.parse(auditTrailArg);
    expect(auditTrail.rateLimit).toEqual({ limited: true, retryAfterMs: expect.any(Number) });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-rateLimit.test.ts -t "X-Gw-Audit-Trail"`
Expected: FAIL — `fakeRes.setHeader` was not called (the rate-limit branch returns before any header is set).

- [ ] **Step 3: Implement the fix**

In `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`, replace the rate-limit-exceeded branch (current lines 203-215):

```ts
        if (!_rlResult.allowed) {
          teachLog.warn(`[GW] UC18 rate_limited key=${_rlKey} retryAfterMs=${_rlResult.retryAfterMs}`);
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(_rlResult.retryAfterMs / 1000)),
          });
          res.end(JSON.stringify({
            error: 'rate_limited',
            code: 'rate_limited',
            message: 'Tool call rate limit exceeded. Retry after the indicated interval.',
            retryAfterMs: _rlResult.retryAfterMs,
          }));
          return;
        }
```

with:

```ts
        if (!_rlResult.allowed) {
          teachLog.warn(`[GW] UC18 rate_limited key=${_rlKey} retryAfterMs=${_rlResult.retryAfterMs}`);
          // Minimal, self-contained audit record — the durable audit-hook wrapper
          // below hasn't been installed yet at this point in the pipeline, so a
          // 429 here would otherwise leave no trace in X-Gw-Audit-Trail or
          // /internal/mcp-audit (confirmed by reading the pipeline in full).
          try {
            res.setHeader('X-Gw-Audit-Trail', JSON.stringify({
              introspection: null,
              policy: null,
              authorize: null,
              mtls: null,
              rateLimit: { limited: true, retryAfterMs: _rlResult.retryAfterMs },
            }));
          } catch {
            // headers already sent — ignore
          }
          recordGatewayAudit(
            {
              operation: _rlTool,
              outcome: 'failure',
              userId: _rlSub,
              agentId: _rlSub,
              vertical: routeTool(_rlTool),
              duration: 0,
              details: { httpStatus: 429, rate_limited: true, retryAfterMs: _rlResult.retryAfterMs },
            },
            config,
          );
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil(_rlResult.retryAfterMs / 1000)),
          });
          res.end(JSON.stringify({
            error: 'rate_limited',
            code: 'rate_limited',
            message: 'Tool call rate limit exceeded. Retry after the indicated interval.',
            retryAfterMs: _rlResult.retryAfterMs,
          }));
          return;
        }
```

`recordGatewayAudit` and `routeTool` are already imported at the top of this file (lines 42, 50) — no new imports needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-rateLimit.test.ts`
Expected: PASS (all 7 tests in the file, including the new one)

- [ ] **Step 5: Run the full gateway test suite to check for regressions**

Run: `cd demo_mcp_gateway && npm test`
Expected: PASS — no other suite asserts on the rate-limit branch's exact `res.end` call count or timing.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/tests/authorizeMcpRequest-rateLimit.test.ts
git commit -m "fix(gateway): record audit trail for rate-limited (429) requests"
```

---

## Task 4: Surface UC18 in the walkthrough

**Files:**
- Modify: `demo_api_ui/src/config/demoUseCaseSteps.js:19-28`
- Test: `demo_api_ui/src/config/demoUseCaseSteps.test.js` (new — this file currently has none)

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/demoUseCaseSteps.test.js
import { DEMO_ADVANCED_USE_CASE_IDS } from './demoUseCaseSteps';

describe('demoUseCaseSteps', () => {
  it('includes UC18 (rate-limit / throttle burst) in the advanced walkthrough', () => {
    expect(DEMO_ADVANCED_USE_CASE_IDS).toContain('UC18');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/config/demoUseCaseSteps.test.js`
Expected: FAIL — `DEMO_ADVANCED_USE_CASE_IDS` does not contain `'UC18'`

- [ ] **Step 3: Add UC18 to the advanced list**

In `demo_api_ui/src/config/demoUseCaseSteps.js`, current lines 19-28:

```js
export const DEMO_ADVANCED_USE_CASE_IDS = [
  'UC2',   // A2A delegation
  'UC2.5', // A2A orchestrator learning
  'UC22',  // CIBA out-of-band
  'UC5',   // Insufficient scope
  'UC10',  // Cross-owner
  'UC13',  // Confused deputy
  'UC11',  // Bad client gateway
  'UC20',  // Audit trail
];
```

replace with:

```js
export const DEMO_ADVANCED_USE_CASE_IDS = [
  'UC2',   // A2A delegation
  'UC2.5', // A2A orchestrator learning
  'UC22',  // CIBA out-of-band
  'UC5',   // Insufficient scope
  'UC10',  // Cross-owner
  'UC13',  // Confused deputy
  'UC11',  // Bad client gateway
  'UC20',  // Audit trail
  'UC18',  // Rate-limit / throttle burst
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/config/demoUseCaseSteps.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/demoUseCaseSteps.js demo_api_ui/src/config/demoUseCaseSteps.test.js
git commit -m "feat(agent-gateway): surface UC18 rate-limit demo in the advanced walkthrough"
```

---

## Task 5: Introspection-down sim — gateway plumbing

**Files:**
- Modify: `demo_mcp_gateway/src/config.ts` (interface at line 118 area, `loadConfig()` at line 301 area)
- Modify: `demo_mcp_gateway/src/adminConfig.ts` (`ADMIN_CONFIG_ALLOWED_KEYS`, `applyAdminConfigUpdate`, `safeView`)
- Modify: `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts:110-116` (top of `introspect()`)
- Test: `demo_mcp_gateway/tests/adminConfig-introspectionSim.test.ts` (new)
- Test: `demo_mcp_gateway/tests/GatewayIntrospectionClient.test.ts` (existing — check for a file at this path first; if absent, create it following the pattern below)

**Interfaces:**
- Produces: `GatewayConfig.introspectionSimDown: boolean` (readable/writable field), admin-pushable via `POST /admin/config { introspectionSimDown: true }`.

- [ ] **Step 1: Write the failing test for adminConfig**

```ts
// demo_mcp_gateway/tests/adminConfig-introspectionSim.test.ts
'use strict';
import { applyAdminConfigUpdate, ADMIN_CONFIG_ALLOWED_KEYS, adminConfigSafeView } from '../src/adminConfig';
import type { GatewayConfig } from '../src/config';

const baseConfig = { introspectionSimDown: false } as unknown as GatewayConfig;

describe('introspectionSimDown admin config', () => {
  it('is in the allowed-keys list', () => {
    expect(ADMIN_CONFIG_ALLOWED_KEYS).toContain('introspectionSimDown');
  });

  it('rejects a non-boolean value', () => {
    const result = applyAdminConfigUpdate({ ...baseConfig }, { introspectionSimDown: 'yes' }, 'test');
    expect(result.status).toBe(400);
    expect(result.mutated).toBe(false);
  });

  it('sets the flag true in place on config', () => {
    const config = { ...baseConfig };
    const result = applyAdminConfigUpdate(config, { introspectionSimDown: true }, 'test');
    expect(result.status).toBe(200);
    expect((config as any).introspectionSimDown).toBe(true);
  });

  it('is visible in the safe view for GET /admin/config', () => {
    const view = adminConfigSafeView({ ...baseConfig, introspectionSimDown: true } as GatewayConfig);
    expect(view.introspectionSimDown).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest tests/adminConfig-introspectionSim.test.ts`
Expected: FAIL — `ADMIN_CONFIG_ALLOWED_KEYS` does not contain `'introspectionSimDown'`; `applyAdminConfigUpdate` silently ignores the unknown key so `mutated` stays `false` and the boolean-rejection test also fails since the key is never validated.

- [ ] **Step 3: Add the field to `GatewayConfig` and `loadConfig()`**

In `demo_mcp_gateway/src/config.ts`, near the existing `rateLimitEnabled: boolean;` field in the `GatewayConfig` interface (line 118 area), add:

```ts
  introspectionSimDown: boolean;
```

Near the existing `rateLimitEnabled: process.env.GATEWAY_RATE_LIMIT_ENABLED === 'true',` line in `loadConfig()` (line 301 area), add:

```ts
    introspectionSimDown: process.env.GATEWAY_SIM_INTROSPECTION_DOWN === 'true',
```

- [ ] **Step 4: Wire it into `adminConfig.ts`**

In `demo_mcp_gateway/src/adminConfig.ts`, add `'introspectionSimDown'` to `ADMIN_CONFIG_ALLOWED_KEYS`:

```ts
export const ADMIN_CONFIG_ALLOWED_KEYS: Array<keyof GatewayConfig> = [
  'gatewayResourceUri',
  'mcpOlbWsUrl', 'mcpResourceServerWsUrl',
  'mcpOlbResourceUri', 'mcpResourceServerResourceUri',
  'pingAuthorizeEndpoint', 'pingAuthorizeWorkerId',
  'p1azEnabled',
  'hitlServiceUrl',
  'devBypass',
  'requireActForAgentTools',
  'intentTokenRequired',
  'requireRarIntent',
  'rateLimitEnabled',
  'rateLimitMaxRequests',
  'rateLimitWindowMs',
  'introspectionSimDown',
];
```

Add it to the existing boolean-validation list (mirrors `rateLimitEnabled`'s own validation block) — in `applyAdminConfigUpdate`, extend the `boolKeys` tuple:

```ts
  const boolKeys = ['requireActForAgentTools', 'intentTokenRequired', 'requireRarIntent', 'introspectionSimDown'] as const;
```

and in the assignment loop, extend the boolean-coercion branch condition:

```ts
      } else if (key === 'requireActForAgentTools' || key === 'intentTokenRequired' || key === 'requireRarIntent' || key === 'introspectionSimDown') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any)[key] = updates[key] === true;
```

Add it to `safeView()`'s returned object:

```ts
    introspectionSimDown:  config.introspectionSimDown,
```

- [ ] **Step 5: Run adminConfig test to verify it passes**

Run: `cd demo_mcp_gateway && npx jest tests/adminConfig-introspectionSim.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Write the failing test for GatewayIntrospectionClient**

```ts
// demo_mcp_gateway/tests/GatewayIntrospectionClient.test.ts
'use strict';
import { GatewayIntrospectionClient } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

describe('GatewayIntrospectionClient — introspectionSimDown', () => {
  it('fails closed immediately, without a network call, when introspectionSimDown is true', async () => {
    const config = {
      introspectionEndpoint: 'https://unused.example.com/introspect',
      introspectionSimDown: true,
      tokenEndpointAuthMethod: 'basic',
      clientId: 'x', clientSecret: 'y',
    } as unknown as GatewayConfig;
    const client = new GatewayIntrospectionClient(config);
    const result = await client.introspect('any-token');
    expect(result.active).toBe(false);
    expect(result.error).toMatch(/simulated/i);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest tests/GatewayIntrospectionClient.test.ts`
Expected: FAIL — `result.error` is `undefined` (the client makes a real (failing) network call instead of short-circuiting).

- [ ] **Step 8: Implement the check in `introspect()`**

In `demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts`, current lines 110-116:

```ts
  async introspect(token: string): Promise<IntrospectionResult> {
    // Introspection endpoint is required — if not configured, fail closed
    if (!this.config.introspectionEndpoint) {
      const msg = 'GW_INTROSPECTION_ENDPOINT not configured (required for token validation)';
      console.warn(`[GatewayIntrospection] ${msg}`);
      return { active: false, error: msg };
    }
```

replace with:

```ts
  async introspect(token: string): Promise<IntrospectionResult> {
    // Demo-only sim hook: an admin-armed flag (POST /admin/config
    // {introspectionSimDown:true}) forces the same fail-closed shape as a
    // real introspection-endpoint outage, without touching real enforcement.
    // Must be disarmed immediately by the caller — this has no TTL.
    if (this.config.introspectionSimDown) {
      const msg = 'Simulated introspection outage (demo arm)';
      console.warn(`[GatewayIntrospection] ${msg}`);
      return { active: false, error: msg };
    }

    // Introspection endpoint is required — if not configured, fail closed
    if (!this.config.introspectionEndpoint) {
      const msg = 'GW_INTROSPECTION_ENDPOINT not configured (required for token validation)';
      console.warn(`[GatewayIntrospection] ${msg}`);
      return { active: false, error: msg };
    }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd demo_mcp_gateway && npx jest tests/GatewayIntrospectionClient.test.ts`
Expected: PASS

- [ ] **Step 10: Run the full gateway test suite to check for regressions**

Run: `cd demo_mcp_gateway && npm test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add demo_mcp_gateway/src/config.ts demo_mcp_gateway/src/adminConfig.ts demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts demo_mcp_gateway/tests/adminConfig-introspectionSim.test.ts demo_mcp_gateway/tests/GatewayIntrospectionClient.test.ts
git commit -m "feat(gateway): add admin-armable introspection-down sim flag"
```

---

## Task 6: Introspection-down sim — BFF orchestration + UC29 catalog entry

**Files:**
- Modify: `demo_api_server/services/attackSimulatorService.js` (add `_runIntrospectionDown`, register in dispatch + `SIM_USE_CASE_IDS`)
- Modify: `demo_api_server/routes/attackSimulator.js:19` (`VALID_SIMS`)
- Modify: `demo_api_server/config/useCases.js` (new UC29 entry)
- Modify: `demo_api_ui/src/config/demoUseCaseSteps.js` (add `'UC29'` to `DEMO_ADVANCED_USE_CASE_IDS`)
- Test: `demo_api_server/src/__tests__/attackSimulator.test.js` (existing file — add to the `test.each(Object.entries(A62_SIM_USE_CASE_IDS))` table)

**Interfaces:**
- Consumes: `pushGatewayAdminConfig(gatewayUrl, updates)` from `../routes/mcpGatewayConfig` (existing, used identically by `_runRateLimitBurst`), `getMcpGatewayHttpUrl()`, `callToolViaGateway`, `buildTokenEvent`, `_exchangeSimToken`, `_parseGatewayError`, `stampUseCaseId` — all already imported/defined in `attackSimulatorService.js` and used by `_runRateLimitBurst` (the direct model for this task). `runAttackSim(sim, req)` — the existing top-level dispatcher, already exported from `attackSimulatorService.js` and imported at the top of the test file (`const { runAttackSim } = require('../../services/attackSimulatorService');`).

**Note:** `routes/attackSimulator.js`'s `VALID_SIMS` array is a route-level pre-check, not exported, and not unit-tested per-entry today (confirmed: `module.exports = router` only). The `test.each` table in the existing test file instead exercises `runAttackSim` directly — no HTTP, no live gateway/token needed, since `useCaseId` is set from `SIM_USE_CASE_IDS` before any network call happens, so it's populated on every return path including failure. Follow that same layer for this task's test.

- [ ] **Step 1: Write the failing test**

Add `'introspection-down': 'oauth-fail-closed'` to the existing `A62_SIM_USE_CASE_IDS` table in `demo_api_server/src/__tests__/attackSimulator.test.js` (lines 63-71):

```js
  const A62_SIM_USE_CASE_IDS = {
    'cross-owner-account': 'cross-owner-account',
    'replayed-token': 'token-theft-replay',
    'rogue-actor': 'confused-deputy-actor-injection',
    'rar-exceeded': 'rar-intent-violation',
    'tampered-intent-token': 'intent-token-tampering',
    'impersonation-no-act': 'impersonation-blocked',
    'rate-limit-burst': 'rate-limit-defense',
    'introspection-down': 'oauth-fail-closed',
  };
```

This single addition drives the existing `test.each` block (lines 73-81) to run one more case automatically — no new test code needed beyond the table entry.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/attackSimulator.test.js -t "introspection-down"`
Expected: FAIL — `runAttackSim('introspection-down', ...)` falls through to the "Should not be reached" branch and returns `errorCode: 'unknown_sim'`, so `result.sim` is `'introspection-down'` as expected but `result.useCaseId` is `null`, not `'oauth-fail-closed'`.

- [ ] **Step 3: Register the sim id in the route guard**

In `demo_api_server/routes/attackSimulator.js`, add `'introspection-down'` to the `VALID_SIMS` array (line 19 area) alongside the existing entries. This is the HTTP-layer pre-check (`POST /api/demo/attack-sim/run`); it doesn't affect the Step 2 test, which calls `runAttackSim` directly, but without this the sim would 400 before ever reaching the service when triggered for real from the UI.

- [ ] **Step 4: Add the sim function to `attackSimulatorService.js`**

Add `'introspection-down': 'oauth-fail-closed'` to `SIM_USE_CASE_IDS` (line ~51-60):

```js
const SIM_USE_CASE_IDS = {
  'insufficient-scope': 'insufficient-scope',
  'wrong-aud': 'bad-client-gateway',
  'cross-owner-account': 'cross-owner-account',
  'replayed-token': 'token-theft-replay',
  'rogue-actor': 'confused-deputy-actor-injection',
  'rar-exceeded': 'rar-intent-violation',
  'tampered-intent-token': 'intent-token-tampering',
  'impersonation-no-act': 'impersonation-blocked',
  'rate-limit-burst': 'rate-limit-defense',
  'introspection-down': 'oauth-fail-closed',
};
```

Add a dispatch branch next to the existing `if (sim === 'rate-limit-burst') { ... }` line (~line 516):

```js
  if (sim === 'introspection-down') {
    return _runIntrospectionDown(subjectToken, useCaseId, tokenChainEvents);
  }
```

Add the sim function itself, modeled directly on `_runRateLimitBurst` (arm → one call → capture → **disarm**, the auto-disarm being the one real difference — leaving this armed blocks every subsequent call on the container, unlike rate-limiting):

```js
/**
 * introspection-down sim (UC29):
 *   Arm GatewayIntrospectionClient into a simulated-down state via the
 *   existing live POST /admin/config push (same mechanism UC18 uses for
 *   rateLimitEnabled), fire one real call, capture the fail-closed 503,
 *   then immediately disarm — unlike rate-limiting, leaving this armed
 *   would block every subsequent call on the gateway container.
 */
async function _runIntrospectionDown(subjectToken, useCaseId, tokenChainEvents) {
  const sim = 'introspection-down';
  const gatewayAud = _gatewayAud();

  if (!gatewayAud) {
    return {
      sim, useCaseId,
      status: 503,
      errorCode: 'gateway_not_configured',
      reason: 'pingone_resource_mcp_gateway_uri is not configured',
      tokenChainEvents,
    };
  }

  let gatewayUrl;
  try {
    gatewayUrl = getMcpGatewayHttpUrl();
  } catch (err) {
    return {
      sim, useCaseId,
      status: 503,
      errorCode: 'gateway_not_configured',
      reason: err.message,
      tokenChainEvents,
    };
  }

  const { pushGatewayAdminConfig } = require('../routes/mcpGatewayConfig');
  const armResult = await pushGatewayAdminConfig(gatewayUrl, { introspectionSimDown: true });
  if (!armResult.ok) {
    return {
      sim, useCaseId,
      status: 502,
      errorCode: 'gateway_push_failed',
      reason: armResult.error || 'Could not arm the introspection-down sim on the gateway',
      tokenChainEvents,
    };
  }

  tokenChainEvents.push(buildTokenEvent(
    'sim-introspection-armed',
    'Introspection outage armed (UC29)',
    'active',
    null,
    'Pushed introspectionSimDown:true to the gateway — the next call fails RFC 7662 introspection closed.',
  ));

  let exchangedToken;
  let result;
  try {
    exchangedToken = await _exchangeSimToken(subjectToken, gatewayAud, ['read']);
    await callToolViaGateway(null, exchangedToken, 'get_my_accounts', {});
    // No throw means the gateway did NOT fail closed as expected.
    result = {
      sim, useCaseId,
      status: 200,
      errorCode: 'unexpected_permit',
      reason: 'Call succeeded despite the armed introspection-down sim — sim may not have taken effect.',
      tokenChainEvents,
    };
  } catch (err) {
    const { errorCode, httpStatus, reason } = _parseGatewayError(err, 503);
    tokenChainEvents.push(buildTokenEvent(
      'sim-introspection-failclosed',
      'Call FAILED CLOSED (503)',
      'error',
      null,
      reason,
      { error: errorCode, httpStatus },
    ));
    result = { sim, useCaseId, status: httpStatus, errorCode, reason, tokenChainEvents };
  } finally {
    // Always disarm, even if the call above threw for an unrelated reason —
    // an armed sim left on would silently break every later demo step.
    await pushGatewayAdminConfig(gatewayUrl, { introspectionSimDown: false });
  }

  stampUseCaseId(tokenChainEvents, useCaseId);
  return result;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/attackSimulator.test.js -t "introspection-down"`
Expected: PASS

- [ ] **Step 7: Add the UC29 catalog entry**

In `demo_api_server/config/useCases.js`, add a new entry (model: UC18, immediately preceding or following it in the file for locality):

```js
  {
    id: 'UC29',
    useCaseId: 'oauth-fail-closed',
    track: 'attacks',
    title: 'OAuth introspection outage — fail closed',
    buyerStory: "If the token-validation backend itself goes down, the gateway must reject every call — not silently let traffic through.",
    pingOneSolution: 'RFC 7662 introspection is on the request path for every call; when it cannot be reached, the gateway fails closed rather than open.',
    trigger: { type: 'attack', sim: 'introspection-down' },
    expectedOutcome: 'DENY_503',
    evidence: { tokenChain: ['user-token'], activity: ['gateway'] },
    codeRefs: ['demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts', 'demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts'],
    maturity: 'works',
    owasp: { threats: ['T2'], sections: ['§3.2.1', '§8'] },
    whatToSay: 'Kill the introspection path and the gateway stops every call cold — it never fails open.',
    advanced: false,
    whatLong: 'The gateway validates every inbound token against the authorization server via RFC 7662 introspection before anything else runs. This scenario simulates that introspection endpoint going unreachable and shows the gateway reject the call with a fail-closed 503, rather than letting it through.',
    businessValue: 'Many systems degrade to "allow" when their auth backend is unreachable. This gateway is built to fail closed instead — an outage in token validation becomes a blocked request, not an open door.',
    productRoles: {
      gw: 'Introspects every token before evaluating policy; on introspection failure, rejects the call rather than forwarding it.',
    },
    primaryTool: null,
  },
```

- [ ] **Step 8: Add UC29 to the walkthrough**

In `demo_api_ui/src/config/demoUseCaseSteps.js`, add `'UC29',  // OAuth fail-closed` as the last entry in `DEMO_ADVANCED_USE_CASE_IDS` (after the `'UC18'` line added in Task 4).

- [ ] **Step 9: Run the full attack-simulator + useCases test suites to check for regressions**

Run: `cd demo_api_server && npx jest attackSimulator useCases`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add demo_api_server/routes/attackSimulator.js demo_api_server/services/attackSimulatorService.js demo_api_server/config/useCases.js demo_api_ui/src/config/demoUseCaseSteps.js demo_api_server/src/__tests__/attackSimulator.test.js
git commit -m "feat(agent-gateway): add UC29 OAuth-fail-closed demo (introspection-down sim)"
```

---

## Task 7: Standalone tour page

**Files:**
- Create: `demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.jsx`
- Create: `demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.css`
- Test: `demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.test.jsx`

**Interfaces:**
- Consumes: `AGENT_GATEWAY_CAPABILITIES`, `CAPABILITY_GROUPS` from `../config/agentGatewayCapabilities` (Task 1); `DEMO_USE_CASE_IDS` is NOT required — the tour reads `useCases.js`-shaped data via a prop or a lightweight fetch, but for this task the "Try it" link is a plain anchor to `/use-cases#<ucId>`, not a live fetch (keeps this component free of network/loading-state complexity; `/use-cases` already renders and scrolls to a given UC card via its existing id-based DOM).
- Produces: default export `AgentGatewayCapabilitiesTour` (no props).

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentGatewayCapabilitiesTour from './AgentGatewayCapabilitiesTour';

describe('AgentGatewayCapabilitiesTour', () => {
  it('renders 3 group headings and 7 capability cards total', () => {
    render(<AgentGatewayCapabilitiesTour />);
    expect(screen.getByText('Validate & audit MCP requests')).toBeInTheDocument();
    expect(screen.getByText('Throttle requests & transform tokens')).toBeInTheDocument();
    expect(screen.getByText('Enforce OAuth, policy & metadata controls')).toBeInTheDocument();
    expect(screen.getAllByTestId('capability-card')).toHaveLength(7);
  });

  it('shows the node-only fallback note for RAR and no PingGateway evidence citation', () => {
    render(<AgentGatewayCapabilitiesTour />);
    const rarCard = screen.getByTestId('capability-card-metadata-controls');
    expect(rarCard).toHaveTextContent(/No Groovy equivalent exists yet/);
  });

  it('omits the "Try it" link when a capability has no relatedUCIds match (defensive — none currently, guards drift)', () => {
    render(<AgentGatewayCapabilitiesTour />);
    // every capability currently has at least one relatedUCIds entry, so every
    // card should show a Try it link today
    expect(screen.getAllByText(/Try it/)).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/AgentGatewayCapabilitiesTour.test.jsx`
Expected: FAIL with "Cannot find module './AgentGatewayCapabilitiesTour'"

- [ ] **Step 3: Write the page**

```jsx
// demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.jsx
import React from 'react';
import { AGENT_GATEWAY_CAPABILITIES, CAPABILITY_GROUPS } from '../config/agentGatewayCapabilities';
import './AgentGatewayCapabilitiesTour.css';

function EnforcedByPill({ capability }) {
  if (capability.enforcedByDefault === 'node-only') {
    return <span className="agct-pill agct-pill--node-only">Node only</span>;
  }
  return (
    <span className="agct-pill agct-pill--pinggateway">
      Enforced by PingGateway (default)
      <span className="agct-pill__fallback"> · Node (fallback)</span>
    </span>
  );
}

function CapabilityCard({ capability }) {
  const tryHref = capability.relatedUCIds[0] ? `/use-cases#${capability.relatedUCIds[0]}` : null;
  return (
    <article
      id={capability.id}
      className="agct-card"
      data-testid="capability-card"
      data-testid-id={`capability-card-${capability.id}`}
    >
      <h3 className="agct-card__title">{capability.title}</h3>
      <p className="agct-card__oneliner">{capability.oneLiner}</p>
      <EnforcedByPill capability={capability} />
      <p className="agct-card__fallback-note">{capability.fallbackNote}</p>
      <dl className="agct-card__evidence">
        <dt>Node</dt>
        <dd><code>{capability.evidence.node}</code></dd>
        {capability.evidence.pingGateway ? (
          <>
            <dt>PingGateway</dt>
            <dd><code>{capability.evidence.pingGateway}</code></dd>
          </>
        ) : null}
      </dl>
      {tryHref ? (
        <a className="agct-card__try" href={tryHref}>Try it →</a>
      ) : null}
    </article>
  );
}

export default function AgentGatewayCapabilitiesTour() {
  return (
    <div className="agct-page">
      <h1>Agent Gateway — Capability Tour</h1>
      <p className="agct-intro">
        Every capability below is evidence-cited against the current code, not
        asserted. &quot;Enforced by&quot; reflects the live PingGateway-default
        routing — Node is the offline/dev fallback.
      </p>
      {CAPABILITY_GROUPS.map((group) => (
        <section key={group.id} className="agct-group">
          <h2>{group.label}</h2>
          <div className="agct-group__grid">
            {AGENT_GATEWAY_CAPABILITIES
              .filter((c) => c.group === group.id)
              .map((c) => <CapabilityCard key={c.id} capability={c} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Fix the test's `getByTestId('capability-card-metadata-controls')` selector to actually work — `data-testid` does not support a dynamic second attribute the way written above. Correct the component to use a single templated `data-testid`:

```jsx
    <article id={capability.id} className="agct-card" data-testid={`capability-card-${capability.id}`}>
```

and correct the test's "7 cards total" assertion to a different query since `data-testid` values are now unique per card rather than shared:

```jsx
  it('renders 3 group headings and 7 capability cards total', () => {
    render(<AgentGatewayCapabilitiesTour />);
    expect(screen.getByText('Validate & audit MCP requests')).toBeInTheDocument();
    expect(screen.getByText('Throttle requests & transform tokens')).toBeInTheDocument();
    expect(screen.getByText('Enforce OAuth, policy & metadata controls')).toBeInTheDocument();
    expect(document.querySelectorAll('.agct-card')).toHaveLength(7);
  });
```

```css
/* demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.css */
.agct-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.agct-intro {
  color: #4b5563;
  max-width: 68ch;
}

.agct-group {
  margin-top: 32px;
}

.agct-group__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.agct-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
}

.agct-card__title {
  margin: 0 0 6px;
  font-size: 1rem;
}

.agct-card__oneliner {
  font-size: 0.85rem;
  color: #4b5563;
}

.agct-pill {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  margin: 6px 0;
}

.agct-pill--pinggateway {
  background: #e7f6ee;
  color: #1c8a56;
}

.agct-pill--node-only {
  background: #fbeae7;
  color: #c24a3d;
}

.agct-pill__fallback {
  opacity: 0.75;
  font-weight: 400;
}

.agct-card__fallback-note {
  font-size: 0.75rem;
  color: #6b7280;
}

.agct-card__evidence {
  font-size: 0.75rem;
  margin: 8px 0;
}

.agct-card__evidence code {
  background: #f3f4f6;
  padding: 1px 4px;
  border-radius: 4px;
}

.agct-card__try {
  display: inline-block;
  margin-top: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  color: #2e5fe8;
  text-decoration: none;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/AgentGatewayCapabilitiesTour.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.jsx demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.css demo_api_ui/src/pages/AgentGatewayCapabilitiesTour.test.jsx
git commit -m "feat(agent-gateway): add standalone capability tour page"
```

---

## Task 8: Route + nav wiring for the tour page

**Files:**
- Modify: `demo_api_ui/src/routes/PublicRoutes.js` (add a route-wrapper export, following the `IntentBindingLearningPageRoute` pattern at lines 98-104)
- Modify: `demo_api_ui/src/App.js` (import + `<Route>`, following the `/intent-binding-learning` route at lines 475-480)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry + auto-expand path)

**Interfaces:**
- Consumes: `AgentGatewayCapabilitiesTour` from `../pages/AgentGatewayCapabilitiesTour` (Task 7).

- [ ] **Step 1: Add the route wrapper**

In `demo_api_ui/src/routes/PublicRoutes.js`, near `IntentBindingLearningPageRoute` (lines 98-104), add:

```js
export function AgentGatewayCapabilitiesTourRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AgentGatewayCapabilitiesTour />
    </AppShell>
  );
}
```

Add the corresponding import at the top of `PublicRoutes.js`:

```js
import AgentGatewayCapabilitiesTour from '../pages/AgentGatewayCapabilitiesTour';
```

- [ ] **Step 2: Wire the route in `App.js`**

Add `AgentGatewayCapabilitiesTourRoute` to the destructured import from `./routes/PublicRoutes` (near line 137-159, alongside `IntentBindingLearningPageRoute`).

Add the route JSX near the existing `/intent-binding-learning` route (lines 475-480):

```jsx
        <Route
          path="/agent-gateway-capabilities"
          element={
            <AgentGatewayCapabilitiesTourRoute user={user} logout={logout} />
          }
        />
```

- [ ] **Step 3: Add the nav entry**

In `demo_api_ui/src/components/AdminSideNav.jsx`, add `/agent-gateway-capabilities` to the `banking-mcp-gateways` group's `paths` array in `AUTO_EXPAND_SECTIONS` (line 150 area):

```js
  { id: "banking-mcp-gateways", paths: ["/pinggateway-inspector", "/pinggateway-test", "/mcp-traffic", "/token-security", "/agent-gateway-capabilities"] },
```

Then locate that same group's child-items array (search this file for `"pinggateway-inspector"` to find it — it is a sibling array to the "AI Agents" group shown at lines 446-476) and add a new item following the existing `{ label, path, icon }` shape used there:

```js
{ label: "Capability Tour", path: "/agent-gateway-capabilities", icon: "gtw" },
```

- [ ] **Step 4: Manual verification**

Run: `cd demo_api_ui && npm start` (or the project's usual dev command), then navigate to `local.ping-devops.com:4000/agent-gateway-capabilities` while signed in as admin.
Expected: the tour page renders with 7 cards under 3 group headings; the nav sidebar shows a "Capability Tour" entry under the same group as "PingGateway Inspector".

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/PublicRoutes.js demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx
git commit -m "feat(agent-gateway): route and nav entry for the capability tour"
```

---

## Task 9: Token Transform tab

**Files:**
- Modify: `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx` (state at line 891, tabs at lines 997-1014)
- Test: `demo_api_ui/src/components/UnifiedTokenFlowInspector.test.jsx` (check if this file already exists first — if so, add to it; otherwise create it minimally scoped to this new tab only, since the rest of the component already has its own coverage or none, per repo convention)

**Interfaces:**
- Consumes: `GET /api/admin/mcp-gateway/config` (BFF proxy to the gateway's `GET /admin/config` safe view) — specifically `gatewayResourceUri`, `mcpOlbResourceUri`, `mcpResourceServerResourceUri`. Confirmed: this fetch is currently inline in `McpGatewayConfig.jsx`'s `McpGatewayConfigInner` (`fetchConfig`, lines 101-113 — a plain `fetch()` + `useState`, not a shared hook), and its result is passed down as `mock`/`live` props to `GatewayRoutingDiagram` (`McpGatewayConfig.jsx:383`, `<GatewayRoutingDiagram live={mock.liveConfig} config={config} mock={mock} />`). `UnifiedTokenFlowInspector.jsx` has no access to this today.

- [ ] **Step 1: Extract the fetch into a shared hook**

Create `demo_api_ui/src/hooks/useGatewayLiveConfig.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../services/apiClient';

export function useGatewayLiveConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/mcp-gateway/config`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}
```

Confirm `API_BASE` is genuinely exported from `demo_api_ui/src/services/apiClient` (grep it) — if `McpGatewayConfig.jsx` imports it from elsewhere, source the import from that file instead.

Then, in `McpGatewayConfig.jsx`, replace the inline `fetchConfig`/`useEffect` pair (lines 101-113) with `const { data, loading, error, refetch: fetchConfig } = useGatewayLiveConfig();` and delete the now-redundant local `data`/`loading`/`error` `useState` declarations (lines 77-79) — this task's job is to make the data source shared, not to leave two copies of it.

- [ ] **Step 2: Write the failing test**

```jsx
// Add to demo_api_ui/src/components/UnifiedTokenFlowInspector.test.jsx (or create it if absent)
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnifiedTokenFlowInspector from './UnifiedTokenFlowInspector';

describe('UnifiedTokenFlowInspector — Token Transform tab', () => {
  it('shows a Token Transform tab that renders the gateway-in vs backend-out audience', () => {
    render(<UnifiedTokenFlowInspector />);
    fireEvent.click(screen.getByRole('tab', { name: /Token Transform/i }));
    expect(screen.getByText(/gateway-audience-in/i)).toBeInTheDocument();
    expect(screen.getByText(/backend-audience-out/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/UnifiedTokenFlowInspector.test.jsx -t "Token Transform"`
Expected: FAIL — no tab named "Token Transform" exists yet.

- [ ] **Step 4: Add the tab**

In `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx`, extend `activeTab` state (line 891) to a third value and add the tab button (in the `.utfi-tabs` block, lines 997-1008):

```jsx
    <button type="button" role="tab" aria-selected={activeTab === 'transform'}
      className={`utfi-tab${activeTab === 'transform' ? ' utfi-tab--active' : ''}`}
      onClick={() => setActiveTab('transform')}>
      Token Transform
    </button>
```

Extend the tab-content ternary (lines 1010-1014) to a 3-way branch, adding a new section that reads the last token-chain event's `aud` claim (already available via the existing token-chain data this component already consumes) and the live gateway config's routed backend URI:

```jsx
  {activeTab === 'flow' ? (
    <div className="utfi-content">{/* existing AgentFlowSection / OAuthInspectorSection */}</div>
  ) : activeTab === 'chain' ? (
    <div className="utfi-chain-view"><TokenChainTraceRail /></div>
  ) : (
    <div className="utfi-transform-view">
      <ClaimRow label="gateway-audience-in (aud)" value={lastInboundAud} glossary={CLAIM_GLOSSARY.aud} />
      <ClaimRow label="backend-audience-out" value={lastRoutedBackendUri} glossary={CLAIM_GLOSSARY.aud} />
    </div>
  )}
```

`lastInboundAud` and `lastRoutedBackendUri` are two small derived values: the former from the existing token-chain event stream this component already has in scope (find the variable already holding the most recent token's decoded claims — search this file for where `ClaimRow` is already used for `aud` elsewhere and reuse that same source), the latter from the config hook confirmed in Step 1 (`gatewayResourceUri` is the "in" side's audience; `mcpOlbResourceUri`/`mcpResourceServerResourceUri` is the "out" side, selected by whichever tool the last call routed to — reuse the existing `routeTool`-equivalent logic already present in `GatewayRoutingDiagram.jsx` if there is one, otherwise a simple lookup is fine since this is a teaching display, not enforcement).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/UnifiedTokenFlowInspector.test.jsx -t "Token Transform"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx demo_api_ui/src/components/UnifiedTokenFlowInspector.test.jsx demo_api_ui/src/hooks/useGatewayLiveConfig.js demo_api_ui/src/components/McpGatewayConfig.jsx
git commit -m "feat(agent-gateway): add Token Transform tab to the flow inspector"
```

---

## Task 10: Existing-panel callouts

**Files:**
- Modify: `demo_api_ui/src/components/AgentGatewayTester.jsx:329` (insert after `<div className="p1mcp-page">`)
- Modify: `demo_api_ui/src/components/McpGatewayConfig.jsx:242` (insert after `<div className="mgc-root">`, inside `McpGatewayConfigInner`, not the default-export wrapper)
- Modify: `demo_api_ui/src/components/AgentGatewayLogPanel.jsx` (insert near the top of its render, after reading the file — this task's audit didn't capture its exact JSX opening tag, so read lines 1-40 first)
- Modify: `demo_api_ui/src/components/ScopeAuditPage.js:155` (insert after the subtitle `<p>`, before the "Summary bar" comment)
- Test: none new — each insertion is covered by that file's existing render tests if present; this task adds one assertion per file confirming the callout renders

**Interfaces:**
- Consumes: `CapabilityCallout` from `./CapabilityCallout` (Task 2).

- [ ] **Step 1: `AgentGatewayTester.jsx`**

Add the import near the top (with the other component imports, lines 4-9):

```jsx
import CapabilityCallout from './CapabilityCallout';
```

Insert into the render, current lines 328-333:

```jsx
  return (
    <div className="p1mcp-page">
      {/* Top bar */}
      <div className="p1mcp-topbar">
```

becomes:

```jsx
  return (
    <div className="p1mcp-page">
      <CapabilityCallout capabilityId="mcp-validation" />
      {/* Top bar */}
      <div className="p1mcp-topbar">
```

- [ ] **Step 2: `McpGatewayConfig.jsx`**

Add the same import (with the file's existing imports, lines 1-14). Edit `McpGatewayConfigInner` (the function at line 75 — NOT the default-export wrapper at 756-762), current lines 241-244:

```jsx
  return (
    <div className="mgc-root">
      <div className="mgc-header">
        <div>
```

becomes:

```jsx
  return (
    <div className="mgc-root">
      <CapabilityCallout capabilityId="audit-logging" />
      <div className="mgc-header">
        <div>
```

- [ ] **Step 3: `AgentGatewayLogPanel.jsx`**

Read `demo_api_ui/src/components/AgentGatewayLogPanel.jsx` lines 1-45 to find its exact opening return/JSX (not captured in prior research — this file's render structure starts after its data-fetching hooks, function declared at line 32). Add the same `CapabilityCallout` import, and insert `<CapabilityCallout capabilityId="rate-limiting" />` as the first child of whatever top-level wrapper `<div>` that render returns.

- [ ] **Step 4: `ScopeAuditPage.js`**

Add the same import (with the file's existing imports, lines 1-4). Current lines 150-157:

```jsx
  return (
    <div className="scope-audit-page">
      <h1>PingOne Scope Audit</h1>
      <p className="scope-audit-page__subtitle">
        Environment: <code>{envInfo.environment}</code> · Region: <code>{envInfo.region}</code>
      </p>

      {/* Summary bar */}
```

becomes:

```jsx
  return (
    <div className="scope-audit-page">
      <h1>PingOne Scope Audit</h1>
      <p className="scope-audit-page__subtitle">
        Environment: <code>{envInfo.environment}</code> · Region: <code>{envInfo.region}</code>
      </p>
      <CapabilityCallout capabilityId="policy-enforcement" />

      {/* Summary bar */}
```

- [ ] **Step 5: Run each file's existing test suite to check for regressions**

Run: `cd demo_api_ui && npx vitest run AgentGatewayTester McpGatewayConfig AgentGatewayLogPanel ScopeAuditPage`
Expected: PASS — a purely additive JSX insert at the top of an existing render should not break any test asserting on other elements, unless a test uses a brittle `container.firstChild.firstChild`-style structural query. If any such test breaks, fix that test's selector to target the specific element by role/text instead of positional traversal — do not remove the callout to make a brittle test pass.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/AgentGatewayTester.jsx demo_api_ui/src/components/McpGatewayConfig.jsx demo_api_ui/src/components/AgentGatewayLogPanel.jsx demo_api_ui/src/components/ScopeAuditPage.js
git commit -m "feat(agent-gateway): add capability callouts to existing gateway panels"
```

---

## Task 11: "Agent Gateway" group on `/use-cases`

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js` (`TRACK_ORDER`/`TRACK_LABELS` area at lines 37-49, filter derivation near lines 869-884, render block near lines 958-984)
- Test: `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js` (existing — add to it)

**Interfaces:**
- Consumes: `allRelatedUCIds()` from `../config/agentGatewayCapabilities` (Task 1).

**Note:** This is an ADDITIVE strip section, following the exact existing pattern used for the "demo" track strip and the "Happy Paths" strip (both filter `useCases` by an id set and render as their own `<section>` before the main `track`-grouped grid) — it does NOT reassign any UC's existing `track` field, so no use case's current grouping changes.

**Note:** `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js` already has the exact render/mock harness this task needs: `renderPage()` (line 195-201, wraps `<UseCaseLauncherPage />` in `<MemoryRouter>`), a `beforeEach` (line 204-225) whose `apiClient.get` mock resolves `{ data: { vertical: 'banking', useCases: MOCK_USE_CASES } }`, and a `MOCK_USE_CASES` fixture (from line 59) that already includes `UC1` ("Delegated access with proof") and `UC11` — both members of `allRelatedUCIds()` — so no fixture changes are needed for this test. `screen` and `within` are already imported at the top of the file (line 22). This mirrors the existing "Happy Path section" test at line 481 almost exactly.

- [ ] **Step 1: Write the failing test**

Add to the `describe('UseCaseLauncherPage', ...)` block in `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`, near the existing Happy-Path-section test (line 481):

```js
  it('renders an Agent Gateway section containing UC1 and UC11', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Agent Gateway/i)).toBeInTheDocument());
    const section = screen.getByText(/Agent Gateway/i).closest('section');
    expect(within(section).getAllByText('Delegated access with proof').length).toBeGreaterThan(0); // UC1
    expect(within(section).getAllByText('Bad client to agent gateway').length).toBeGreaterThan(0); // UC11
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js -t "Agent Gateway section"`
Expected: FAIL — no "Agent Gateway" text/section exists yet.

- [ ] **Step 3: Add the label and import**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, near the existing `HAPPY_PATH_LABEL`/`DEMO_LABEL` constants (lines 48-49):

```js
const AGENT_GATEWAY_LABEL = 'Agent Gateway — validate, throttle, transform, and enforce, cited against the running code';
```

Add the import at the top of the file:

```js
import { allRelatedUCIds } from '../config/agentGatewayCapabilities';
```

- [ ] **Step 4: Derive the filtered list**

Near the existing `happyPathIds`/`happyPath`/`demoVisible` derivations (lines 869-884), add:

```js
  const agentGatewayIds = new Set(allRelatedUCIds());
  const agentGatewayAll = useCases.filter((uc) => agentGatewayIds.has(uc.id));
  const agentGatewayVisible = agentGatewayAll.filter((uc) => matchesQuery(uc, query));
```

- [ ] **Step 5: Render the strip section**

Near the existing demo-script strip section (before line 958's `{demoVisible.length > 0 && (...)}` block, so it appears as its own section ahead of the track-grouped grid — same visual tier as the other two strips), add:

```jsx
      {agentGatewayVisible.length > 0 && (
        <section className="uc-track uc-track--agent-gateway">
          <h2 className="uc-track__heading">{AGENT_GATEWAY_LABEL}</h2>
          <div className="uc-track__grid">
            {agentGatewayVisible.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                completed={completedIds.has(uc.id)}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                flagMap={flagMap}
                flagsLoading={flagsLoading}
                setFlag={setFlag}
              />
            ))}
          </div>
        </section>
      )}
```

(This mirrors the "Happy Paths" strip block exactly — same `UseCaseCard` props, no `stepNumber` prop since this isn't a numbered walkthrough.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: PASS — including the new test and all pre-existing ones in this file (a UC now appearing in two sections — its original track AND this new strip — must not break any test asserting an exact total card count on the page; if one does, that test's expected count needs updating, since the design is intentionally additive/duplicative, not exclusive).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js
git commit -m "feat(agent-gateway): add Agent Gateway strip section to /use-cases"
```

---

## Final verification

- [ ] Run the full frontend suite: `cd demo_api_ui && npm run test:unit`
- [ ] Run the full gateway suite: `cd demo_mcp_gateway && npm test`
- [ ] Run the full BFF suite: `cd demo_api_server && npm test` (per `feedback-ci-blocked-validate-locally` — run locally, `CI=true`, do not trust GitHub Actions status)
- [ ] Manual: sign in at `local.ping-devops.com:4000`, open "Demo steps", confirm UC18 and UC29 both appear and run to completion (429 and 503 respectively, both visible in `AgentGatewayLogPanel`'s Decisions table)
- [ ] Manual: visit `/agent-gateway-capabilities`, confirm all 7 cards render with correct evidence citations
- [ ] Manual: visit `/use-cases`, confirm the new "Agent Gateway" strip appears above the track-grouped grid with the 9 expected use cases
