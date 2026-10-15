# OBO Demo Backend + Hosted Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the BFF half of the OBO demo (exchange service, MCP endpoint, downstream verifier, PingOne bootstrap resource) and prove on the hosted site that Claude Code can log in and call it. This is plan 1 of 2; the page, live panel, diagram and Learning Hub entry are plan 2, written after the probe passes.

**Architecture:** A pure `oboEvidence` module builds the 7-check evidence from two tokens. `oboExchangeService.runObo` fetches the AI Agent actor token, exchanges via the Token Exchanger app, verifies both tokens downstream in-process, and returns evidence (never raw tokens). `routes/obo.js` exposes `POST /api/obo/mcp` (Claude's MCP endpoint) and `GET /api/obo/downstream`. An in-memory `oboEventHub` keyed by user `sub` receives each Claude-driven result. Bootstrap creates a persistent "OBO Demo" PingOne resource whose `act` attribute is a SpEL map literal.

**Tech Stack:** Node 22 CommonJS + Express + jest + supertest (demo_api_server), `jsonwebtoken` via the existing `tokenValidationService.validateToken`, PingOne Management API via `pingoneProvisionService`.

**Spec:** `docs/superpowers/specs/2026-10-14-obo-demo-page-design.md`

**Deviation from spec (deliberate):** the service verifies tokens downstream by calling the shared verifier function in-process instead of an HTTP loopback to `/api/obo/downstream`. Same checks, no network hop, testable. The route still exists so the verifier can be probed externally.

## Global Constraints

- Work only in worktree `/Users/cmuir/Development/AI-DEMO2-obo-demo`, branch `feat/obo-demo-page`. Verify `git branch --show-current` before every commit. Stage files explicitly; never `git add -A`.
- BFF tests: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest <path> --forceExit` (loopback supertest suites need `ALLOW_TEST_NETWORK=1`; the jest network guard blocks sockets otherwise).
- No raw access token may appear in any return value, log line, event or error message. Only 16-char sha256 prefixes and decoded claims.
- `act` must be an object `{ "client_id": <AI Agent client id> }`. The only PingOne mapping that produces this is the resource attribute `${{'client_id': #root.context.requestData.actorToken.client_id}}`.
- `sub` is reserved on new PingOne resources; never create it.
- Defaults: audience `obo-demo.ping.demo`, scope `obo:invoke`, actor scope `agent:invoke`. Env overrides: `OBO_AUDIENCE`, `OBO_SCOPE`, `OBO_INBOUND_AUDIENCES` (comma list).
- Emoji allowlist applies to any new log/step text (CLAUDE.md section 0); use only the allowlisted glyphs.
- Deploy is a focused BFF deploy per `docs/worktree-and-stack.md` / `se-update-code.sh`; default target is local Docker. Do not deploy to the SE site without the user naming it.

## Review Focus

- Token in a thrown error message or evidence field (e.g. PingOne echoes a token in `error_description`): must be redacted, never returned. Pinned in Task 1 (leak scan) and Task 3 (error path).
- `act` returned as a string instead of an object (mapping regressed): check 2 must fail, not pass. Task 1.
- Downstream accepting the user token (aud misconfigured so the user token also passes): check 6 must fail. Task 1 and Task 2.
- Unauthenticated `POST /api/obo/mcp` on the hosted site returning the wall's bare `hosted_access_required` instead of the OAuth challenge, which makes Claude unable to discover PingOne. Task 5 (bypass) + Task 4 (challenge header).
- Notification messages (JSON-RPC with no `id`) and unknown methods: must not 500 or hang. Task 4.
- Re-running bootstrap must not duplicate the resource or fail the whole bootstrap. Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `demo_api_server/services/oboConfig.js` | Constants and `getOboConfig()`; single source of audience/scope/issuer/clients |
| Create `demo_api_server/services/oboEvidence.js` | Pure: decode claims, hash, leak scan, build evidence + 7 checks |
| Create `demo_api_server/services/oboEventHub.js` | In-memory pub/sub keyed by `sub` with a 5-event replay buffer |
| Create `demo_api_server/services/oboDownstream.js` | `verifyDownstream(token)`: accepts only `aud` = OBO audience with an `act` object |
| Create `demo_api_server/services/oboExchangeService.js` | `runObo(...)`: actor token, exchange, downstream checks, evidence |
| Create `demo_api_server/routes/obo.js` | `router` (`/downstream`, `/mcp`) and `metadataHandler` |
| Modify `demo_api_server/server.js` | Mount router and metadata handler |
| Modify `demo_api_server/middleware/hostedAccessGate.js` | Bypass `POST /api/obo/mcp` so its OAuth challenge is reachable |
| Modify `demo_api_server/services/pingoneProvisionService.js` | `ensureOboDemoResource()` + call it from bootstrap |
| Tests under `demo_api_server/src/__tests__/` | One per new file, plus gate and provisioning additions |

---

### Task 1: Config and evidence (pure)

**Files:**
- Create: `demo_api_server/services/oboConfig.js`
- Create: `demo_api_server/services/oboEvidence.js`
- Test: `demo_api_server/src/__tests__/services/oboEvidence.test.js`

**Interfaces:**
- Produces:
  - `oboConfig.getOboConfig() -> { audience, scope, actorScope, issuer, jwksUri, inboundAudiences: string[], exchanger: {id, secret}, agent: {id, secret} }`
  - `oboConfig.OBO_ACT_SPEL` (string constant)
  - `oboEvidence.sha(token) -> string(16)`, `oboEvidence.claims(token) -> object`
  - `oboEvidence.hasTokenLeak(value, secrets?) -> boolean`
  - `oboEvidence.buildEvidence({ source, subjectToken, delegatedToken, actorClientId, downstream:{delegated:number,userToken:number} }) -> Evidence`
  - `Evidence = { ts, source, sub, inbound:{aud,scope,client_id,sha}, delegated:{aud,scope,sub,act,exp,sha}, downstream, checks:[{id,label,pass}], leak:boolean }`

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/services/oboEvidence.test.js
'use strict';
const { buildEvidence, hasTokenLeak, sha } = require('../../../services/oboEvidence');

const jwt = (payload) =>
  ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

const AGENT = 'f65664b2-e515-45ee-b99b-4f04ad136e74';
const user = jwt({ sub: 'u1', aud: ['mcpgateway.ping.demo'], scope: 'mcp:invoke', client_id: 'c8392dc4' });
const good = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], scope: 'obo:invoke', act: { client_id: AGENT }, exp: 9999999999 });
const ok = { delegated: 200, userToken: 401 };
const byId = (ev, id) => ev.checks.find((c) => c.id === id);

