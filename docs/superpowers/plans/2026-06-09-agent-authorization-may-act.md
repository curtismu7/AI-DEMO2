# Agent Authorization & Delegation (may_act) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user authorize/revoke the AI agent's RFC 8693 `may_act` authorization (enforced, default-on), and surface family delegation as a separate `delegated_to` lane in the token chain — without disturbing the agent's load-bearing `may_act`.

**Architecture:** A new BFF route module (`/api/agent-authorization`) writes/clears the user's PingOne `mayAct` attribute via `pingOneUserService`; the SPA shows an "AI Agent Authorization" card on the Family Delegation page and silently re-auths so the token reflects the change. Enforcement reuses the existing `ff_require_may_act` gate. Part C adds a parallel `delegatedTo` PingOne attribute + `delegated_to` claim populated from the active LMDB delegation records.

**Tech Stack:** Node/Express (demo_api_server), Jest + supertest, React (demo_api_ui), PingOne Management API.

**Spec:** `docs/superpowers/specs/2026-06-09-agent-authorization-may-act-design.md`

**Dependency:** PR #101 (`/api/auth/reauth` + `requestSilentReauth`). If not merged when execution starts, Task B3 includes a fallback.

---

## File structure

| File | Responsibility | Part |
|---|---|---|
| `demo_api_server/services/pingOneUserService.js` | reconcile `setMayActAttribute` PATCH shape (verified) | A |
| `demo_api_server/services/pingoneProvisionService.js` | SpEL-literal audit of gateway `may_act`; add `delegatedTo` schema attr + `delegated_to` resource attr | A, C |
| `demo_api_server/routes/agentAuthorization.js` | NEW — grant/revoke/status endpoints | B |
| `demo_api_server/server.js` | mount the new route | B |
| `demo_api_server/services/configStore.js` | `ff_require_may_act` default → `'true'` | B |
| `demo_api_server/services/delegationService.js` | sync grantor `delegatedTo` on grant/revoke | C |
| `demo_api_ui/src/services/agentAuthorizationService.js` | NEW — SPA client for the endpoints | B |
| `demo_api_ui/src/components/DelegationPage.js` | "AI Agent Authorization" card | B |
| `demo_api_ui/src/components/BankingAgent.js` | clean `may_act_required` 403 state | B |
| token-chain UI component | render `delegated_to` lane | C |

---

## Part A — Foundation

### Task A1: Reconcile `setMayActAttribute` to the proven flat shape

