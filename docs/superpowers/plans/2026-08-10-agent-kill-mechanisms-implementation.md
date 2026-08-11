# Agent kill mechanisms — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a session's "Stop Agent" click actually block that session's next
MCP tool call at the real, live authorization gate — it currently does not —
and add a lightweight active-run audit trail so the kill confirm modal can
say what it's about to stop instead of guessing.

**Architecture:** A single new key-derivation helper
(`deriveAgentKey(req, explicitAgentId)`) becomes the one source of truth for
"what is the enforcement key for this caller," used both by the kill route
that writes the revoked flag and — the actual fix — by
`evaluateMcpFirstToolGate`, the real PingOne-Authorize-backed gate every MCP
tool call already passes through, which today has zero kill-switch
awareness. A second, independent LMDB-backed registry
(`agentRunRegistry.js`) records active tool-call runs so the confirm modal
can show "this will stop: reorder, started 4s ago" before the operator
commits. Everything not implementable in this pass (mid-flight abort,
SpiceDB-based kill authorization, full SSF/CAEP cross-system transport)
becomes a new Learning Hub education page instead of code.

**Tech Stack:** Node 22 CommonJS (Express, Jest+supertest) for the server;
React 19 + Vitest for the UI. No new dependencies.

## Global Constraints

- Error responses use `{ error }` (root `demo_api_server/CLAUDE.md`).
- Upstream/axios errors go through `normalizeAxiosError`, never leak raw.
- UI HTTP calls go through `apiClient`, never raw `axios`/bare `fetch` for
  JSON (an `EventSource` for SSE is the one exception already in this file).
- Modals are `DraggableModal`/`ConfirmModal` only.
- `CI=true` is mandatory for server test runs; UI verification is
  `npm run test:unit && npm run build`.
- Emoji allowlist: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` — none needed in this plan's
  code, but the existing Learning Hub icons in `LearningHub.tsx` are outside
  that allowlist already (pre-existing, not this plan's concern — don't
  touch other rows).
- Everything here runs inside the mandatory worktree
  (`.claude/worktrees/killswitch-usecases-demosteps`), per root CLAUDE.md.

---

## File structure

```
demo_api_server/
  services/
    sessionKeyService.js          NEW — deriveAgentKey(req, explicitAgentId)
    agentRunRegistry.js           NEW — startRun/endRun/listActiveRuns (LMDB)
    mcpToolAuthorizationService.js  MODIFY — kill-check inside evaluateMcpFirstToolGate
    bffMcpToolExecutor.js         MODIFY — wrap 3 runMcpToolPipeline call sites
    killSwitchService.js          unchanged (isAgentRevoked/killAgent keep their signature)
  routes/
    admin.js                      MODIFY — deriveAgentKey in kill-switch/status/re-enable routes; NEW active-runs GET
  middleware/
    agentRateLimit.js             DELETE — dead code, never mounted, reads a nonexistent field
  tests/
    sessionKeyService.test.js     NEW
    agentRunRegistry.test.js      NEW
    mcpToolAuthorization.killSwitch.test.js  NEW

demo_api_ui/
  src/
    components/
      KillSwitchConfirmModal.jsx  MODIFY — fetch+show active runs; fix stale "agentRateLimit" copy
      KillSwitchConfirmModal.css  MODIFY — small `.ksm-active-runs` block
      education/
        KillSwitchMechanismsPanel.js  NEW
        educationIds.js          MODIFY — add EDU.KILL_SWITCH
        EducationPanelsHost.js   MODIFY — register the new panel
      LearningHub.tsx            MODIFY — add one category item
      components/__tests__/KillSwitchConfirmModal.activeRuns.test.jsx  NEW
```

---

## Task 1: `deriveAgentKey` — the shared enforcement-key resolver

**Files:**
- Create: `demo_api_server/services/sessionKeyService.js`
- Test: `demo_api_server/tests/sessionKeyService.test.js`

**Interfaces:**
- Produces: `deriveAgentKey(req, explicitAgentId)` → `string`. `req` needs
  only `req.sessionID`. `explicitAgentId` may be `null`/`undefined`/empty/a
  real id/one of the two known placeholder labels the UI already sends
  (`"default-agent"` from `App.js:351`'s `openAdminStopAgent`, `"demo-agent"`
  from `ControlPlaneRoster.jsx:152`'s no-live-agent fallback). Both
  placeholders are treated as "no real id" — this is a value-level check
  against two literal, already-shipped strings, not a route inference, so no
  UI file changes are needed.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/sessionKeyService.test.js
const { deriveAgentKey } = require('../services/sessionKeyService');

describe('deriveAgentKey', () => {
  test('a real explicit id is returned as-is', () => {
    expect(deriveAgentKey({ sessionID: 's1' }, 'ai-banking-agent-client-id'))
      .toBe('ai-banking-agent-client-id');
  });

  test('the "default-agent" UI placeholder falls back to a session key', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, 'default-agent');
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });

  test('the "demo-agent" UI placeholder falls back to a session key', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, 'demo-agent');
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });

  test('no explicit id falls back to a session key', () => {
    const key = deriveAgentKey({ sessionID: 'sess-abc' }, null);
    expect(key).toMatch(/^session:[0-9a-f]{16}$/);
  });

  test('same session id always derives the same key', () => {
    const a = deriveAgentKey({ sessionID: 'sess-xyz' }, undefined);
    const b = deriveAgentKey({ sessionID: 'sess-xyz' }, '');
    expect(a).toBe(b);
  });

  test('different session ids derive different keys', () => {
    const a = deriveAgentKey({ sessionID: 'sess-1' }, null);
    const b = deriveAgentKey({ sessionID: 'sess-2' }, null);
    expect(a).not.toBe(b);
  });

  test('no session at all resolves to a stable anonymous label, never throws', () => {
    expect(deriveAgentKey({}, null)).toBe('session:anonymous');
    expect(deriveAgentKey(null, null)).toBe('session:anonymous');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/sessionKeyService.test.js`
Expected: FAIL — `Cannot find module '../services/sessionKeyService'`

- [ ] **Step 3: Write minimal implementation**