describe('buildEvidence', () => {
  test('all 7 checks pass for a correct delegation', () => {
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: ok });
    expect(ev.checks).toHaveLength(7);
    expect(ev.checks.every((c) => c.pass)).toBe(true);
    expect(ev.sub).toBe('u1');
    expect(ev.delegated.act).toEqual({ client_id: AGENT });
    expect(ev.leak).toBe(false);
  });

  test('never contains the raw tokens', () => {
    const ev = buildEvidence({ source: 'page', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: ok });
    const text = JSON.stringify(ev);
    expect(text).not.toContain(user);
    expect(text).not.toContain(good);
    expect(ev.inbound.sha).toBe(sha(user));
  });

  test('act as a bare string fails the act check', () => {
    const str = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], act: AGENT });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: str, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'act-object').pass).toBe(false);
  });

  test('act naming a different client fails the act check', () => {
    const other = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], act: { client_id: 'someone-else' } });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: other, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'act-object').pass).toBe(false);
  });

  test('different subject fails the sub check', () => {
    const other = jwt({ sub: 'u2', aud: ['obo-demo.ping.demo'], act: { client_id: AGENT } });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: other, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'sub-preserved').pass).toBe(false);
  });

  test('same audience as the user token fails the audience check', () => {
    const same = jwt({ sub: 'u1', aud: ['mcpgateway.ping.demo'], act: { client_id: AGENT } });
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: same, actorClientId: AGENT, downstream: ok });
    expect(byId(ev, 'aud-differs').pass).toBe(false);
  });

  test('downstream accepting the user token fails the refusal check', () => {
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: { delegated: 200, userToken: 200 } });
    expect(byId(ev, 'downstream-refuses-user').pass).toBe(false);
  });

  test('downstream rejecting the delegated token fails the acceptance check', () => {
    const ev = buildEvidence({ source: 'claude', subjectToken: user, delegatedToken: good, actorClientId: AGENT, downstream: { delegated: 401, userToken: 401 } });
    expect(byId(ev, 'downstream-accepts-delegated').pass).toBe(false);
  });
});