**Confirmed (no probe needed):** the working write is the flat top-level body
`PATCH /users/:id { mayAct: { sub } }` (`pingoneProvisionService.js:1965`) — verified against
the live env (it produced demoUser's console value `mayAct = { "sub": "https://agent.com" }`).
Therefore `setMayActAttribute` (JSON-Patch `/custom/mayAct`) and `getMayActStatus`
(`user.custom?.mayAct`) are **both wrong** and must be fixed. Also note: PingOne's default
`GET /users/:id` does **not** return custom JSON attributes, so a status read cannot rely on a
plain GET (see Step 4).

**Files:**
- Modify: `demo_api_server/services/pingOneUserService.js:279-302` (`setMayActAttribute`), `:422-440` (`getMayActStatus`)
- Test: `demo_api_server/src/__tests__/pingOneUserService.mayAct.test.js` (create)

- [ ] **Step 1: Write the failing test** asserting `setMayActAttribute` sends the flat top-level body.

```js
// pingOneUserService.mayAct.test.js
jest.mock('axios');
const axios = require('axios');
const svc = require('../../services/pingOneUserService'); // singleton; init per existing test setup

test('setMayActAttribute PATCHes the flat top-level { mayAct } body (matches provisioning)', async () => {
  // arrange: worker token + axios PATCH mock per the existing pingOneUserService test pattern
  await svc.setMayActAttribute('user-5', { sub: 'https://agent.com' });
  const patchCall = axios.request?.mock?.calls?.find?.(/* PATCH /users/user-5 */) /* or however makeRequest is mocked */;
  // assert the body is flat: { mayAct: { sub: 'https://agent.com' } }  (NOT a JSON-Patch op array)
});

test('setMayActAttribute(userId, null) clears via flat { mayAct: null }', async () => {
  await svc.setMayActAttribute('user-5', null);
  // assert body === { mayAct: null }
});
```

- [ ] **Step 2: Run, verify it fails** (current code sends the JSON-Patch `/custom/` array).

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "/tests/real/" -- pingOneUserService.mayAct`
Expected: FAIL.

- [ ] **Step 3: Fix `setMayActAttribute`** to send the flat body (mirror `updatePingOneUser`):

```js
async setMayActAttribute(userId, mayActConfig) {
  // PingOne custom JSON attributes are written at the top level by name (NOT under
  // /custom and NOT via JSON-Patch). mayActConfig === null clears it.
  try {
    await this.makeRequest('PATCH', `/users/${userId}`, { mayAct: mayActConfig });
    logger.info(LOG_CATEGORIES.USER_MANAGEMENT, 'mayAct attribute set', { userId, mayActConfig });
  } catch (error) {
    logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'Failed to set mayAct attribute', { userId, error: error.message });
    throw new Error(`Failed to set mayAct attribute: ${error.message}`);
  }
}
```

- [ ] **Step 4: Fix `getMayActStatus` to read top-level + cope with the default-GET omission.** Read `user.mayAct` (top-level, not `user.custom?.mayAct`). Because the default GET omits custom JSON attrs, request them explicitly if PingOne supports it for this env; if a reliable read isn't available, the agent-authorization `/status` endpoint (Task B1) will instead derive "authorized" from the user's **current token `may_act` claim** (what the token chain reflects). Pick the reliable one and note it in the commit.

```js
async getMayActStatus(userId) {
  const user = await this.makeRequest('GET', `/users/${userId}`);
  return user.mayAct || null; // top-level; null when absent
}
```

- [ ] **Step 5: Run, verify PASS.**

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "/tests/real/" -- pingOneUserService.mayAct`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add demo_api_server/services/pingOneUserService.js demo_api_server/src/__tests__/pingOneUserService.mayAct.test.js
git commit -m "fix(mayAct): setMayActAttribute/getMayActStatus use the flat top-level shape (match provisioning)"
```

### Task A2: Audit the Agent-Gateway `may_act` SpEL for the literal bug

**Files:**
- Verify/modify: `demo_api_server/services/pingoneProvisionService.js:~2229-2256`

- [ ] **Step 1: Read the Agent-Gateway `may_act` resource-attribute definition.** Confirm it uses `${...}` projection, not a `#{'sub':...}` map literal.

Run: `sed -n '2229,2256p' demo_api_server/services/pingoneProvisionService.js`
Expected: the `value` is a `${...}`-form expression.

- [ ] **Step 2: If it uses a `#{...}` map literal, change it to the `${user.<attr>}` form** consistent with `MAY_ACT_USER_SPEL` (line 1919). If already `${...}`, no change — note it in the commit message and skip to Part B.

- [ ] **Step 3: Commit (only if changed).**

```bash
git add demo_api_server/services/pingoneProvisionService.js
git commit -m "fix(provision): use \${...} form for gateway may_act resource attr (avoid SpEL literal bug)"
```

---

## Part B — Agent authorization control + enforcement

### Task B1: Backend route module `/api/agent-authorization`

**Files:**
- Create: `demo_api_server/routes/agentAuthorization.js`
- Test: `demo_api_server/src/__tests__/agentAuthorization.route.test.js`

- [ ] **Step 1: Write the failing test** (supertest, mount router on a minimal app, mock `pingOneUserService` + `configStore`).