```js
// demo_api_server/services/sessionKeyService.js
'use strict';

const crypto = require('crypto');

/**
 * The UI still sends these two literal strings from call sites that have no
 * real per-agent id (App.js:351 openAdminStopAgent → "default-agent",
 * ControlPlaneRoster.jsx:152 no-live-agent fallback → "demo-agent"). Treating
 * them as absent here — rather than editing four already-shipped UI files —
 * is the caller-side choice the kill-mechanisms design spec calls for.
 */
const PLACEHOLDER_AGENT_IDS = new Set(['default-agent', 'demo-agent']);

/**
 * Resolve the key every kill-switch enforcement check and every kill-switch
 * write uses for "which agent." A real explicit id (when the caller has one,
 * e.g. ControlPlaneRoster's live.id) wins. Otherwise this falls back to a
 * key scoped to the caller's own session, so two different users clicking
 * "Stop Agent" on a shared-label surface no longer collide (the bug this
 * exists to fix — see docs/superpowers/specs/2026-08-10-agent-kill-mechanisms-design.md).
 * @param {{sessionID?: string}|null|undefined} req
 * @param {string|null|undefined} explicitAgentId
 * @returns {string}
 */
function deriveAgentKey(req, explicitAgentId) {
  const explicit = explicitAgentId && !PLACEHOLDER_AGENT_IDS.has(explicitAgentId)
    ? String(explicitAgentId).trim()
    : '';
  if (explicit) return explicit;

  const sessionID = req && req.sessionID;
  if (!sessionID) return 'session:anonymous';

  const hash = crypto.createHash('sha256').update(sessionID).digest('hex').slice(0, 16);
  return `session:${hash}`;
}

module.exports = { deriveAgentKey };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/sessionKeyService.test.js`
Expected: PASS, 7/7

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/sessionKeyService.js demo_api_server/tests/sessionKeyService.test.js
git commit -m "feat(kill-switch): add deriveAgentKey, the shared session-scoped enforcement key"
```

---

## Task 2: Wire the kill-switch into the REAL enforcement gate

This is the core fix. Today `isAgentRevoked` is read in exactly one place —
the kill route's own duplicate-click guard — so a killed agent's *next*
tool call is never actually rejected anywhere. `evaluateMcpFirstToolGate`
(`services/mcpToolAuthorizationService.js:917`) is the function every real
MCP tool call passes through (PingOne Authorize / P1AZ). It already has an
established pattern for a hard block right at the top — the
`delegatedConsent.status === 'revoked'` check just below the token-presence
guard, returning `{ ran: true, block: { status: 403, body: {...} } }`. The
kill-check joins it there, before the (comparatively expensive)
`buildMcpFirstToolGateInputs` call, so a killed agent's calls are rejected
cheaply and don't trigger wasted HITL/PDP work.

**Files:**
- Modify: `demo_api_server/services/mcpToolAuthorizationService.js:917-936`
- Test: `demo_api_server/tests/mcpToolAuthorization.killSwitch.test.js`

**Interfaces:**
- Consumes: `deriveAgentKey(req, explicitAgentId)` from Task 1;
  `killSwitchService.isAgentRevoked(agentId)` (existing, unchanged);
  `decodeJwtClaims(token)` from `./agentMcpTokenService` (already imported
  at the top of this file, line 15).
- Produces: no new exports — the block shape
  `{ ran: true, block: { status: 403, body: { error: 'agent_killed', ... } } }`
  is consumed the same way every other `evaluateMcpFirstToolGate` block
  already is, by `mcpToolPipeline.js:463`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/mcpToolAuthorization.killSwitch.test.js
/**
 * A killed agent's next MCP tool call must be rejected at the real gate
 * (evaluateMcpFirstToolGate), not just at the kill route's own duplicate-
 * click guard. Before this fix, isAgentRevoked was read nowhere on the
 * actual tool-call path.
 */
jest.mock('../services/killSwitchService', () => ({
  isAgentRevoked: jest.fn(),
}));
jest.mock('../services/delegatedCommerceRuntime', () => ({
  resolveConsentContext: jest.fn(() => null),
}));

const killSwitchService = require('../services/killSwitchService');
const { evaluateMcpFirstToolGate } = require('../services/mcpToolAuthorizationService');

// header.payload.sig — decodeJwtClaims only base64url-decodes, no signature check needed for this test.
function fakeToken(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

describe('evaluateMcpFirstToolGate — kill switch enforcement', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a killed agent is blocked with 403 agent_killed, before any PDP work', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(true);
    const req = { sessionID: 'sess-1', session: {} };
    const agentToken = fakeToken({ sub: 'ai-agent-client-1' });

    const out = await evaluateMcpFirstToolGate({ req, tool: 'create_transfer', agentToken });

    expect(out.ran).toBe(true);
    expect(out.block.status).toBe(403);
    expect(out.block.body.error).toBe('agent_killed');
    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith('ai-agent-client-1');
  });

  test('an act-delegated token is checked under its actor id, not the subject', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(true);
    const req = { sessionID: 'sess-1', session: {} };
    const agentToken = fakeToken({ sub: 'end-user-1', act: { sub: 'ai-agent-client-2' } });

    await evaluateMcpFirstToolGate({ req, tool: 'create_transfer', agentToken });

    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith('ai-agent-client-2');
  });

  test('a non-killed agent is not blocked by this check', async () => {
    killSwitchService.isAgentRevoked.mockResolvedValueOnce(false);
    const req = { sessionID: 'sess-1', session: {} };
    const agentToken = fakeToken({ sub: 'ai-agent-client-1' });

    const out = await evaluateMcpFirstToolGate({ req, tool: 'create_transfer', agentToken });

    // Falls through past the kill-check into real gate logic, which requires
    // config this unit test doesn't set up — asserting it did NOT take the
    // kill-check's block branch is the relevant behavior here.
    expect(out.block?.body?.error).not.toBe('agent_killed');
  });

  test('no token short-circuits before the kill-check ever runs', async () => {
    const out = await evaluateMcpFirstToolGate({ req: {}, tool: 'create_transfer', agentToken: null });
    expect(out).toEqual({ ran: false, reason: 'no_agent_token', skipReason: 'no_agent_token' });
    expect(killSwitchService.isAgentRevoked).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/mcpToolAuthorization.killSwitch.test.js`