describe('hasTokenLeak', () => {
  test('detects a JWT-shaped string anywhere in a value', () => {
    expect(hasTokenLeak({ a: { b: `x ${good} y` } })).toBe(true);
  });
  test('detects a planted secret that is not JWT-shaped', () => {
    expect(hasTokenLeak({ msg: 'opaque-token-123' }, ['opaque-token-123'])).toBe(true);
  });
  test('clean claims are not a leak', () => {
    expect(hasTokenLeak({ sub: 'u1', aud: ['x'] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/services/oboEvidence.test.js --forceExit`
Expected: FAIL, "Cannot find module '../../../services/oboEvidence'"

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_server/services/oboConfig.js
'use strict';
const configStore = require('./configStore');

// PingOne resource attribute that makes `act` an RFC 8693 OBJECT. A bare ${..client_id} yields a
// string; JSON text containing ${} is not evaluated; #{..} is emitted literally (proven 2026-10-14).
const OBO_ACT_SPEL = "${{'client_id': #root.context.requestData.actorToken.client_id}}";

function getOboConfig() {
  const envId = configStore.getEffective('pingone_environment_id');
  const region = configStore.getEffective('pingone_region') || 'com';
  const issuer = `https://auth.pingone.${region}/${envId}/as`;
  const inbound = process.env.OBO_INBOUND_AUDIENCES || process.env.MCP_GW_RESOURCE_URI || 'mcpgateway.ping.demo';
  return {
    audience: process.env.OBO_AUDIENCE || 'obo-demo.ping.demo',
    scope: process.env.OBO_SCOPE || 'obo:invoke',
    actorScope: 'agent:invoke',
    issuer,
    jwksUri: `${issuer}/jwks`,
    inboundAudiences: inbound.split(',').map((s) => s.trim()).filter(Boolean),
    exchanger: {
      id: configStore.getEffective('pingone_token_exchanger_client_id'),
      secret: configStore.getEffective('pingone_token_exchanger_client_secret'),
    },
    agent: {
      id: configStore.getEffective('pingone_ai_agent_actor_client_id'),
      secret: configStore.getEffective('pingone_ai_agent_actor_client_secret'),
    },
  };
}

module.exports = { getOboConfig, OBO_ACT_SPEL };
```

```js
// demo_api_server/services/oboEvidence.js
'use strict';
const crypto = require('crypto');

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]*/;

const sha = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
const claims = (token) => JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));

function hasTokenLeak(value, secrets = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return JWT_RE.test(text) || secrets.some((s) => s && text.includes(s));
}

const sameAud = (a, b) => JSON.stringify([].concat(a || []).sort()) === JSON.stringify([].concat(b || []).sort());

function buildEvidence({ source, subjectToken, delegatedToken, actorClientId, downstream }) {
  const inC = claims(subjectToken);
  const dC = claims(delegatedToken);
  const evidence = {
    ts: new Date().toISOString(),
    source,
    sub: inC.sub,
    inbound: { aud: inC.aud, scope: inC.scope, client_id: inC.client_id, sha: sha(subjectToken) },
    delegated: { aud: dC.aud, scope: dC.scope, sub: dC.sub, act: dC.act, exp: dC.exp, sha: sha(delegatedToken) },
    downstream,
  };
  const leak = hasTokenLeak(evidence, [subjectToken, delegatedToken]);
  const act = dC.act;
  const checks = [
    { id: 'sub-preserved', label: 'Delegated token is for the same user (sub preserved)', pass: dC.sub === inC.sub },
    { id: 'act-object', label: 'Delegated token carries an act object naming the agent (delegation, not impersonation)',
      pass: !!act && typeof act === 'object' && act.client_id === actorClientId },
    { id: 'different-token', label: 'Delegated token is a different token from the user token',
      pass: evidence.delegated.sha !== evidence.inbound.sha },
    { id: 'aud-differs', label: 'Delegated token audience differs from the one the client held', pass: !sameAud(dC.aud, inC.aud) },
    { id: 'downstream-accepts-delegated', label: 'Downstream accepted the delegated token', pass: downstream.delegated === 200 },
    { id: 'downstream-refuses-user', label: 'Downstream refused the user token (the agent could not have used it)', pass: downstream.userToken === 401 },
    { id: 'no-token-leak', label: 'Nothing returned to the model or browser contained a token', pass: !leak },
  ];
  return { ...evidence, checks, leak };
}

module.exports = { sha, claims, hasTokenLeak, buildEvidence };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/services/oboEvidence.test.js --forceExit`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # expect feat/obo-demo-page
git add demo_api_server/services/oboConfig.js demo_api_server/services/oboEvidence.js demo_api_server/src/__tests__/services/oboEvidence.test.js
git commit -m "feat(obo): config and evidence builder with 7 delegation checks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Downstream verifier and event hub

**Files:**
- Create: `demo_api_server/services/oboDownstream.js`
- Create: `demo_api_server/services/oboEventHub.js`
- Test: `demo_api_server/src/__tests__/services/oboDownstream.test.js`
- Test: `demo_api_server/src/__tests__/services/oboEventHub.test.js`

**Interfaces:**
- Consumes: `oboConfig.getOboConfig()` (Task 1); `tokenValidationService.validateToken(token, { jwksUri, issuer, audience })` -> decoded payload or throws.
- Produces:
  - `oboDownstream.verifyDownstream(token) -> Promise<{ status: 200|401, acting_for?, acted_by?, error? }>`
  - `oboEventHub.publish(sub, evidence)`, `oboEventHub.subscribe(sub, res) -> unsubscribe()`, `oboEventHub._reset()` (tests only)

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_server/src/__tests__/services/oboDownstream.test.js
'use strict';
jest.mock('../../../services/tokenValidationService');
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: () => ({ audience: 'obo-demo.ping.demo', issuer: 'https://iss', jwksUri: 'https://iss/jwks' }),
}));
const { validateToken } = require('../../../services/tokenValidationService');
const { verifyDownstream } = require('../../../services/oboDownstream');

test('accepts a token with the OBO audience and an act object', async () => {
  validateToken.mockResolvedValue({ sub: 'u1', act: { client_id: 'agent' } });
  const r = await verifyDownstream('t');
  expect(r).toEqual({ status: 200, acting_for: 'u1', acted_by: { client_id: 'agent' } });
  expect(validateToken).toHaveBeenCalledWith('t', { jwksUri: 'https://iss/jwks', issuer: 'https://iss', audience: 'obo-demo.ping.demo' });
});

test('rejects a valid token that has no act claim', async () => {
  validateToken.mockResolvedValue({ sub: 'u1' });
  expect((await verifyDownstream('t')).status).toBe(401);
});

test('rejects act as a bare string', async () => {
  validateToken.mockResolvedValue({ sub: 'u1', act: 'agent' });
  expect((await verifyDownstream('t')).status).toBe(401);
});

test('rejects when validation throws (wrong audience, bad signature)', async () => {
  validateToken.mockRejectedValue(new Error('jwt audience invalid'));
  const r = await verifyDownstream('t');
  expect(r.status).toBe(401);
  expect(r.error).toMatch(/audience/);
});
```

```js
// demo_api_server/src/__tests__/services/oboEventHub.test.js
'use strict';
const hub = require('../../../services/oboEventHub');
const fakeRes = () => ({ write: jest.fn() });

beforeEach(() => hub._reset());

test('delivers to subscribers of the same sub only', () => {
  const a = fakeRes(); const b = fakeRes();
  hub.subscribe('u1', a); hub.subscribe('u2', b);
  hub.publish('u1', { n: 1 });
  expect(a.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ n: 1 })}\n\n`);
  expect(b.write).not.toHaveBeenCalled();
});

test('replays buffered events to a late subscriber', () => {
  hub.publish('u1', { n: 1 });
  const late = fakeRes();
  hub.subscribe('u1', late);
  expect(late.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ n: 1 })}\n\n`);
});

test('keeps only the last 5 events', () => {
  for (let i = 1; i <= 7; i += 1) hub.publish('u1', { n: i });
  const late = fakeRes();
  hub.subscribe('u1', late);
  expect(late.write).toHaveBeenCalledTimes(5);
  expect(late.write.mock.calls[0][0]).toContain('"n":3');
});

test('unsubscribe stops delivery', () => {
  const a = fakeRes();
  const off = hub.subscribe('u1', a);
  off();
  hub.publish('u1', { n: 1 });
  expect(a.write).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/services/oboDownstream.test.js src/__tests__/services/oboEventHub.test.js --forceExit`
Expected: FAIL, "Cannot find module" for both services

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_server/services/oboDownstream.js
'use strict';
const { validateToken } = require('./tokenValidationService');
const { getOboConfig } = require('./oboConfig');

// Accepts only a delegation token: right audience AND an `act` object naming a client.
async function verifyDownstream(token) {
  const cfg = getOboConfig();
  try {
    const c = await validateToken(token, { jwksUri: cfg.jwksUri, issuer: cfg.issuer, audience: cfg.audience });
    if (!c.act || typeof c.act !== 'object' || !c.act.client_id) {
      return { status: 401, error: 'no act object (not a delegation token)' };
    }
    return { status: 200, acting_for: c.sub, acted_by: c.act };
  } catch (e) {
    return { status: 401, error: e.message };
  }
}