```js
// agentAuthorization.route.test.js
jest.mock('../../services/pingOneUserService', () => ({
  setMayActAttribute: jest.fn().mockResolvedValue(undefined),
  getMayActStatus: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => (k === 'ff_require_may_act' ? 'true' : null)),
}));
const request = require('supertest');
const express = require('express');
const pingOneUserService = require('../../services/pingOneUserService');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'user-5' }; next(); });
  app.use('/api/agent-authorization', require('../../routes/agentAuthorization'));
  return app;
}
test('POST /grant writes the agent may_act sub to the user mayAct and signals reauth', async () => {
  process.env.AGENT_MAY_ACT_SUB = 'https://agent.com';
  const res = await request(buildApp()).post('/api/agent-authorization/grant').expect(200);
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('user-5', { sub: 'https://agent.com' });
  expect(res.body).toEqual({ ok: true, reauthRequired: true });
});

test('POST /revoke clears mayAct and signals reauth', async () => {
  const res = await request(buildApp()).post('/api/agent-authorization/revoke').expect(200);
  expect(pingOneUserService.setMayActAttribute).toHaveBeenCalledWith('user-5', null);
  expect(res.body).toEqual({ ok: true, reauthRequired: true });
});

test('GET /status reports authorized + enforced', async () => {
  pingOneUserService.getMayActStatus.mockResolvedValueOnce({ sub: 'agent-client-id' });
  const res = await request(buildApp()).get('/api/agent-authorization/status').expect(200);
  expect(res.body).toEqual({ authorized: true, enforced: true });
});

test('grant surfaces a 502 when PingOne PATCH fails (no silent success)', async () => {
  pingOneUserService.setMayActAttribute.mockRejectedValueOnce(new Error('PingOne 500'));
  const res = await request(buildApp()).post('/api/agent-authorization/grant').expect(502);
  expect(res.body.error).toBe('mayact_write_failed');
});
```

- [ ] **Step 2: Run, verify it fails** (module not found).

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "/tests/real/" -- agentAuthorization.route`
Expected: FAIL.

- [ ] **Step 3: Implement `routes/agentAuthorization.js`.**

```js
// demo_api_server/routes/agentAuthorization.js
'use strict';
const express = require('express');
const router = express.Router();
const pingOneUserService = require('../services/pingOneUserService');
const configStore = require('../services/configStore');

function agentMayActSub() {
  // Mirror provisioning (pingoneProvisionService.js:1953): AGENT_MAY_ACT_SUB wins
  // (e.g. "https://agent.com"), else the AI Agent client id. This must equal what
  // the agent's actor token carries so PingOne emits `act`.
  return process.env.AGENT_MAY_ACT_SUB || process.env.PINGONE_AI_AGENT_CLIENT_ID || configStore.getEffective('pingone_ai_agent_client_id') || null;
}
function isEnforced() {
  const v = configStore.getEffective('ff_require_may_act');
  return v === true || v === 'true';
}

router.post('/grant', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent may_act sub not configured.' });
  try {
    await pingOneUserService.setMayActAttribute(req.user.id, { sub });
    res.json({ ok: true, reauthRequired: true });
  } catch (err) {
    res.status(502).json({ error: 'mayact_write_failed', message: 'Could not update agent authorization. Try again.' });
  }
});

router.post('/revoke', async (req, res) => {
  try {
    await pingOneUserService.setMayActAttribute(req.user.id, null);
    res.json({ ok: true, reauthRequired: true });
  } catch (err) {
    res.status(502).json({ error: 'mayact_write_failed', message: 'Could not update agent authorization. Try again.' });
  }
});