Expected: FAIL — first two tests get a non-`agent_killed` result (the check doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

In `demo_api_server/services/mcpToolAuthorizationService.js`, add the import
near the other service requires (around line 31, next to
`resolveConsentContext`):

```js
const { deriveAgentKey } = require('./sessionKeyService');
const killSwitchService = require('./killSwitchService');
```

Then in `evaluateMcpFirstToolGate` (line 917-936 today), insert the
kill-check between the token-presence guard and the `delegatedConsent`
block:

```js
async function evaluateMcpFirstToolGate(opts) {
  const { req, tool, agentToken } = opts;
  if (!agentToken || typeof agentToken !== 'string') {
    return { ran: false, reason: 'no_agent_token', skipReason: 'no_agent_token' };
  }

  // Kill switch: block before any PDP/HITL work if this agent was stopped.
  // Deliberately NOT decodeMcpTokenFacts (below) — that also does a JWKS
  // hasKid lookup this check doesn't need, and it must run on every tool
  // call, not just once per request already inside buildMcpFirstToolGateInputs.
  const _killClaims = decodeJwtClaims(agentToken)?.claims || {};
  const _actorId = _killClaims.act && typeof _killClaims.act === 'object'
    ? String(_killClaims.act.client_id || _killClaims.act.sub || '')
    : '';
  const _agentIdentity = _actorId || (_killClaims.sub ? String(_killClaims.sub) : null);
  const _agentKey = deriveAgentKey(req, _agentIdentity);
  if (await killSwitchService.isAgentRevoked(_agentKey)) {
    return {
      ran: true,
      block: {
        status: 403,
        body: {
          error: 'agent_killed',
          error_description: 'This agent was stopped via the kill switch and cannot make further tool calls.',
          decisionContext: 'McpFirstTool',
          agentId: _agentKey,
        },
      },
    };
  }

  const delegatedConsent = resolveConsentContext(req, tool);
  // ...unchanged from here
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/mcpToolAuthorization.killSwitch.test.js`
Expected: PASS, 4/4

- [ ] **Step 5: Run the full existing suite for this file to confirm no regression**

Run: `cd demo_api_server && CI=true npx jest mcpToolAuthorization --maxWorkers=4`
Expected: PASS (existing amountFromRecord and transactionPolicyHitl suites unaffected — the new check only fires when `killSwitchService.isAgentRevoked` resolves `true`, which the real service does only after an actual kill)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/mcpToolAuthorizationService.js demo_api_server/tests/mcpToolAuthorization.killSwitch.test.js
git commit -m "fix(kill-switch): enforce isAgentRevoked in the real MCP tool-call gate

evaluateMcpFirstToolGate had zero kill-switch awareness — the only code
path that read isAgentRevoked was the kill route's own duplicate-click
guard. A killed agent's next tool call was never actually rejected."
```

---

## Task 3: Route the kill-switch's own reads/writes through `deriveAgentKey`

Without this, the kill route still writes the revoked flag under the raw
`req.params.agentId` (e.g. the literal string `"default-agent"`), while
Task 2's check reads it under the *derived* key — they'd disagree and the
kill would silently do nothing for the generic UI call sites.

**Files:**
- Modify: `demo_api_server/routes/admin.js:871-940` (POST kill-switch),
  `:942-973` (POST re-enable — read via the file, exact lines may shift
  slightly after the kill-switch edit), `:979-1002` (GET status)

**Interfaces:**
- Consumes: `deriveAgentKey` from Task 1.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/adminKillSwitchRoute.derivedKey.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../services/killSwitchService', () => ({
  isAgentRevoked: jest.fn().mockResolvedValue(false),
  killAgent: jest.fn().mockResolvedValue({
    revoked_at: '2026-08-10T00:00:00.000Z', state_snapshot_id: 'snap-1',
    time_to_revoke_ms: 5, scope: 'instance', steps: [],
  }),
}));

const killSwitchService = require('../services/killSwitchService');
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.sessionID = 'sess-fixed';
    req.session = { user: { id: 'u1' }, destroy: (cb) => cb() };
    next();
  });
  app.use('/api/admin', adminRouter);
  return app;
}

describe('POST /agent/:agentId/kill-switch uses the derived session key, not the raw placeholder', () => {
  test('the "default-agent" placeholder resolves to the same key the gate would derive', async () => {
    const { deriveAgentKey } = require('../services/sessionKeyService');
    const expectedKey = deriveAgentKey({ sessionID: 'sess-fixed' }, 'default-agent');

    await request(buildApp())
      .post('/api/admin/agent/default-agent/kill-switch')
      .send({ reason: 'test', scope: 'instance' });

    expect(killSwitchService.killAgent).toHaveBeenCalledWith(
      expectedKey, 'test', 'u1', null, 'instance', 'sess-fixed',
    );
    expect(killSwitchService.isAgentRevoked).toHaveBeenCalledWith(expectedKey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/adminKillSwitchRoute.derivedKey.test.js`
Expected: FAIL — `killAgent` called with `'default-agent'`, not the derived `session:<hash>` key

- [ ] **Step 3: Write minimal implementation**

Add the import near the other service requires in `routes/admin.js`
(alongside line 848's `killSwitchService` require):

```js
const { deriveAgentKey } = require('../services/sessionKeyService');
```

In the POST `/agent/:agentId/kill-switch` handler, replace:

```js
const { agentId } = req.params;
```

with:

```js
const agentId = deriveAgentKey(req, req.params.agentId);
```

(Keep the existing `!agentId || typeof agentId !== 'string'` validation —
it still runs on the *derived* key now, which is always truthy per Task 1,
so that branch simply never triggers for this route again; leave it in
place as defense-in-depth, don't remove it.)

Apply the identical one-line swap in the GET `/agent/:agentId/status`
handler (`const { agentId } = req.params` → `const agentId =
deriveAgentKey(req, req.params.agentId)`) and in the POST
`/agent/:agentId/re-enable` handler wherever it reads `req.params.agentId`
for the enforcement key.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/adminKillSwitchRoute.derivedKey.test.js`
Expected: PASS

- [ ] **Step 5: Run the full server suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
Expected: PASS (no other suite asserts on the raw `req.params.agentId` string reaching `killAgent`/`isAgentRevoked` — confirm by reading any failure, not by assuming)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/admin.js demo_api_server/tests/adminKillSwitchRoute.derivedKey.test.js
git commit -m "fix(kill-switch): route kill/status/re-enable through deriveAgentKey

Keeps the route's read/write key in sync with the enforcement check added
in evaluateMcpFirstToolGate — otherwise a kill on the shared 'default-agent'
label would write a key the real gate never reads."
```

---

## Task 4: Delete the dead `agentRateLimit` middleware

Confirmed via repo-wide grep: zero `require`s of this file anywhere, and it
is not mounted in `server.js` or any route. Its own `isAgentRevoked` check
reads `req.user?.client_id`, a field that does not exist anywhere `req.user`
is built (`middleware/auth.js`); the real actor id lives at
`req.user.actor.sub`. Task 2 replaces whatever this file was meant to do.
Leaving it in place would let a future engineer mount it, believe it works,
and get a silent no-op (the missing-field guard falls through to `next()`
unconditionally).

**Files:**
- Delete: `demo_api_server/middleware/agentRateLimit.js`

- [ ] **Step 1: Confirm zero references (repeat the check before deleting)**

Run: `cd demo_api_server && grep -rn "agentRateLimit" --include="*.js" . | grep -v node_modules`
Expected: only the file's own internal lines (or no output once it's gone)

- [ ] **Step 2: Delete the file**

```bash
git rm demo_api_server/middleware/agentRateLimit.js
```

- [ ] **Step 3: Run the full server suite to confirm nothing referenced it**

Run: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
Expected: PASS — same pass count as before this task (no suite imports this file; deleting it should change nothing)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(kill-switch): delete agentRateLimit middleware — dead, unmounted, reads a nonexistent field

Never required anywhere in the app. Its isAgentRevoked check read
req.user.client_id, which middleware/auth.js never sets (the real id is
req.user.actor.sub) — even if mounted it would have been a silent no-op.
Task 2 wires the real enforcement point instead."
```

---

## Task 5: `agentRunRegistry` — the active-run audit trail

Standalone LMDB-backed module, no dependency on Tasks 1-4. Uses the same
`getDb(name)` factory `services/lmdb/openEnv.js` already exposes for
`conversations`/`navConfigs` (`services/lmdb/openEnv.js:29-32`) — a new
named db, `agentRuns`, not a repurposing of the express-session Store.

**Files:**
- Create: `demo_api_server/services/agentRunRegistry.js`
- Test: `demo_api_server/tests/agentRunRegistry.test.js`

**Interfaces:**
- Consumes: `getDb('agentRuns')` from `./lmdb/openEnv`.
- Produces: `startRun(agentKey, { tool, userId })` → `string` (runId,
  `crypto.randomUUID()`); `endRun(runId)` → `void`; `listActiveRuns(agentKey)`
  → `Array<{ runId, tool, userId, startedAt }>`, newest first, expired
  entries excluded.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/agentRunRegistry.test.js
// LMDB_PATH is overridden to an isolated dir in tests/setup.js — see
// services/lmdb/openEnv.js's own comment on that env var.
const { startRun, endRun, listActiveRuns } = require('../services/agentRunRegistry');

describe('agentRunRegistry', () => {
  test('a started run appears in listActiveRuns for its own agentKey', async () => {
    const runId = startRun('agent-a', { tool: 'reorder', userId: 'u1' });
    const active = listActiveRuns('agent-a');
    expect(active.some((r) => r.runId === runId && r.tool === 'reorder')).toBe(true);
    endRun(runId);
  });

  test('endRun removes it', () => {
    const runId = startRun('agent-b', { tool: 'create_transfer', userId: 'u2' });
    endRun(runId);
    expect(listActiveRuns('agent-b').some((r) => r.runId === runId)).toBe(false);
  });

  test('listActiveRuns is scoped to its own agentKey', () => {
    const runId = startRun('agent-c', { tool: 'pay_bill', userId: 'u3' });
    expect(listActiveRuns('agent-d')).toEqual([]);
    endRun(runId);
  });

  test('an unknown runId is a safe no-op', () => {
    expect(() => endRun('not-a-real-run-id')).not.toThrow();
  });

  test('newest run for an agentKey sorts first', async () => {
    const first = startRun('agent-e', { tool: 'reorder', userId: 'u1' });
    await new Promise((r) => setTimeout(r, 5));
    const second = startRun('agent-e', { tool: 'checkout', userId: 'u1' });
    const active = listActiveRuns('agent-e');
    expect(active[0].runId).toBe(second);
    expect(active[1].runId).toBe(first);
    endRun(first); endRun(second);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/agentRunRegistry.test.js`
Expected: FAIL — `Cannot find module '../services/agentRunRegistry'`

- [ ] **Step 3: Write minimal implementation**

```js
// demo_api_server/services/agentRunRegistry.js
'use strict';

const crypto = require('crypto');
const { getDb } = require('./lmdb/openEnv');

const DB_NAME = 'agentRuns';
// Safety net for a crashed process that never reaches endRun — matches the
// TTL approach killSwitchService already uses for the revoked flag.
const RUN_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let _cleanupStarted = false;
function _startCleanup() {
  if (_cleanupStarted) return;
  _cleanupStarted = true;
  const interval = setInterval(() => {
    const db = getDb(DB_NAME);
    const now = Date.now();
    for (const { key, value } of db.getRange()) {
      if (value.expiresAt <= now) db.removeSync(key);
    }
  }, CLEANUP_INTERVAL_MS);
  if (interval.unref) interval.unref();
}

/**
 * Record that a tool call started, for the kill-switch confirm modal's
 * active-run list. Best-effort: an LMDB write failure here must never block
 * the tool call itself (see error-handling note in the design spec), so
 * this never throws — it returns null on failure, which endRun treats as a
 * safe no-op.
 * @param {string} agentKey - from sessionKeyService.deriveAgentKey
 * @param {{tool: string, userId: string|null}} info
 * @returns {string|null} runId, or null if the write failed
 */
function startRun(agentKey, { tool, userId }) {
  try {
    _startCleanup();
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    getDb(DB_NAME).putSync(runId, { agentKey, tool, userId: userId || null, startedAt, expiresAt: startedAt + RUN_TTL_MS });
    return runId;
  } catch (_e) {
    return null;
  }
}

/**
 * @param {string|null} runId
 */
function endRun(runId) {
  if (!runId) return;
  try {
    getDb(DB_NAME).removeSync(runId);
  } catch (_e) {
    // Unknown/already-removed runId, or a store error — safe no-op, never throws into a tool call.
  }
}

/**
 * @param {string} agentKey
 * @returns {Array<{runId: string, tool: string, userId: string|null, startedAt: number}>}
 */
function listActiveRuns(agentKey) {
  const db = getDb(DB_NAME);
  const now = Date.now();
  const out = [];
  for (const { key, value } of db.getRange()) {
    if (value.expiresAt <= now) continue;
    if (value.agentKey !== agentKey) continue;
    out.push({ runId: key, tool: value.tool, userId: value.userId, startedAt: value.startedAt });
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

module.exports = { startRun, endRun, listActiveRuns };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/agentRunRegistry.test.js`
Expected: PASS, 5/5

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentRunRegistry.js demo_api_server/tests/agentRunRegistry.test.js
git commit -m "feat(kill-switch): add agentRunRegistry, LMDB-backed active-run audit trail"
```

---

## Task 6: Hook `agentRunRegistry` into real tool execution

There is exactly one function every MCP tool call funnels through —
`runMcpToolPipeline(ctx)` — but it is a ~1300-line function with 20+ return
points, too large and too close to `REGRESSION_PLAN.md` §1 protected
territory to safely instrument internally. It has exactly **three** callers,
all in `bffMcpToolExecutor.js`, each a single `await`/`return` of
`runMcpToolPipeline(ctx)`. Wrapping at those three call sites (start before,
end in a `finally` after) is the minimal, low-risk seam — one registry
entry per tool call, regardless of which internal path the pipeline takes.

**Files:**
- Modify: `demo_api_server/services/bffMcpToolExecutor.js:238`,
  `:316-332` (`runPipelineForSim`), `:381`
  (`executeBffToolWithToken`)
- Test: extend `demo_api_server/tests/agentRunRegistry.test.js` is NOT
  enough here (that file is a pure unit test) — add integration assertions
  to whichever existing `bffMcpToolExecutor` test file already mocks
  `runMcpToolPipeline` (confirm the exact filename first — do not guess; if
  none exists, create `demo_api_server/tests/bffMcpToolExecutor.runRegistry.test.js`
  following the `jest.mock('../services/mcpToolPipeline', ...)` pattern used
  elsewhere in this codebase for this module).

**Interfaces:**
- Consumes: `deriveAgentKey(req, null)` from Task 1 (session-scoped only at
  this layer — no MCP token is resolved yet at the point `ctx` is built, so
  there is no `explicitAgentId` available here); `startRun`/`endRun` from
  Task 5.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/bffMcpToolExecutor.runRegistry.test.js
jest.mock('../services/mcpToolPipeline', () => ({
  runMcpToolPipeline: jest.fn().mockResolvedValue({ kind: 'result', httpStatus: 200, body: { result: 'ok' } }),
}));
jest.mock('../services/agentRunRegistry', () => ({
  startRun: jest.fn().mockReturnValue('run-fixed-1'),
  endRun: jest.fn(),
}));

const { runMcpToolPipeline } = require('../services/mcpToolPipeline');
const agentRunRegistry = require('../services/agentRunRegistry');
const { setPipelineDeps, executeBffTool } = require('../services/bffMcpToolExecutor');

describe('bffMcpToolExecutor — active-run registry bracketing', () => {
  beforeEach(() => jest.clearAllMocks());

  test('executeBffTool starts a run before the pipeline call and ends it after', async () => {
    setPipelineDeps({});
    const req = { sessionID: 'sess-1', session: { user: { id: 'u1' } } };
    await executeBffTool({ name: 'reorder', args: {}, req, userToken: 't', sessionId: 'sess-1', tokenEvents: [] });

    expect(agentRunRegistry.startRun).toHaveBeenCalledWith(
      expect.stringMatching(/^session:[0-9a-f]{16}$/),
      { tool: 'reorder', userId: 'u1' },
    );
    expect(agentRunRegistry.endRun).toHaveBeenCalledWith('run-fixed-1');
    const startOrder = agentRunRegistry.startRun.mock.invocationCallOrder[0];
    const pipelineOrder = runMcpToolPipeline.mock.invocationCallOrder[0];
    const endOrder = agentRunRegistry.endRun.mock.invocationCallOrder[0];
    expect(startOrder).toBeLessThan(pipelineOrder);
    expect(endOrder).toBeGreaterThan(pipelineOrder);
  });

  test('endRun still fires when the pipeline call throws', async () => {
    runMcpToolPipeline.mockRejectedValueOnce(new Error('boom'));
    setPipelineDeps({});
    const req = { sessionID: 'sess-2', session: { user: { id: 'u2' } } };
    await expect(
      executeBffTool({ name: 'create_transfer', args: {}, req, userToken: 't', sessionId: 'sess-2', tokenEvents: [] }),
    ).rejects.toThrow('boom');
    expect(agentRunRegistry.endRun).toHaveBeenCalledWith('run-fixed-1');
  });
});
```

Note: confirm `executeBffTool`'s exact exported name and parameter shape
against the real file before finalizing this test — the plan above mirrors
the signature visible in `bffMcpToolExecutor.js:45-90` and the `ctx` build
at `:201-238`, but re-read that section at implementation time rather than
trusting this plan's paraphrase, since the file is large and this section
was read in excerpts.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/bffMcpToolExecutor.runRegistry.test.js`
Expected: FAIL — `startRun`/`endRun` never called

- [ ] **Step 3: Write minimal implementation**

Add near the top of `bffMcpToolExecutor.js`, with the other requires:

```js
const { deriveAgentKey } = require('./sessionKeyService');
const agentRunRegistry = require('./agentRunRegistry');
```

In `executeBffTool` (around line 238), replace:

```js
const outcome = await runMcpToolPipeline(ctx);
```

with:

```js
const _agentKey = deriveAgentKey(effectiveReq, null);
const _runId = agentRunRegistry.startRun(_agentKey, { tool: name, userId: effectiveReq.session?.user?.id || null });
let outcome;
try {
  outcome = await runMcpToolPipeline(ctx);
} finally {
  agentRunRegistry.endRun(_runId);
}
```

In `runPipelineForSim` (around line 316-332), replace the bare:

```js
return runMcpToolPipeline(ctx);
```

with:

```js
const _agentKey = deriveAgentKey(req, null);
const _runId = agentRunRegistry.startRun(_agentKey, { tool, userId: req.session?.user?.id || null });
try {
  return await runMcpToolPipeline(ctx);
} finally {
  agentRunRegistry.endRun(_runId);
}
```

In `executeBffToolWithToken` (around line 381), apply the same wrap as
`executeBffTool`, keyed off `effectiveReq`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/bffMcpToolExecutor.runRegistry.test.js`
Expected: PASS, 2/2

- [ ] **Step 5: Run the full server suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
Expected: PASS — `bffMcpToolExecutor`'s existing tests mock `runMcpToolPipeline`
already, so the new bracketing is transparent to them; if any fails, read
why rather than assuming this task caused it (`verify-ai-demo2` skill: a
different disjoint set can fail under `--maxWorkers` load — re-run any
failure in isolation first)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/bffMcpToolExecutor.js demo_api_server/tests/bffMcpToolExecutor.runRegistry.test.js
git commit -m "feat(kill-switch): bracket real tool execution with agentRunRegistry start/end"
```

---

## Task 7: Active-runs endpoint + confirm-modal UI

**Files:**
- Modify: `demo_api_server/routes/admin.js` (new GET route, near the
  existing kill-switch routes)
- Modify: `demo_api_ui/src/components/KillSwitchConfirmModal.jsx`
- Modify: `demo_api_ui/src/components/KillSwitchConfirmModal.css`
- Test (server): `demo_api_server/tests/adminActiveRuns.test.js`
- Test (UI): `demo_api_ui/src/components/__tests__/KillSwitchConfirmModal.activeRuns.test.jsx`

**Interfaces:**
- Consumes: `deriveAgentKey` (Task 1), `agentRunRegistry.listActiveRuns`
  (Task 5).
- Produces: `GET /api/admin/agent/:agentId/active-runs` →
  `{ runs: Array<{ runId, tool, startedAt }> }` (userId deliberately
  omitted from the response — the modal shows this to whoever is about to
  click kill, who does not need another user's id, only that something is
  running).

### 7a — server route

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/adminActiveRuns.test.js
const request = require('supertest');
const express = require('express');

jest.mock('../services/agentRunRegistry', () => ({
  listActiveRuns: jest.fn(),
}));
const agentRunRegistry = require('../services/agentRunRegistry');
const adminRouter = require('../routes/admin');

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    req.sessionID = 'sess-fixed';
    req.session = { user: { id: 'u1' } };
    next();
  });
  app.use('/api/admin', adminRouter);
  return app;
}

describe('GET /agent/:agentId/active-runs', () => {
  test('returns runs for the derived key, without userId', async () => {
    agentRunRegistry.listActiveRuns.mockReturnValueOnce([
      { runId: 'r1', tool: 'reorder', userId: 'u1', startedAt: 1000 },
    ]);
    const res = await request(buildApp()).get('/api/admin/agent/default-agent/active-runs');
    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([{ runId: 'r1', tool: 'reorder', startedAt: 1000 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/adminActiveRuns.test.js`
Expected: FAIL — 404, route doesn't exist

- [ ] **Step 3: Write minimal implementation**

Add to `routes/admin.js`, near the other kill-switch routes, after the
imports added in Task 3:

```js
const agentRunRegistry = require('../services/agentRunRegistry');

/**
 * GET /api/admin/agent/:agentId/active-runs
 * What the kill-switch confirm modal shows before the operator commits.
 * userId is deliberately stripped from the response.
 */
router.get(
  '/agent/:agentId/active-runs',
  authenticateToken,
  (req, res) => {
    const agentId = deriveAgentKey(req, req.params.agentId);
    const runs = agentRunRegistry.listActiveRuns(agentId).map(
      ({ runId, tool, startedAt }) => ({ runId, tool, startedAt }),
    );
    return res.status(200).json({ runs });
  },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/adminActiveRuns.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/admin.js demo_api_server/tests/adminActiveRuns.test.js
git commit -m "feat(kill-switch): add GET active-runs route for the confirm modal"
```

### 7b — modal UI

The modal currently claims (result screen, `KillSwitchConfirmModal.jsx:149-154`)
that `agentRateLimit` checks the revocation flag — false since Task 4
deleted that file, and was already false before it (never mounted). Both
the active-runs list and this copy fix land together since they touch the
same file.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/KillSwitchConfirmModal.activeRuns.test.jsx
import { render, screen, waitFor } from "@testing-library/react";
import apiClient from "../../services/apiClient";
import KillSwitchConfirmModal from "../KillSwitchConfirmModal";

vi.mock("../../services/apiClient");

describe("KillSwitchConfirmModal — active runs", () => {
  it("shows the active run list fetched for this agentId", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { runs: [{ runId: "r1", tool: "reorder", startedAt: Date.now() - 4000 }] },
    });
    render(
      <KillSwitchConfirmModal isOpen agentId="default-agent" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/reorder/i)).toBeInTheDocument();
    });
    expect(apiClient.get).toHaveBeenCalledWith("/api/admin/agent/default-agent/active-runs");
  });

  it("shows a nothing-running message when the list is empty", async () => {
    apiClient.get.mockResolvedValueOnce({ data: { runs: [] } });
    render(
      <KillSwitchConfirmModal isOpen agentId="default-agent" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    await waitFor(() => {
      expect(screen.getByText(/nothing currently running/i)).toBeInTheDocument();
    });
  });

  it("no longer claims agentRateLimit is the enforcement point", () => {
    expect(screen.queryByText(/agentRateLimit/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/KillSwitchConfirmModal.activeRuns.test.jsx`
Expected: FAIL — no fetch happens, no active-run text renders

- [ ] **Step 3: Write minimal implementation**

In `demo_api_ui/src/components/KillSwitchConfirmModal.jsx`, add the import
(this component currently only uses `EventSource` + `resolveApiBaseUrl` for
the SSE stream — this is a plain JSON GET, which per this repo's UI rule
goes through `apiClient`, not raw `fetch`):

```js
import apiClient from "../services/apiClient";
```

Add state and a fetch-on-open effect, alongside the existing `useEffect`
that re-seeds scope (line 24-26):

```js
const [activeRuns, setActiveRuns] = useState([]);
const [activeRunsLoaded, setActiveRunsLoaded] = useState(false);

useEffect(() => {
  if (!isOpen) { setActiveRunsLoaded(false); return; }
  let cancelled = false;
  apiClient
    .get(`/api/admin/agent/${agentId}/active-runs`)
    .then((res) => { if (!cancelled) setActiveRuns(res.data?.runs || []); })
    .catch(() => { if (!cancelled) setActiveRuns([]); })
    .finally(() => { if (!cancelled) setActiveRunsLoaded(true); });
  return () => { cancelled = true; };
}, [isOpen, agentId]);
```

Replace the stale enforcement-point paragraph on the result screen
(lines 149-154):

```jsx
<p className="ksm-result-mechanism">
  Enforcement point: the agent's next request to{" "}
  <code>/api/agent/*</code> — <code>agentRateLimit</code> checks
  the revocation flag set below before that call is allowed
  through.
</p>
```

with:

```jsx
<p className="ksm-result-mechanism">
  Enforcement point: the agent's next MCP tool call — PingOne
  Authorize's <code>evaluateMcpFirstToolGate</code> checks the
  revocation flag set below before that call is allowed through.
</p>
```

Add the active-runs block in the pre-confirm screen, right before the
existing `.ksm-instructions` block (around line 220):

```jsx
{activeRunsLoaded && (
  <div className="ksm-active-runs">
    {activeRuns.length > 0 ? (
      <>
        <p className="ksm-active-runs-title">This will stop:</p>
        <ul className="ksm-active-runs-list">
          {activeRuns.map((run) => (
            <li key={run.runId}>
              <strong>{run.tool}</strong>
              {" — started "}
              {Math.max(1, Math.round((Date.now() - run.startedAt) / 1000))}s ago
            </li>
          ))}
        </ul>
      </>
    ) : (
      <p className="ksm-active-runs-empty">Nothing currently running for this agent.</p>
    )}
  </div>
)}
```

Add to `KillSwitchConfirmModal.css`:

```css
.ksm-active-runs {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--th-surface-muted, #f5f5f5);
  border: 1px solid var(--th-border, #e0e0e0);
  font-size: 0.85rem;
}
.ksm-active-runs-title {
  margin: 0 0 4px;
  font-weight: 600;
}
.ksm-active-runs-list {
  margin: 0;
  padding-left: 18px;
}
.ksm-active-runs-empty {
  margin: 0;
  color: var(--th-text-muted, #666);
}
```

(Confirm the `--th-*`/`--ba` token names actually used elsewhere in this
file before finalizing — the design tokens memo for this repo warns dark
mode can silently fail via literal fallbacks; check
`KillSwitchConfirmModal.css`'s existing rules for the tokens already in use
in this file and match them exactly rather than introducing new ones.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/KillSwitchConfirmModal.activeRuns.test.jsx`
Expected: PASS, 3/3

- [ ] **Step 5: Run the full UI suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS / green build — check the existing
`KillSwitchConfirmModal` tests (if any) still pass now that `apiClient` is
imported and a new effect runs on open

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/KillSwitchConfirmModal.jsx demo_api_ui/src/components/KillSwitchConfirmModal.css demo_api_ui/src/components/__tests__/KillSwitchConfirmModal.activeRuns.test.jsx
git commit -m "feat(kill-switch): show active runs before confirm, fix stale agentRateLimit copy"
```

---

## Task 8: Education Hub page — what's real, what's a concept

Per the request to make anything not implemented in this plan an
educational section instead: mid-flight abort (the spec's optional/stretch
item 3), full SSF/CAEP cross-system push, and SpiceDB-based kill
authorization are all **not built** here. This task documents all three as
concepts, alongside the two mechanisms that *are* real after Tasks 1-7,
following the existing Learning Hub → `EducationDrawer` tabbed-panel
convention (see `StepUpPanel.js` as the template this mirrors).

**Files:**
- Create: `demo_api_ui/src/components/education/KillSwitchMechanismsPanel.js`
- Modify: `demo_api_ui/src/components/education/educationIds.js`
- Modify: `demo_api_ui/src/components/education/EducationPanelsHost.js`
- Modify: `demo_api_ui/src/components/LearningHub.tsx`

**Interfaces:**
- Consumes: `EducationDrawer` from `../shared/EducationDrawer` (same import
  every other panel uses, e.g. `StepUpPanel.js:2`).
- Produces: `EDU.KILL_SWITCH` constant, registered in `PANEL_MAP`.

- [ ] **Step 1: Add the EDU id**

In `demo_api_ui/src/components/education/educationIds.js`, add:

```js
/** Session-scoped agent kill switch — real enforcement point, audit trail, and what's a concept vs. shipped */
KILL_SWITCH: "kill-switch",
```

- [ ] **Step 2: Write the panel**

```js
// demo_api_ui/src/components/education/KillSwitchMechanismsPanel.js
import EducationDrawer from '../shared/EducationDrawer';

export default function KillSwitchMechanismsPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'How Stop Agent actually works',
      content: (
        <>
          <p>
            Clicking <strong>Stop Agent</strong> writes one flag — <code>agent:&lt;key&gt;:revoked</code> —
            through the same generic session-store interface every session already uses (no Redis in this
            deployment). That flag is checked in exactly one place that matters: <code>evaluateMcpFirstToolGate</code>,
            the real PingOne Authorize gate every MCP tool call passes through, right before the (comparatively
            expensive) policy evaluation runs. A killed agent&apos;s <strong>next</strong> tool call gets a
            403 <code>agent_killed</code> — nothing in flight is interrupted, and nothing halts a loop, because
            there is no persistent loop in this codebase to halt: every agent action lives for one HTTP
            request/SSE response.
          </p>
          <p>
            The key that flag is written and read under is session-scoped, not a shared label — two different
            users clicking Stop Agent on the same UI button no longer collide. PingOne Authorize also revokes
            the underlying OAuth token (RFC 7009) as a second, independent enforcement layer.
          </p>
        </>
      ),
    },
    {
      id: 'audit',
      label: 'Active-run audit trail',
      content: (
        <>
          <p>
            A second, independent piece: every real tool call is bracketed with <code>startRun</code>/<code>endRun</code>
            against a small LMDB-backed registry, keyed the same way the kill check is. The confirm modal reads it
            before you click, so it can say <em>&quot;this will stop: reorder, started 4s ago&quot;</em> instead of a
            blind revoke — this is what the original ask (&quot;must explain, not just shut down&quot;) is actually
            answered by.
          </p>
          <p>
            This is audit visibility, not a second enforcement layer — the registry doesn&apos;t block anything by
            itself. A crashed process that never reaches <code>endRun</code> can&apos;t leak an entry forever: every
            row carries a 30-minute TTL, swept every 5 minutes, the same pattern the revoked flag itself uses.
          </p>
        </>
      ),
    },
    {
      id: 'research',
      label: 'Prior art & RFCs',
      content: (
        <>
          <p>
            &quot;Kill switch&quot; isn&apos;t a standardized term in agent frameworks — the real mechanisms are
            cancel APIs plus policy gates: OpenAI&apos;s <code>POST /threads/&#123;id&#125;/runs/&#123;run_id&#125;/cancel</code>,
            Anthropic&apos;s Agent SDK <code>query.interrupt()</code>, LangGraph&apos;s <code>runs.cancel()</code> plus
            checkpointed <code>interrupt()</code>/<code>Command(resume=...)</code> for human-in-the-loop pauses.
            &quot;Circuit breaker&quot; (threshold-triggered auto-pause) and &quot;kill switch&quot; (operator-initiated
            hard stop) are the terms with real industry traction — this feature is the latter.
          </p>
          <p>
            <strong>CAEP (Continuous Access Evaluation Profile, OpenID Foundation)</strong> went final in August 2025
            with a <code>session-revoked</code> event type — this exact use case — built on RFC 8417 (Security Event
            Token) and RFC 8935 (push delivery). Production users include Okta, Microsoft Entra CAE, Google Workspace,
            Apple, Cisco Duo, and SailPoint. This design&apos;s revoke-then-check pattern already matches what CAEP
            prescribes for receivers.
          </p>
          <p>
            <code>draft-klrc-aiagent-auth-03</code> — an IETF individual draft co-authored by Ping Identity&apos;s
            Brian Campbell with Okta and OpenAI authors — prescribes CAEP/RISC subscriptions for AI agents and states
            cached tokens <strong>MUST NOT</strong> be used after a revocation notification, directly validating this
            pattern.
          </p>
          <p>
            <strong>GNAP (RFC 9635, Oct 2024)</strong> offers cleaner grant-level revocation (delete the whole grant,
            no new tokens issuable) than OAuth&apos;s per-token RFC 7009 — but has near-zero production adoption, so
            it&apos;s cited as rationale only, not something this demo builds on.
          </p>
          <p>
            OWASP&apos;s Excessive Agency is <strong>LLM06</strong> on the LLM Top 10; the newer OWASP Agentic AI
            Threats and Mitigations document names kill switches explicitly under <strong>T6</strong> (Intent
            Breaking &amp; Goal Manipulation).
          </p>
        </>
      ),
    },
    {
      id: 'spicedb',
      label: 'SpiceDB — where it fits and where it doesn’t',
      content: (
        <>
          <p>
            <strong>SpiceDB</strong> (AuthZed&apos;s implementation of Google&apos;s Zanzibar paper) was evaluated
            for the active-run registry above and is <strong>the wrong tool for that piece</strong>. Zanzibar-style
            relationship stores hold a permission graph, not fast-changing operational metadata — writing on every
            single tool-call start/end is high churn against a system tuned for a slowly-changing graph. No
            production examples were found of Zanzibar/SpiceDB used as a live session/run registry; the standard
            architecture is &quot;SpiceDB for permissions, a KV store for live state,&quot; which is exactly the
            split this feature landed on (LMDB for the registry).
          </p>
          <p>
            SpiceDB <strong>does</strong> fit a different, related question this feature doesn&apos;t answer today:
            <em> &quot;who may kill which agent&quot;</em> — modeled as a relationship tuple like
            <code> agent:X#killer@user:alice</code>. Right now, any authenticated session can stop any agent it can
            see. A real deployment would want that gated, and SpiceDB is a defensible way to model it — a genuine
            future extension, not built here.
          </p>
        </>
      ),
    },
    {
      id: 'not-built',
      label: 'Not built — concepts only',
      content: (
        <>
          <p>
            Three ideas from the research were deliberately <strong>not implemented</strong> in this pass — they
            remain concepts to explain, not code to demo:
          </p>
          <h4>Mid-flight abort (CAEP-shaped push)</h4>
          <p>
            Everything above blocks the agent&apos;s <em>next</em> call — a call already in flight when you click
            Stop finishes on its own. A true mid-flight abort would name the kill event <code>session-revoked</code>
            (CAEP vocabulary), shape the payload like a Security Event Token (RFC 8417), push it over the existing
            kill-switch SSE hub, and have the in-flight handler hold an <code>AbortController</code> tied to its
            run — cancelling the actual external call the instant the push arrives. It wasn&apos;t built because
            real tool calls in this demo are short enough that the window a call could still be in flight is
            milliseconds, not because it&apos;s a hard problem — see the design spec&apos;s &quot;Rejected
            approaches&quot; for the full reasoning.
          </p>
          <h4>Full SSF/CAEP cross-system transport</h4>
          <p>
            CAEP&apos;s real transport is RFC 8935 HTTP push to an external Security Event Token Receiver — for a
            different application entirely to subscribe to this app&apos;s revocation events. This demo has no such
            external receiver, so only the internal naming/payload convention was adopted, not the transport.
          </p>
          <h4>SpiceDB-based &quot;who may kill which agent&quot;</h4>
          <p>
            Covered on the SpiceDB tab — a real, defensible extension, not part of this feature&apos;s scope.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agent Kill Switch"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
```

- [ ] **Step 3: Register the panel**

In `demo_api_ui/src/components/education/EducationPanelsHost.js`, add the
import alongside the others (alphabetically near `IntrospectionPanel`):

```js
import KillSwitchMechanismsPanel from "./KillSwitchMechanismsPanel";
```

Add to `PANEL_MAP`:

```js
[EDU.KILL_SWITCH]: KillSwitchMechanismsPanel,
```

- [ ] **Step 4: Add the Learning Hub entry**

In `demo_api_ui/src/components/LearningHub.tsx`, add to the `mcp-agents`
category's `items` array (after `"Enterprise-Managed Auth (EMA)"`, line
188-191):

```js
{
  label: "Agent Kill Switch",
  description: "Session-scoped revocation, active-run audit trail, and what's a concept vs. shipped",
  icon: "🛑",
  action: () => {},
},
```

And to the `"mcp-agents"` block inside `categoryActionMap` (after
`"Enterprise-Managed Auth (EMA)"`, line 400-401):

```js
"Agent Kill Switch": () => openEdu(EDU.KILL_SWITCH, "what"),
```

- [ ] **Step 5: Manually verify in the browser**

This is UI navigation wiring with no existing automated coverage pattern in
this file (`LearningHub.tsx` has no dedicated click-through test for
individual items). Verify manually: start the UI (`npm run dev` or the
running demo stack), open Learning Hub, search "kill switch" or browse to
MCP & Agents, click **Agent Kill Switch**, confirm all five tabs render
with no console errors.

- [ ] **Step 6: Run the UI suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS / green build

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/education/KillSwitchMechanismsPanel.js demo_api_ui/src/components/education/educationIds.js demo_api_ui/src/components/education/EducationPanelsHost.js demo_api_ui/src/components/LearningHub.tsx
git commit -m "docs(learning-hub): add Agent Kill Switch education page

Covers what's real (session-scoped enforcement in evaluateMcpFirstToolGate,
the active-run registry) and what's a concept only (mid-flight abort,
full SSF/CAEP transport, SpiceDB-based kill authorization)."
```

---

## Final verification (after all tasks)

1. `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4` — full server suite green.
2. `cd demo_api_ui && npm run test:unit && npm run build` — UI suite + build green.
3. `npm run topology:verify` from repo root (in the **main checkout**, not
   the worktree — the pre-commit gate for this silently skips inside a
   worktree per `demo_api_server/CLAUDE.md`).
4. Live-verify per the pattern already established today for this feature:
   deploy via `scripts/sync-main-checkout.sh` + `./run-docker.sh restart ui demo-api-server`,
   then in the browser: open two different sessions (or one normal + one
   incognito), start an agent action in session A, click Stop Agent in
   session B, confirm session A's next tool call still succeeds (proves the
   session-scoping fix); then click Stop Agent in session A itself mid a
   started action, confirm the active-runs list showed it before confirming,
   and confirm the *next* tool call in session A gets rejected with
   `agent_killed` (proves Task 2's real enforcement, not just the flag
   write).