module.exports = { verifyDownstream };
```

```js
// demo_api_server/services/oboEventHub.js
'use strict';
// In-memory pub/sub keyed by user sub, with a short replay buffer so a page opened after the call
// still shows it. ponytail: single process only (same limit as mcpFlowSseHub); use Redis pub/sub if the BFF scales out.
const BUFFER_MAX = 5;
const subscribers = new Map(); // sub -> Set<res>
const buffers = new Map();     // sub -> evidence[]

function publish(sub, evidence) {
  const buf = buffers.get(sub) || [];
  buf.push(evidence);
  while (buf.length > BUFFER_MAX) buf.shift();
  buffers.set(sub, buf);
  const line = `data: ${JSON.stringify(evidence)}\n\n`;
  for (const res of subscribers.get(sub) || []) res.write(line);
}

function subscribe(sub, res) {
  const set = subscribers.get(sub) || new Set();
  set.add(res);
  subscribers.set(sub, set);
  for (const ev of buffers.get(sub) || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  return () => set.delete(res);
}

function _reset() { subscribers.clear(); buffers.clear(); }

module.exports = { publish, subscribe, _reset };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/services/oboDownstream.test.js src/__tests__/services/oboEventHub.test.js --forceExit`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/services/oboDownstream.js demo_api_server/services/oboEventHub.js demo_api_server/src/__tests__/services/oboDownstream.test.js demo_api_server/src/__tests__/services/oboEventHub.test.js
git commit -m "feat(obo): downstream delegation verifier and per-user event hub

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Exchange service

**Files:**
- Create: `demo_api_server/services/oboExchangeService.js`
- Test: `demo_api_server/src/__tests__/services/oboExchangeService.test.js`

**Interfaces:**
- Consumes: `getOboConfig` (Task 1), `buildEvidence` (Task 1), `verifyDownstream` (Task 2), `agentCCTokenService.getAgentCCToken(req, { clientId, clientSecret, scope, authMethod }) -> { access_token }`, `oauthService.performTokenExchangeAs(subject, actor, clientId, clientSecret, audience, scopes, method) -> string (access token)`.
- Produces: `runObo({ req, subjectToken, source }, deps?) -> Promise<Evidence>`; throws `Error` with `.code = 'obo_not_configured'`, `.httpStatus = 503` when the exchanger or agent client is missing.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/services/oboExchangeService.test.js
'use strict';
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: jest.fn(() => ({
    audience: 'obo-demo.ping.demo', scope: 'obo:invoke', actorScope: 'agent:invoke',
    exchanger: { id: 'ex', secret: 'exs' }, agent: { id: 'AGENT', secret: 'ags' },
  })),
}));
jest.mock('../../../services/agentCCTokenService', () => ({ getAgentCCToken: jest.fn() }));
jest.mock('../../../services/oauthService', () => ({ performTokenExchangeAs: jest.fn() }));

const { getOboConfig } = require('../../../services/oboConfig');
const { runObo } = require('../../../services/oboExchangeService');

const jwt = (p) => ['eyJhbGciOiJSUzI1NiJ9', Buffer.from(JSON.stringify(p)).toString('base64url'), 's'].join('.');
const user = jwt({ sub: 'u1', aud: ['mcpgateway.ping.demo'], client_id: 'c' });
const delegated = jwt({ sub: 'u1', aud: ['obo-demo.ping.demo'], scope: 'obo:invoke', act: { client_id: 'AGENT' }, exp: 9999999999 });

const deps = (over = {}) => ({
  getActorToken: jest.fn().mockResolvedValue('actor'),
  exchange: jest.fn().mockResolvedValue(delegated),
  verifyDownstream: jest.fn(async (t) => (t === delegated ? { status: 200 } : { status: 401 })),
  ...over,
});

test('returns passing evidence and never the raw tokens', async () => {
  const d = deps();
  const ev = await runObo({ req: {}, subjectToken: user, source: 'claude' }, d);
  expect(ev.checks.every((c) => c.pass)).toBe(true);
  expect(d.exchange).toHaveBeenCalledWith(user, 'actor', expect.objectContaining({ audience: 'obo-demo.ping.demo' }));
  expect(JSON.stringify(ev)).not.toContain(delegated);
  expect(JSON.stringify(ev)).not.toContain(user);
});

test('verifies BOTH tokens downstream', async () => {
  const d = deps();
  await runObo({ req: {}, subjectToken: user, source: 'page' }, d);
  expect(d.verifyDownstream).toHaveBeenCalledWith(delegated);
  expect(d.verifyDownstream).toHaveBeenCalledWith(user);
});

test('a downstream that accepts the user token produces a failing check', async () => {
  const d = deps({ verifyDownstream: jest.fn().mockResolvedValue({ status: 200 }) });
  const ev = await runObo({ req: {}, subjectToken: user, source: 'claude' }, d);
  expect(ev.checks.find((c) => c.id === 'downstream-refuses-user').pass).toBe(false);
});

test('throws obo_not_configured (503) when the exchanger client is missing', async () => {
  getOboConfig.mockReturnValueOnce({ exchanger: {}, agent: { id: 'a', secret: 's' } });
  await expect(runObo({ req: {}, subjectToken: user, source: 'page' }, deps()))
    .rejects.toMatchObject({ code: 'obo_not_configured', httpStatus: 503 });
});

test('an exchange error propagates without the subject token in its message', async () => {
  const d = deps({ exchange: jest.fn().mockRejectedValue(new Error('Token exchange failed for ex: invalid_scope')) });
  const err = await runObo({ req: {}, subjectToken: user, source: 'claude' }, d).catch((e) => e);
  expect(err.message).toMatch(/invalid_scope/);
  expect(err.message).not.toContain(user);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/services/oboExchangeService.test.js --forceExit`
Expected: FAIL, "Cannot find module '../../../services/oboExchangeService'"

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_server/services/oboExchangeService.js
'use strict';
const { getOboConfig } = require('./oboConfig');
const { buildEvidence } = require('./oboEvidence');
const { verifyDownstream } = require('./oboDownstream');
const { getAgentCCToken } = require('./agentCCTokenService');
const oauthService = require('./oauthService');

const defaultDeps = {
  verifyDownstream,
  // Actor = the AI Agent app's client-credentials token (the proven path), NOT the exchanger's own.
  getActorToken: async (req, cfg) => (await getAgentCCToken(req, {
    clientId: cfg.agent.id, clientSecret: cfg.agent.secret, scope: [cfg.actorScope], authMethod: 'post',
  })).access_token,
  // Exchanging app = Token Exchanger (proven), not the admin client used by performTokenExchangeWithActor.
  exchange: (subjectToken, actorToken, cfg) => oauthService.performTokenExchangeAs(
    subjectToken, actorToken, cfg.exchanger.id, cfg.exchanger.secret, cfg.audience, cfg.scope, 'post',
  ),
};

function assertConfigured(cfg) {
  if (!cfg.exchanger?.id || !cfg.exchanger?.secret || !cfg.agent?.id || !cfg.agent?.secret) {
    const err = new Error('OBO demo not configured (Token Exchanger or AI Agent client missing)');
    err.code = 'obo_not_configured';
    err.httpStatus = 503;
    throw err;
  }
}

async function runObo({ req, subjectToken, source }, deps = {}) {
  const cfg = getOboConfig();
  assertConfigured(cfg);
  const d = { ...defaultDeps, ...deps };
  const actorToken = await d.getActorToken(req, cfg);
  const delegatedToken = await d.exchange(subjectToken, actorToken, cfg);
  const [accepted, refused] = await Promise.all([
    d.verifyDownstream(delegatedToken),
    d.verifyDownstream(subjectToken),
  ]);
  return buildEvidence({
    source, subjectToken, delegatedToken, actorClientId: cfg.agent.id,
    downstream: { delegated: accepted.status, userToken: refused.status },
  });
}

module.exports = { runObo };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/services/oboExchangeService.test.js --forceExit`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/services/oboExchangeService.js demo_api_server/src/__tests__/services/oboExchangeService.test.js
git commit -m "feat(obo): exchange service producing delegation evidence

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Routes (MCP endpoint, downstream, metadata) and mounting

**Files:**
- Create: `demo_api_server/routes/obo.js`
- Modify: `demo_api_server/server.js` (two mounts)
- Test: `demo_api_server/src/__tests__/routes/obo.test.js`

**Interfaces:**
- Consumes: `validateToken`, `getOboConfig`, `runObo` (Task 3), `verifyDownstream` (Task 2), `oboEventHub.publish` (Task 2).
- Produces: `routes/obo.js` exports `{ router, metadataHandler }`. `router`: `GET /downstream`, `POST /mcp`. `metadataHandler(req, res)`. The MCP tool is `act_on_my_behalf` (no params).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/routes/obo.test.js
'use strict';
const express = require('express');
const request = require('supertest');

jest.mock('../../../services/tokenValidationService');
jest.mock('../../../services/oboExchangeService');
jest.mock('../../../services/oboDownstream');
jest.mock('../../../services/oboEventHub');
jest.mock('../../../services/oboConfig', () => ({
  getOboConfig: () => ({ issuer: 'https://iss', jwksUri: 'https://iss/jwks', inboundAudiences: ['mcpgateway.ping.demo'] }),
}));

const { validateToken } = require('../../../services/tokenValidationService');
const { runObo } = require('../../../services/oboExchangeService');
const { verifyDownstream } = require('../../../services/oboDownstream');
const hub = require('../../../services/oboEventHub');
const { router, metadataHandler } = require('../../../routes/obo');

const app = express();
app.use(express.json());
app.use('/api/obo', router);
app.get('/.well-known/oauth-protected-resource/api/obo/mcp', metadataHandler);

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const evidence = {
  sub: 'u1', leak: false,
  delegated: { aud: ['obo-demo.ping.demo'], scope: 'obo:invoke', sub: 'u1', act: { client_id: 'AGENT' }, exp: 1 },
  downstream: { delegated: 200, userToken: 401 }, checks: [{ id: 'x', label: 'x', pass: true }],
};

describe('POST /api/obo/mcp', () => {
  test('401 with an OAuth resource_metadata challenge when no Bearer', async () => {
    const res = await request(app).post('/api/obo/mcp').send(rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/api\/obo\/mcp"$/);
  });

  test('401 challenge when the token fails validation', async () => {
    validateToken.mockRejectedValue(new Error('bad sig'));
    const res = await request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(rpc('tools/list'));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBeDefined();
  });

  test('validates against the configured inbound audiences', async () => {
    validateToken.mockResolvedValue({ sub: 'u1' });
    await request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(rpc('ping'));
    expect(validateToken).toHaveBeenCalledWith('x', { jwksUri: 'https://iss/jwks', issuer: 'https://iss', audience: ['mcpgateway.ping.demo'] });
  });

  describe('with a valid token', () => {
    beforeEach(() => validateToken.mockResolvedValue({ sub: 'u1' }));
    const post = (body) => request(app).post('/api/obo/mcp').set('Authorization', 'Bearer x').send(body);

    test('initialize echoes the protocol version', async () => {
      const res = await post(rpc('initialize', { protocolVersion: '2025-06-18' }));
      expect(res.body.result.protocolVersion).toBe('2025-06-18');
      expect(res.body.result.capabilities).toEqual({ tools: {} });
    });

    test('tools/list returns the single tool', async () => {
      const res = await post(rpc('tools/list'));
      expect(res.body.result.tools.map((t) => t.name)).toEqual(['act_on_my_behalf']);
    });

    test('tools/call runs the exchange, publishes evidence for the user, and returns claims only', async () => {
      runObo.mockResolvedValue(evidence);
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(runObo).toHaveBeenCalledWith(expect.objectContaining({ subjectToken: 'x', source: 'claude' }));
      expect(hub.publish).toHaveBeenCalledWith('u1', evidence);
      const text = res.body.result.content[0].text;
      expect(text).toContain('"client_id": "AGENT"');
      expect(text).not.toMatch(/eyJ/);
    });

    test('a leaking result is withheld from the model', async () => {
      runObo.mockResolvedValue({ ...evidence, leak: true });
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(res.body.result.content[0].text).toMatch(/withheld/);
    });

    test('an exchange failure is a tool error, not an HTTP 500', async () => {
      runObo.mockRejectedValue(new Error('Token exchange failed for ex: invalid_scope'));
      const res = await post(rpc('tools/call', { name: 'act_on_my_behalf' }));
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/invalid_scope/);
    });

    test('a notification (no id) gets 202 with no body', async () => {
      const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(res.status).toBe(202);
    });

    test('an unknown method gets a JSON-RPC method-not-found error', async () => {
      const res = await post(rpc('resources/list'));
      expect(res.body.error.code).toBe(-32601);
    });
  });
});

describe('GET /api/obo/downstream', () => {
  test('401 without a Bearer', async () => {
    expect((await request(app).get('/api/obo/downstream')).status).toBe(401);
  });
  test('passes the verifier result through', async () => {
    verifyDownstream.mockResolvedValue({ status: 200, acting_for: 'u1', acted_by: { client_id: 'A' } });
    const res = await request(app).get('/api/obo/downstream').set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(res.body.acted_by).toEqual({ client_id: 'A' });
  });
});

describe('metadata', () => {
  test('advertises this resource and PingOne as the authorization server', async () => {
    const res = await request(app).get('/.well-known/oauth-protected-resource/api/obo/mcp');
    expect(res.body.resource).toMatch(/\/api\/obo\/mcp$/);
    expect(res.body.authorization_servers).toEqual(['https://iss']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/routes/obo.test.js --forceExit`
Expected: FAIL, "Cannot find module '../../../routes/obo'"

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_server/routes/obo.js
'use strict';
const express = require('express');
const { validateToken } = require('../services/tokenValidationService');
const { getOboConfig } = require('../services/oboConfig');
const { runObo } = require('../services/oboExchangeService');
const { verifyDownstream } = require('../services/oboDownstream');
const hub = require('../services/oboEventHub');

const router = express.Router();

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
const baseUrl = (req) => process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;

function challenge(req, res) {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource/api/obo/mcp"`);
  return res.status(401).json({ error: 'unauthorized' });
}

function metadataHandler(req, res) {
  const cfg = getOboConfig();
  res.json({
    resource: `${baseUrl(req)}/api/obo/mcp`,
    authorization_servers: [cfg.issuer],
    scopes_supported: ['mcp:invoke', 'read'],
    bearer_methods_supported: ['header'],
  });
}

const TOOLS = [{
  name: 'act_on_my_behalf',
  description: 'Calls a downstream API on behalf of the signed-in user using a delegated (RFC 8693) token and reports who acted for whom.',
  inputSchema: { type: 'object', properties: {} },
}];

// What the MODEL sees: claims and status codes only. Withheld entirely if anything token-shaped slipped in.
function toolText(ev) {
  if (ev.leak) return 'withheld: result contained a token';
  return JSON.stringify({
    acting_for: ev.sub,
    acted_by: ev.delegated.act,
    delegated_claims: { sub: ev.delegated.sub, aud: ev.delegated.aud, scope: ev.delegated.scope, act: ev.delegated.act, exp: ev.delegated.exp },
    downstream: ev.downstream,
    checks: ev.checks.map(({ label, pass }) => ({ label, pass })),
  }, null, 2);
}

router.get('/downstream', async (req, res) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const r = await verifyDownstream(token);
  return res.status(r.status).json(r);
});