router.get('/status', async (req, res) => {
  try {
    const mayAct = await pingOneUserService.getMayActStatus(req.user.id);
    res.json({ authorized: !!mayAct, enforced: isEnforced() });
  } catch (err) {
    res.status(502).json({ error: 'mayact_status_failed', message: 'Could not read agent authorization.' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run, verify PASS.**

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "/tests/real/" -- agentAuthorization.route`
Expected: 4 passing.

- [ ] **Step 5: Commit.**

```bash
git add demo_api_server/routes/agentAuthorization.js demo_api_server/src/__tests__/agentAuthorization.route.test.js
git commit -m "feat(agent-auth): add /api/agent-authorization grant/revoke/status endpoints"
```

### Task B2: Mount the route

**Files:**
- Modify: `demo_api_server/server.js` (require near line 114; `app.use` near line 1021, next to delegation)

- [ ] **Step 1: Add the require + mount** (mirror delegation at `server.js:114` / `:1021`).

```js
// near other route requires (~line 114)
const agentAuthorizationRoutes = require('./routes/agentAuthorization');
// near other app.use mounts (~line 1021, after delegation)
app.use('/api/agent-authorization', authenticateToken, agentAuthorizationRoutes);
```

- [ ] **Step 2: Syntax check + commit.**

Run: `node --check demo_api_server/server.js`
Expected: no output (OK).

```bash
git add demo_api_server/server.js
git commit -m "feat(agent-auth): mount /api/agent-authorization (authenticated)"
```

### Task B3: SPA client + "AI Agent Authorization" card

**Files:**
- Create: `demo_api_ui/src/services/agentAuthorizationService.js`
- Modify: `demo_api_ui/src/components/DelegationPage.js`
- Uses: `demo_api_ui/src/utils/authUi.js` `requestSilentReauth` (PR #101). Fallback below if absent.

- [ ] **Step 1: Implement the SPA client.**

```js
// demo_api_ui/src/services/agentAuthorizationService.js
export async function getAgentAuthStatus() {
  const r = await fetch('/api/agent-authorization/status', { credentials: 'include' });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json(); // { authorized, enforced }
}
export async function setAgentAuthorization(authorize) {
  const r = await fetch(`/api/agent-authorization/${authorize ? 'grant' : 'revoke'}`, {
    method: 'POST', credentials: 'include',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `failed (${r.status})`);
  return data; // { ok, reauthRequired }
}
```

- [ ] **Step 2: Add the card to `DelegationPage.js`.** Render status from `getAgentAuthStatus()`; an Authorize/Revoke button calling `setAgentAuthorization(!authorized)` then, on `reauthRequired`, `requestSilentReauth()` (from `../utils/authUi`). If PR #101 is not merged, the fallback is `window.location.href = '/api/auth/oauth/user/login'` after clearing — but prefer landing #101 first. Place the card above the existing delegation list.

```jsx
// sketch — match DelegationPage's existing styling/components
import { getAgentAuthStatus, setAgentAuthorization } from '../services/agentAuthorizationService';
import { requestSilentReauth } from '../utils/authUi';
// state: const [agentAuth, setAgentAuth] = useState(null);
// load in useEffect: getAgentAuthStatus().then(setAgentAuth).catch(() => {});
// handler:
async function toggleAgentAuth() {
  const next = !agentAuth.authorized;
  const data = await setAgentAuthorization(next);
  if (data.reauthRequired) requestSilentReauth(window.location.pathname);
}
// render: badge (agentAuth.authorized ? 'Authorized' : 'Revoked'),
//         button (agentAuth.authorized ? 'Revoke agent' : 'Authorize agent'),
//         note when agentAuth.enforced: "Enforcement on — a revoked agent is blocked."
```

- [ ] **Step 3: Build the UI.**

Run: `cd demo_api_ui && npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit.**

```bash
git add demo_api_ui/src/services/agentAuthorizationService.js demo_api_ui/src/components/DelegationPage.js
git commit -m "feat(agent-auth): AI Agent Authorization card + silent reauth on toggle"
```

### Task B4: Default `ff_require_may_act` to ON

**Files:**
- Modify: `demo_api_server/services/configStore.js:168`
- Verify: provisioning sets `mayAct` for ALL demo users

- [ ] **Step 1: Verify every provisioned demo user gets a `mayAct`.** Check `pingoneProvisionService.js:1952-1965` writes `mayAct` for each demo user (not only demoUser/demoAdmin). If any demo user lacks it, add the write so flipping the default doesn't 403 them.

Run: `grep -nE "mayAct|setMayAct|provisioned\.(users|demo)" demo_api_server/services/pingoneProvisionService.js | head`
Expected: confirm coverage for all demo users.

- [ ] **Step 2: Change the default.**

```js
// configStore.js:168
ff_require_may_act:      { public: true, default: 'true' }, // default ON: revoked agent is blocked (RFC 8693 consent gate)
```

- [ ] **Step 3: Run the existing may_act gate tests to confirm no regression.**

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "/tests/real/" -- agentMcpTokenService`
Expected: PASS (gate already covers `ff_require_may_act` true/false).

- [ ] **Step 4: Commit.**

```bash
git add demo_api_server/services/configStore.js
git commit -m "feat(agent-auth): default ff_require_may_act ON so a revoked agent is enforced"
```

### Task B5: Clean `may_act_required` 403 state in the agent UI

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js` (where tool-call errors render)

- [ ] **Step 1: Find where the agent renders a failed tool call** (search for the gateway-deny / error rendering near the `Gateway Policy Denied` text and the demoAgentService error path).

Run: `grep -nE "Gateway Policy Denied|may_act|403|error.*tool|toolError" demo_api_ui/src/components/BankingAgent.js | head`

- [ ] **Step 2: Map a `may_act_required` / 403-with-that-code error to an actionable state**: a message like "The agent isn't authorized to act on your behalf. Re-authorize it on the Family Delegation page." with a link/button to authorize (calls `setAgentAuthorization(true)` then `requestSilentReauth`). Do not show a raw error.

- [ ] **Step 3: Build + commit.**

Run: `cd demo_api_ui && npm run build` → `✓ built`.

```bash
git add demo_api_ui/src/components/BankingAgent.js
git commit -m "feat(agent-auth): render a clean re-authorize state when may_act enforcement blocks the agent"
```

---

## Part C — Family delegation → token chain (parallel claim)

### Task C1: Provision `delegatedTo` attribute + `delegated_to` claim

**Files:**
- Modify: `demo_api_server/services/pingoneProvisionService.js` (mirror the `mayAct` schema-attr + resource-attr blocks: `:1757-1767`, `:1919-1937`)

- [ ] **Step 1: Add a JSON user-schema attribute `delegatedTo`** via `_ensureUserSchemaAttribute('delegatedTo', 'JSON', ...)` next to the `mayAct` ensure (model on `:1759-1764`).

- [ ] **Step 2: Add a resource attribute `delegated_to = ${user.delegatedTo}`** on the Demo API (enduser) resource, mirroring the `may_act` resource-attr block (`:1924-1937`). Use `${...}` form only (landmine #1).

- [ ] **Step 3: Syntax check + commit.**

Run: `node --check demo_api_server/services/pingoneProvisionService.js`

```bash
git add demo_api_server/services/pingoneProvisionService.js
git commit -m "feat(delegation): provision delegatedTo attribute + delegated_to claim mapping"
```

- [ ] **Step 4 (deferred to deploy): apply provisioning to the live env.** Note in the PR that `./run.sh setup:fresh` (or the provision step) + redeploy is required for the new attribute/claim to exist.

### Task C2: Sync grantor `delegatedTo` on grant/revoke

**Files:**
- Modify: `demo_api_server/services/delegationService.js` (`grantDelegation` ~161-178, `revokeDelegation` ~190-208)
- Test: `demo_api_server/src/__tests__/delegationService.delegatedTo.test.js`

- [ ] **Step 1: Write the failing test** — after grant, the grantor's `delegatedTo` is the set of active delegate subs; after revoke, the revoked sub is removed. Mock `pingOneUserService` + the LMDB db.

```js
// assert: a helper syncGrantorDelegatedTo(delegatorUserId) recomputes the
// active delegate subs from LMDB and calls setDelegatedToAttribute(delegatorUserId, [subs]).
```

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** Add `setDelegatedToAttribute(userId, subs)` to `pingOneUserService` (PATCH the confirmed shape, value = array). In `delegationService`, after the LMDB write in grant and the status flip in revoke, recompute the grantor's active delegate `delegate_user_id`s from LMDB (source of truth — avoids concurrent read-modify-write races) and call `setDelegatedToAttribute`. Make the response include `reauthRequired: true`. Keep PingOne write best-effort (catch + log), never failing the HTTP response (consistent with the email pattern).

- [ ] **Step 4: Run, verify PASS.**

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "/tests/real/" -- delegationService.delegatedTo`

- [ ] **Step 5: Commit.**

```bash
git add demo_api_server/services/delegationService.js demo_api_server/services/pingOneUserService.js demo_api_server/src/__tests__/delegationService.delegatedTo.test.js
git commit -m "feat(delegation): sync grantor delegatedTo from active records on grant/revoke"
```

### Task C3: Reauth signal in the delegation UI

**Files:**
- Modify: `demo_api_ui/src/components/DelegationPage.js` (`handleGrant` ~531, `handleRevoke` ~556)

- [ ] **Step 1: On grant/revoke success with `reauthRequired`, call `requestSilentReauth(window.location.pathname)`** so the re-issued token carries the updated `delegated_to`. (After showing the success message — a short `setTimeout` is acceptable so the user sees confirmation before the silent reload.)

- [ ] **Step 2: Build + commit.**

Run: `cd demo_api_ui && npm run build` → `✓ built`.

```bash
git add demo_api_ui/src/components/DelegationPage.js
git commit -m "feat(delegation): silently re-auth after grant/revoke so delegated_to lands in the token"
```

### Task C4: Render the `delegated_to` lane in the token chain

**Files:**
- Modify: the token-chain UI component (find via `grep -rln "may_act" demo_api_ui/src/components | grep -i token`)

- [ ] **Step 1: Find where `may_act` is rendered in the token-chain panel** and add a sibling "Delegated access" lane reading `delegated_to` from the user-token claims (array of subs → render as chips). Render nothing when absent.

- [ ] **Step 2: Build + commit.**

Run: `cd demo_api_ui && npm run build` → `✓ built`.

```bash
git add demo_api_ui/src/components/<token-chain-file>.js
git commit -m "feat(token-chain): render delegated_to as its own Delegated access lane"
```

---

## Final verification (live, after deploy)

- [ ] Authorize the agent → token chain shows `may_act` valid; agent tool call passes.
- [ ] Revoke the agent (enforcement on) → next tool call returns `403 may_act_required`; UI shows the re-authorize state.
- [ ] Re-authorize → works again.
- [ ] Grant a family delegation → re-issued token carries `delegated_to`; token chain shows the Delegated access lane; agent `may_act` unchanged. Revoke → lane clears.

---

## Self-review notes

- **Spec coverage:** A (PATCH reconcile A1, SpEL audit A2), B (endpoints B1-B2, UI B3, enforce default B4, clean 403 B5), C (provision C1, sync C2, reauth C3, render C4) — all spec sections mapped.
- **Empirical steps:** A1 Step 1 and the live "Final verification" are intentionally run against the live env (PingOne writes verified, not assumed — per the worker-token precedent). The unit-test assertions in A1/C2 are finalized once A1 Step 1 confirms the PATCH shape.
- **Type consistency:** `setMayActAttribute(userId, mayActConfig|null)`, `getMayActStatus(userId)`, new `setDelegatedToAttribute(userId, subs[])`, endpoints return `{ ok, reauthRequired }` / `{ authorized, enforced }`, SPA `getAgentAuthStatus()` / `setAgentAuthorization(bool)` used consistently across tasks.
- **Dependency:** PR #101 `requestSilentReauth` / `/api/auth/reauth` used in B3, C3, B5; fallback noted in B3.
</content>
</invoke>