router.post('/mcp', async (req, res) => {
  const token = bearer(req);
  if (!token) return challenge(req, res);
  const cfg = getOboConfig();
  let caller;
  try {
    caller = await validateToken(token, { jwksUri: cfg.jwksUri, issuer: cfg.issuer, audience: cfg.inboundAudiences });
  } catch (_e) {
    return challenge(req, res);
  }

  const msg = req.body || {};
  if (msg.id === undefined) return res.status(202).end();
  const ok = (result) => res.json({ jsonrpc: '2.0', id: msg.id, result });

  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'obo-demo', version: '1.0.0' } });
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'ping':
      return ok({});
    case 'tools/call':
      try {
        const ev = await runObo({ req, subjectToken: token, source: 'claude' });
        hub.publish(caller.sub, ev);
        return ok({ content: [{ type: 'text', text: toolText(ev) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: `error: ${e.message}` }] });
      }
    default:
      return res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
});

module.exports = { router, metadataHandler };
```

Mount in `demo_api_server/server.js`. Both mounts go **after** line 728 (`hostedAccessGate`) and the `express.json()` at line 618. Add the router mount immediately before `app.use('/api', intentAuthRoutes);` (line 1509) and the metadata route immediately before `app.use('/.well-known/oauth-protected-resource', protectedResourceMetadataRoutes);` (line 1989):

```js
// OBO demo: Claude-facing MCP endpoint + downstream verifier. Self-authenticating (own Bearer check).
const oboRoutes = require('./routes/obo');
app.use('/api/obo', oboRoutes.router);
```
```js
// RFC 9728 metadata for the OBO MCP endpoint (public; must precede the generic handler below).
app.get('/.well-known/oauth-protected-resource/api/obo/mcp', oboRoutes.metadataHandler);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/routes/obo.test.js --forceExit`
Expected: PASS (13 tests)

Then confirm the real app still boots with the mounts: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/agent-api-test.test.js --forceExit` (requires `server.js`). Expected: same result as on `origin/main` (compare against a run from the main checkout if it fails).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/routes/obo.js demo_api_server/server.js demo_api_server/src/__tests__/routes/obo.test.js
git commit -m "feat(obo): MCP endpoint, downstream verifier and RFC 9728 metadata routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hosted-wall bypass and PingOne bootstrap resource

**Files:**
- Modify: `demo_api_server/middleware/hostedAccessGate.js` (add one entry to `EXACT_BYPASSES`, next to the other `'GET /api/...'` entries, around line 40)
- Modify: `demo_api_server/src/__tests__/hostedAccessGate.test.js` (append a describe block)
- Modify: `demo_api_server/services/pingoneProvisionService.js` (new method + one call after the `mayAct-schema` step block that ends near line 2722)
- Test: `demo_api_server/src/__tests__/services/pingoneProvisionObo.test.js`

**Interfaces:**
- Consumes: existing `createResourceServer(name, description, audience)`, `createScopes(resourceId, scopes)`, `_setResourceAttribute(resourceId, name, value)`, `grantScopesToApplication(appId, resourceId, scopeNames)`; `OBO_ACT_SPEL`, `getOboConfig` (Task 1).
- Produces: `PingOneProvisionService.ensureOboDemoResource() -> Promise<{ resourceId, audience }>`; bootstrap pushes a `{ step: 'obo-demo-resource', ... }` step and never aborts on its failure.

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_server/src/__tests__/hostedAccessGate.test.js`:

```js
describe('hostedAccessGate OBO MCP endpoint', () => {
  test('the unauthenticated POST to the MCP endpoint bypasses the wall so it can return the OAuth challenge', () => {
    expect(isHostedAccessBypassPath('/api/obo/mcp', 'POST')).toBe(true);
  });
  test('other OBO paths and methods stay walled', () => {
    expect(isHostedAccessBypassPath('/api/obo/mcp', 'GET')).toBe(false);
    expect(isHostedAccessBypassPath('/api/obo/downstream', 'GET')).toBe(false);
  });
});
```

Find how the existing provisioning tests instantiate the service and stub it:
`grep -rln "pingoneProvisionService" demo_api_server/src/__tests__ | head -3`, then mirror that construction. The new test:

```js
// demo_api_server/src/__tests__/services/pingoneProvisionObo.test.js
'use strict';
// Mirror the import/instantiation used by the nearest existing pingoneProvisionService test.
const svc = require('../../../services/pingoneProvisionService');
const { OBO_ACT_SPEL } = require('../../../services/oboConfig');

function stub() {
  svc.createResourceServer = jest.fn().mockResolvedValue({ resource: { id: 'R1', audience: ['obo-demo.ping.demo'] }, exists: false });
  svc.createScopes = jest.fn().mockResolvedValue([]);
  svc._setResourceAttribute = jest.fn().mockResolvedValue({});
  svc.grantScopesToApplication = jest.fn().mockResolvedValue({ success: true });
}

test('creates the OBO Demo resource with scope, act map-literal attribute, and exchanger grant', async () => {
  stub();
  const out = await svc.ensureOboDemoResource();
  expect(svc.createResourceServer).toHaveBeenCalledWith(expect.stringContaining('OBO Demo'), expect.any(String), 'obo-demo.ping.demo');
  expect(svc.createScopes).toHaveBeenCalledWith('R1', expect.arrayContaining([expect.objectContaining({ name: 'obo:invoke' })]));
  expect(svc._setResourceAttribute).toHaveBeenCalledWith('R1', 'act', OBO_ACT_SPEL);
  expect(svc._setResourceAttribute).not.toHaveBeenCalledWith('R1', 'sub', expect.anything());
  expect(svc.grantScopesToApplication).toHaveBeenCalledWith(expect.any(String), 'R1', ['obo:invoke']);
  expect(out).toEqual({ resourceId: 'R1', audience: 'obo-demo.ping.demo' });
});

test('is idempotent: an existing resource is reused and the attribute is re-applied', async () => {
  stub();
  svc.createResourceServer.mockResolvedValue({ resource: { id: 'R1', audience: ['obo-demo.ping.demo'] }, exists: true });
  await svc.ensureOboDemoResource();
  expect(svc._setResourceAttribute).toHaveBeenCalledTimes(1);
});
```

(Adjust the `require`/instantiation to match the repo's existing provisioning-service tests if the module exports a class rather than an instance. Keep the assertions unchanged.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessGate.test.js src/__tests__/services/pingoneProvisionObo.test.js --forceExit`
Expected: FAIL (bypass is false; `ensureOboDemoResource is not a function`)

- [ ] **Step 3: Write the minimal implementation**

`hostedAccessGate.js`, inside `EXACT_BYPASSES` (add after the `'GET /api/health/demo-status'` entry):

```js
  // OBO demo MCP endpoint: the first, token-less POST must reach the route so it can return the
  // RFC 9728 OAuth challenge. Without this the wall answers a bare hosted_access_required and Claude
  // cannot discover PingOne. Authenticated calls are validated by the route itself.
  'POST /api/obo/mcp',
```

`pingoneProvisionService.js`, new method next to `_setResourceAttribute` (add near line 915, after that method):

```js
  /**
   * Idempotently ensure the persistent "OBO Demo" resource used by the OBO delegation demo:
   * audience obo-demo.ping.demo, scope obo:invoke, an `act` attribute that emits an RFC 8693
   * OBJECT, and a grant of that scope to the Token Exchanger app. `sub` is reserved and
   * added by PingOne automatically, so it is never created here.
   */
  async ensureOboDemoResource() {
    const { getOboConfig, OBO_ACT_SPEL } = require('./oboConfig');
    const cfg = getOboConfig();
    const created = await this.createResourceServer(
      'OBO Demo', 'OBO delegation demo: delegated tokens with an RFC 8693 act object', cfg.audience,
    );
    const resourceId = created.resource.id;
    await this.createScopes(resourceId, [{ name: cfg.scope, description: 'OBO demo delegated access' }]);
    await this._setResourceAttribute(resourceId, 'act', OBO_ACT_SPEL);
    await this.grantScopesToApplication(cfg.exchanger.id, resourceId, [cfg.scope]);
    return { resourceId, audience: cfg.audience };
  }
```

Call it from bootstrap, immediately after the `mayAct-schema` step block (after the `onStep(steps[steps.length - 1]);` that follows its `catch`, near line 2722), using the same step/try-catch shape:

```js
      steps.push({ step: 'obo-demo-resource', icon: '🔧', message: 'Ensuring OBO Demo resource (act object attribute)...' });
      onStep(steps[steps.length - 1]);
      try {
        const obo = await this.ensureOboDemoResource();
        steps.push({ step: 'obo-demo-resource', icon: '✅', message: `OBO Demo resource ready (${obo.audience})` });
      } catch (err) {
        steps.push({ step: 'obo-demo-resource', icon: '⚠️', message: `OBO Demo resource step: ${err.message}` });
      }
      onStep(steps[steps.length - 1]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessGate.test.js src/__tests__/services/pingoneProvisionObo.test.js --forceExit`
Expected: PASS. Then run the existing provisioning suite to confirm no regression: `CI=true npx jest src/__tests__ -t "provision" --forceExit` (expected: same pass/fail set as `origin/main`).

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add demo_api_server/middleware/hostedAccessGate.js demo_api_server/src/__tests__/hostedAccessGate.test.js demo_api_server/services/pingoneProvisionService.js demo_api_server/src/__tests__/services/pingoneProvisionObo.test.js
git commit -m "feat(obo): wall bypass for the MCP challenge and bootstrap OBO Demo resource

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Local live probe, then hosted probe (the gate)

**Files:** none (verification only; record results in the PR description).

This task has no code. Its deliverable is evidence that the build works against real PingOne and, critically, on the hosted site. If the hosted probe fails, stop and report; do not start plan 2.

- [ ] **Step 1: Full suite for the touched areas**

Run: `cd demo_api_server && CI=true ALLOW_TEST_NETWORK=1 npx jest src/__tests__/services/obo src/__tests__/routes/obo.test.js src/__tests__/hostedAccessGate.test.js --forceExit`
Expected: all PASS.
Run: `npm run authz:verify && npm run hygiene:check` from the worktree root. Expected: pass (no new UI routes in this plan, so `auth-requirements.json` is unchanged).

- [ ] **Step 2: Create the PingOne resource (user runs; a grant is involved)**

The user runs the bootstrap step against the demo PingOne environment, or, to avoid a full bootstrap, a one-off call of `ensureOboDemoResource()`. Ask the user which; do not run it from an agent session (the classifier blocks grants). Expected output: `OBO Demo resource ready (obo-demo.ping.demo)`. Verify with the Management API that the resource has scope `obo:invoke` and attribute `act` equal to `${{'client_id': #root.context.requestData.actorToken.client_id}}`.

- [ ] **Step 3: Local run**

Run the BFF from this worktree: `npm run serve:worktree here` (never `docker compose up` from a worktree). Then:

```
claude mcp add --transport http obo-demo https://local.ping-devops.com:4000/api/obo/mcp \
  --client-id c8392dc4-2d82-4e49-92a8-79a78401faf5 --callback-port 7465
```
Always register against the PUBLIC_APP_URL origin; the metadata is served at /api/obo/mcp/oauth-protected-resource because the frontend proxies /api/ but serves the SPA for /.well-known/. In `claude`: `/mcp` -> authenticate -> sign in as demoUser -> ask: "Call the act_on_my_behalf tool and show me its result."
Expected tool text: `acted_by` is `{"client_id": "f65664b2-..."}`, `downstream` is `{"delegated":200,"userToken":401}`, all 7 `checks` pass, no `eyJ` anywhere.
If `inbound_rejected`/401 appears, read the BFF log: the likely cause is the inbound audience. Claude's token carried `mcpgateway.ping.demo` in the earlier test; set `OBO_INBOUND_AUDIENCES` to the audience actually present (decode the token locally, never paste it) rather than loosening validation.

- [ ] **Step 4: Hosted probe (the gate)**

Only with the user naming the SE target explicitly. Focused BFF deploy per `docs/worktree-and-stack.md` (`./run-pingaws.sh` flow for `se-update-code.sh`, BFF only, then `kubectl set image` to the pinned sha, and verify the pod's imageID digest). Then:
1. Unauthenticated check: `curl -si -X POST https://ai-demo.ping-devops.com/api/obo/mcp -d '{}' -H 'content-type: application/json'` must return `401` with a `WWW-Authenticate: Bearer resource_metadata=...` header (NOT `{"error":"hosted_access_required"}`).
2. `curl -s https://ai-demo.ping-devops.com/api/obo/mcp/oauth-protected-resource` must return JSON naming the PingOne issuer.
3. Register `https://ai-demo.ping-devops.com/api/obo/mcp` the same way as Step 3, authenticate, call the tool. Expected: same result as local.

- [ ] **Step 5: Record the gate decision**

In the PR description, record: local result, hosted unauthenticated-401 header, hosted tool result (claims only), and the final value of `OBO_INBOUND_AUDIENCES` that worked. If hosted failed, state exactly where (wall, ingress, PingOne audience, or Claude's login) and stop for a decision on Approach B.
Then push and open the PR (the user merges; the classifier blocks `gh pr merge`, so hand over the exact command).

---

## Self-Review

**Spec coverage:** S1 (7 checks) = Task 1+3; S2 (clean machine, `claude mcp add`) = Task 6; S3 (live within 2s, same user only) = hub in Task 2, publish in Task 4; the `/api/obo/events` SSE route and the page are **plan 2** by design; S4 (no token anywhere) = leak scan (Task 1), tool text (Task 4), error path (Task 3). Architecture sections 1, 2 (except `/api/obo/run`, `/api/obo/events`: plan 2), 3, 5 and 6's bypass/ingress items are covered; section 4 (page, diagram, Learning Hub) and `auth-requirements.json`/e2e seed are plan 2 because they belong to the new SPA route. Spec open questions: inbound audiences (Task 1 config + Task 6 evidence), hub reuse (resolved: separate small hub, Task 2), actor-token minting (resolved: `getAgentCCToken` accepts `clientId/clientSecret/scope/authMethod` overrides, Task 3).

**Placeholders:** none. One instruction defers to the repo ("mirror the nearest provisioning test's construction") because the module's export shape was not read; assertions are fully specified.

**Type consistency:** `Evidence`, `runObo`, `verifyDownstream`, `publish/subscribe`, `getOboConfig`, check ids (`sub-preserved`, `act-object`, `different-token`, `aud-differs`, `downstream-accepts-delegated`, `downstream-refuses-user`, `no-token-leak`) match across tasks. `performTokenExchangeAs` auth method `'post'` is asserted only in the live probe; if PingOne's Token Exchanger app rejects it, switch to `'basic'` (the app is CLIENT_SECRET_POST per the Management API, so `'post'` is expected to work).
