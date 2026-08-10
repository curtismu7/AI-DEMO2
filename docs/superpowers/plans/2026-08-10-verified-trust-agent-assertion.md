# Verified Trust Agent-to-User Assertion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the A2A (agent-to-agent) delegation feature a portable, cryptographically verifiable trust assertion — not just a bearer token — so the demo can show Coupa's "agent-to-user binding, claims that cross org boundaries" ask running against a real signed credential, not a roadmap bullet.

**Architecture:** Extend the existing RFC 8693 delegation chain (`demo_api_server/services/a2aDelegationService.js`) with a second, parallel artifact: a signed SD-JWT Verifiable Credential issued via PingOne Credentials, asserting `{ agent_id, acting_for: user_id, scope, issued_at, expires_at }`. The credential is minted once per delegation chain start, attached to the Agent Card the receiving specialist agent already fetches (`demo_api_server/services/a2aAgentCardService.js`), and independently verifiable by the receiving side without a callback to the issuer — the property a bearer token doesn't have.

**Tech Stack:** PingOne Credentials (W3C VC / SD-JWT), PingOne DaVinci (issuance flow trigger), Express (BFF), existing A2A module.

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` (REGRESSION_PLAN.md §0).
- Server: CommonJS + Express + jest + supertest.
- Use Super Sports as the default vertical for manual validation.
- Do not change the existing bearer-token A2A path — this is additive, gated behind a flag, and must not become a hard dependency of A2A delegation working at all.

---

## Entitlement check — do this before Task 1 (higher bar than the Protect plan)

This is the heaviest-lift item of the three gaps identified in the Coupa comparison doc, and unlike Protect, this repo has **zero** existing DaVinci automation or Credentials wiring to build on — confirmed by direct search: `bootstrapPingOne.js` and `setupFresh.js` have no DaVinci references at all, and the only existing DaVinci touchpoint in the whole repo is a manual flow-export **download** button (`demo_api_ui/src/components/AuthorizeConfigPage.jsx:476-499`), not a driven flow.

Before writing any code, confirm ALL of the following on environment `01d89b06-66d5-430e-9f28-65636843788b`:

1. **DaVinci Advanced license** — required for the Verified Trust connector per the platform docs. Check via PingOne console → DaVinci, or ask the account team directly; this is very likely a licensing gap, not just an unconfigured feature.
2. **PingOne Credentials service enabled** on the environment (separate from DaVinci — it's its own service that needs a Digital Wallet Application and at least one Credential Type configured).
3. If either is missing: **stop here.** This plan cannot proceed as "real integration" without both. Report back with what's missing and let the user decide between (a) requesting trial entitlement for a scoped POC, or (b) explicitly re-scoping this to a simulated/mocked proof point as a separate decision — do not silently downgrade to a mock under the "real integration" instruction already given.
4. If both are present: note the Credential Type ID and Digital Wallet Application ID, continue to Task 1.

**Given the near-certainty this blocks on licensing**, Task 1 below is deliberately the smallest possible vertical slice — one credential type, one issuance path, no wallet UI — so the entitlement check is validated with minimum wasted engineering effort if it turns out blocked partway through.

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/routes/featureFlags.js` | Add `ff_verified_trust_a2a` flag |
| `demo_api_server/services/verifiedTrustService.js` (new) | Calls PingOne Credentials issuance API, returns a signed SD-JWT VC string |
| `demo_api_server/src/__tests__/verifiedTrustService.test.js` (new) | Unit tests, PingOne API mocked |
| `demo_api_server/services/a2aDelegationService.js` (existing) | Modify: when the flag is ON, call `verifiedTrustService` at chain start and attach the credential to the delegation context |
| `demo_api_server/services/a2aAgentCardService.js:128` (existing) | Modify: Agent Card advertises the VC alongside the existing "PingOne Bearer security" line, when present |
| `demo_api_ui/src/components/education/IETFStandardsPanel.js:502-532` (existing) | Modify: flip the SD-JWT VC card from `status="❌ Not implemented"` to reflect the real state once Task 1-3 land |

---

### Task 1: `verifiedTrustService` — issue a signed SD-JWT VC for one delegation chain

**Files:**
- Create: `demo_api_server/services/verifiedTrustService.js`
- Test: `demo_api_server/src/__tests__/verifiedTrustService.test.js`

**Interfaces:**
- Consumes: PingOne Credentials issuance endpoint, worker token via the same helper `protectRiskService.js` uses (`getWorkerAccessToken` from `pingOneClientService.js`) — reuse, don't reimplement.
- Produces: `async function issueAgentTrustAssertion({ agentId, actingForUserId, scope, chainId }) -> { credential: string, credentialId: string, expiresAt: string }` — the `credential` is the raw SD-JWT string. Consumed by `a2aDelegationService.js` in Task 2.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/verifiedTrustService.test.js
jest.mock('axios');
const axios = require('axios');
const { issueAgentTrustAssertion } = require('../../services/verifiedTrustService');

test('issues a credential with the expected claim shape', async () => {
  axios.post.mockResolvedValueOnce({
    data: {
      id: 'cred-789',
      credential: 'eyJhbGciOi...mockSdJwt',
      expiresAt: '2026-08-10T13:00:00Z',
    },
  });

  const result = await issueAgentTrustAssertion({
    agentId: 'agent-invest-specialist',
    actingForUserId: 'user-1',
    scope: 'invest:read',
    chainId: 'chain-abc',
  });

  expect(result).toEqual({
    credential: 'eyJhbGciOi...mockSdJwt',
    credentialId: 'cred-789',
    expiresAt: '2026-08-10T13:00:00Z',
  });

  const [, body] = axios.post.mock.calls[0];
  expect(body.claims).toMatchObject({
    agent_id: 'agent-invest-specialist',
    acting_for: 'user-1',
    scope: 'invest:read',
    chain_id: 'chain-abc',
  });
});

test('propagates a null credential when issuance is not entitled (403)', async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 403, data: { code: 'NOT_ENTITLED' } } });

  await expect(
    issueAgentTrustAssertion({ agentId: 'a', actingForUserId: 'u', scope: 's', chainId: 'c' })
  ).rejects.toMatchObject({ code: 'NOT_ENTITLED' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest verifiedTrustService`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```javascript
// demo_api_server/services/verifiedTrustService.js
const axios = require('axios');
const configStore = require('./configStore');
const { getWorkerAccessToken } = require('./pingOneClientService');

async function issueAgentTrustAssertion({ agentId, actingForUserId, scope, chainId }) {
  const envId = configStore.get('PINGONE_ENVIRONMENT_ID');
  const apiBase = configStore.get('PINGONE_API_BASE_URL') || 'https://api.pingone.com/v1';
  const credentialTypeId = configStore.get('PINGONE_AGENT_CREDENTIAL_TYPE_ID');
  const token = await getWorkerAccessToken();

  try {
    const res = await axios.post(
      `${apiBase}/environments/${envId}/credentialTypes/${credentialTypeId}/issuances`,
      {
        claims: {
          agent_id: agentId,
          acting_for: actingForUserId,
          scope,
          chain_id: chainId,
          issued_at: new Date().toISOString(),
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    return {
      credential: res.data.credential,
      credentialId: res.data.id,
      expiresAt: res.data.expiresAt,
    };
  } catch (err) {
    if (err.response?.status === 403) {
      throw { code: err.response.data?.code || 'NOT_ENTITLED', cause: err };
    }
    throw err;
  }
}

module.exports = { issueAgentTrustAssertion };
```

Field names (`credentialTypeId` path segment, `claims` body shape) are illustrative — verify against the real PingOne Credentials issuance API contract during the entitlement check, same caveat as the Protect plan's Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest verifiedTrustService`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verifiedTrustService.js demo_api_server/src/__tests__/verifiedTrustService.test.js
git commit -m "feat(verified-trust): add verifiedTrustService for agent trust assertions"
```

---

### Task 2: Feature flag + wire issuance into the delegation chain start

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js`
- Modify: `demo_api_server/services/a2aDelegationService.js` (read the file first — locate the exact function that starts a new delegation chain; the header comment at lines 4-31 documents the chain shape (`T_agent1 {sub:user, act:{sub:agent1}}` → ...) — find where that first exchange happens)
- Test: `demo_api_server/src/__tests__/a2aDelegationService.test.js` (extend the existing test file — do not create a parallel one)

**Interfaces:**
- Consumes: `issueAgentTrustAssertion` from Task 1.
- Produces: when `ff_verified_trust_a2a` is ON, the delegation chain context gains a `trustAssertion: { credential, credentialId, expiresAt }` field alongside the existing token chain. When OFF, that field is simply absent — no shape change to existing consumers.

- [ ] **Step 1: Add the feature flag**

```javascript
// demo_api_server/routes/featureFlags.js — insert in the "A2A Delegation" category block
{
  id:           'ff_verified_trust_a2a',
  name:         'Verified Trust — signed agent assertion on A2A delegation',
  category:     'A2A Delegation',
  description:
    'When **ON**, starting an A2A delegation chain also issues a signed SD-JWT Verifiable ' +
    'Credential via PingOne Credentials, asserting which agent is acting for which user. ' +
    'Attached to the Agent Card alongside the existing bearer-token security scheme. ' +
    'Requires DaVinci Advanced + PingOne Credentials entitlement on the tenant.',
  impact:
    'OFF (default) = A2A delegation chain unchanged, bearer-token-only, exactly current behavior. ' +
    'ON = adds one Credentials issuance API call at chain start; failure of that call must not ' +
    'break the existing bearer-token delegation (see Step 3 — fail open, not closed).',
  type:         'boolean',
  defaultValue: false,
  warnIfEnabled: true,
},
```

- [ ] **Step 2: Write the failing test** — extend the existing `a2aDelegationService.test.js`:

```javascript
// added to demo_api_server/src/__tests__/a2aDelegationService.test.js
jest.mock('../../services/verifiedTrustService');
jest.mock('../../services/configStore');
const { issueAgentTrustAssertion } = require('../../services/verifiedTrustService');
const configStore = require('../../services/configStore');

test('flag ON: chain start attaches a trustAssertion', async () => {
  configStore.isFlagEnabled.mockImplementation((id) => id === 'ff_verified_trust_a2a');
  issueAgentTrustAssertion.mockResolvedValue({
    credential: 'eyJmock', credentialId: 'cred-1', expiresAt: '2026-08-10T13:00:00Z',
  });

  const chain = await startDelegationChain({ userId: 'user-1', agentId: 'agent-invest', scope: 'invest:read' });

  expect(chain.trustAssertion).toEqual({
    credential: 'eyJmock', credentialId: 'cred-1', expiresAt: '2026-08-10T13:00:00Z',
  });
});

test('flag ON, issuance fails: chain still starts without trustAssertion (fail open)', async () => {
  configStore.isFlagEnabled.mockImplementation((id) => id === 'ff_verified_trust_a2a');
  issueAgentTrustAssertion.mockRejectedValue({ code: 'NOT_ENTITLED' });

  const chain = await startDelegationChain({ userId: 'user-1', agentId: 'agent-invest', scope: 'invest:read' });

  expect(chain.trustAssertion).toBeUndefined();
  expect(chain.actorToken).toBeDefined(); // existing bearer flow still worked
});

test('flag OFF: no trustAssertion, no issuance call', async () => {
  configStore.isFlagEnabled.mockReturnValue(false);

  const chain = await startDelegationChain({ userId: 'user-1', agentId: 'agent-invest', scope: 'invest:read' });

  expect(issueAgentTrustAssertion).not.toHaveBeenCalled();
  expect(chain.trustAssertion).toBeUndefined();
});
```

(Replace `startDelegationChain` with the actual exported function name from `a2aDelegationService.js` — read the file to get the real name before writing this step for real; do not guess it into the implementation.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd demo_api_server && npx jest a2aDelegationService -t "trustAssertion"`
Expected: FAIL — `chain.trustAssertion` undefined in the ON case too (not implemented yet).

- [ ] **Step 4: Wire the issuance call in, fail-open**

Inside the chain-start function in `a2aDelegationService.js`, after the existing actor-token exchange succeeds, add:

```javascript
let trustAssertion;
if (configStore.isFlagEnabled('ff_verified_trust_a2a')) {
  try {
    trustAssertion = await issueAgentTrustAssertion({
      agentId, actingForUserId: userId, scope, chainId: chain.id,
    });
  } catch (err) {
    // Fail open — Verified Trust is additive, never blocks the existing bearer-token path.
    appEventService?.record?.('verified_trust_issuance_failed', { agentId, code: err.code });
  }
}
return { ...chain, trustAssertion };
```

Match this to the real variable names in the surrounding function — the snippet shows intent, not a literal patch.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest a2aDelegationService`
Expected: PASS (all tests, including the 3 new ones and every pre-existing test in that file — confirm no regression).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/services/a2aDelegationService.js demo_api_server/src/__tests__/a2aDelegationService.test.js
git commit -m "feat(verified-trust): issue signed agent assertion at A2A chain start, fail-open"
```

---

### Task 3: Advertise the credential on the Agent Card

**Files:**
- Modify: `demo_api_server/services/a2aAgentCardService.js:128` (the line that currently advertises "PingOne Bearer security" — read surrounding context before editing)
- Test: extend the existing Agent Card test file (`grep -rl "a2aAgentCardService" demo_api_server/src/__tests__` to find it)

**Interfaces:**
- Consumes: `trustAssertion` from the chain context produced in Task 2.
- Produces: Agent Card JSON gains a second security scheme entry, `{ type: 'verified-trust-vc', description: '...' }`, only when a `trustAssertion` is present on the chain being advertised.

- [ ] **Step 1: Write the failing test** mirroring the existing Agent Card test's structure exactly — read that file first, copy its assertion style, add one case for "chain has a trustAssertion" and one for "chain has no trustAssertion, card unchanged from today."

- [ ] **Step 2: Run it, confirm the new case fails** (card doesn't yet include the second security scheme).

- [ ] **Step 3: Add the conditional security-scheme entry** next to line 128, gated on `chain.trustAssertion` being present — do not gate on the feature flag directly here, gate on data presence (the flag already controlled whether `trustAssertion` exists upstream; don't check the flag twice in two places).

- [ ] **Step 4: Run the test, confirm it passes**, then run the full Agent Card suite to confirm no regression on the no-VC case.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/a2aAgentCardService.js demo_api_server/src/__tests__/  # add the specific test file explicitly, not the whole dir
git commit -m "feat(verified-trust): advertise agent trust assertion on Agent Card when present"
```

---

### Task 4: Flip the education panel from "Not implemented" to real status

**Files:**
- Modify: `demo_api_ui/src/components/education/IETFStandardsPanel.js:502-532`
- Test: `demo_api_ui` vitest suite covering this component, if one exists (`grep -rl "IETFStandardsPanel" demo_api_ui/src/components/education/__tests__` or sibling test dir) — extend it; if none exists, this task is UI-copy-only and doesn't need a new test file invented for it.

- [ ] **Step 1:** Read the current SD-JWT VC card block (lines 502-532) to see its exact JSX shape.
- [ ] **Step 2:** Change `status="❌ Not implemented"` to `status="✅ Live (behind ff_verified_trust_a2a)"` and update the gap copy below it to describe the real flow (chain-start issuance, Agent Card advertisement) instead of the roadmap language it currently has.
- [ ] **Step 3:** `cd demo_api_ui && npm run test:unit && npm run build` — confirm no regression.
- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/IETFStandardsPanel.js
git commit -m "docs(verified-trust): flip education panel status to live"
```

---

### Task 5: Register as a use-case catalog chip (UC37)

**Files:**
- Modify: `demo_api_server/config/useCases.js` — append a new entry to the `USE_CASES` array, after whatever the last UC is by then (UC36 if the Protect plan's Task 6 landed first — re-check with `grep -oE "id: 'UC[0-9.]+'" demo_api_server/config/useCases.js | sort -t'C' -k2 -n -u`, don't assume the number).
- Regenerate: `npm run use-cases:gen && npm run use-cases:check` per `demo_api_server/CLAUDE.md`'s generated-artifacts rule.
- Verify: `demo_api_server/tests/useCases.primaryTool.test.js` must pass for every vertical.

**Interfaces:**
- Consumes: `ff_verified_trust_a2a` (Task 2), the `trustAssertion` chain field (Task 2), the Agent Card security scheme (Task 3).
- Produces: nothing new consumed elsewhere — leaf catalog entry.

This chip reuses UC2's existing A2A vehicle (`hand off to a specialist` → `get_portfolio_summary`, same `A2A_PER_VERTICAL` mapping) rather than inventing a new one — what's new is the evidence step showing a signed credential was issued alongside the bearer-token chain, not a different action.

**Grouping:** UC37 pairs with UC36 (Protect plan's Task 6) — same source research, meant to be browsed together in the catalog. Whichever plan lands first creates a `// --- COUPA/NIQ GAP-CLOSURE DEMO` comment block; whichever lands second inserts inside that same block, adjacent to the other entry, rather than appending elsewhere in the array.

- [ ] **Step 1: Add the catalog entry**

If the `// --- COUPA/NIQ GAP-CLOSURE DEMO` block already exists (Protect's Task 6 landed first), insert UC37 inside it, immediately after UC36. Otherwise create it fresh:

```javascript
// demo_api_server/config/useCases.js — append after the last UC entry, before the closing `];`
// --- COUPA/NIQ GAP-CLOSURE DEMO (Protect risk-eval + Verified Trust A2A assertion) ---
// Keep UC36/UC37 adjacent — same source research, same track, meant to be browsed as a pair.
{
  id: 'UC37',
  useCaseId: 'verified-trust-a2a-assertion',
  track: 'controls',
  title: 'Verified Trust — signed agent assertion on A2A delegation',
  buyerStory: "When an agent hands off to another organization's agent, a bearer token alone doesn't let the receiving side verify the claim offline or prove it later without calling back to the issuer.",
  pingOneSolution: 'PingOne Credentials issues a signed SD-JWT Verifiable Credential asserting which agent is acting for which user at A2A delegation start; the receiving specialist advertises it as a second security scheme alongside the existing bearer token.',
  trigger: { type: 'chip', text: 'hand off to a specialist' },
  expectedOutcome: 'PERMIT',
  evidence: { tokenChain: ['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'verified-trust-issuance', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched'], activity: ['token', 'delegate', 'verified-trust', 'authorize', 'mcp'] },
  codeRefs: [
    'demo_api_server/services/verifiedTrustService.js',
    'demo_api_server/services/a2aDelegationService.js',
    'demo_api_server/services/a2aAgentCardService.js',
  ],
  maturity: 'flag:ff_verified_trust_a2a',
  owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] }, // reuses UC2's mapping — confirm still accurate for the added credential surface before merging
  whatToSay: 'Same specialist handoff as before — but now the chain carries a signed, independently-verifiable credential too, not just a bearer token the receiving side has to trust blindly.',
  advanced: false,
  whatLong: "A2A delegation already proves the chain via RFC 8693 nested-act tokens, but a bearer token only means something to a party that can call back to the issuer. This scenario adds a signed SD-JWT Verifiable Credential at chain start, asserting agent_id/acting_for/scope/chain_id — independently verifiable, portable across an org boundary. Issuance is fail-open: if Credentials issuance fails, the existing bearer-token delegation still completes unaffected.",
  businessValue: "Directly answers Coupa's cross-boundary trust ask: an external agent receiving a handoff doesn't have to trust a bearer token on faith or maintain a live connection to the issuing org — it can verify the credential's signature offline.",
  productRoles: {
    idp:   'Mints the nested-act delegated bearer token exactly as UC2 does.',
    authz: 'Evaluates the act chain as usual — the credential is additive, not a replacement authorization signal.',
  },
  primaryTool: 'get_portfolio_summary',
  perVertical: A2A_PER_VERTICAL,
},
```

Every field is a draft pending real-tenant verification — especially `owasp` (copied from UC2, confirm it still fits once the credential surface is real) and the UC number (re-check for collisions at execution time, same caveat as the Protect plan's Task 6).

- [ ] **Step 2: Regenerate + verify**

Run: `cd demo_api_server && npm run use-cases:gen && npm run use-cases:check`
Expected: PASS, no diff drift.

Run: `cd demo_api_server && npx jest useCases.primaryTool`
Expected: PASS for every vertical.

- [ ] **Step 3: Manual verification** — flag ON, entitlement cleared, dispatch UC37 in Super Sports, confirm the ProofStrip/token-chain view shows the `verified-trust-issuance` evidence step between the two A2A exchanges.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/useCases.js
git commit -m "feat(verified-trust): register UC37 use-case catalog chip"
```

---

## Self-review notes

- Spec coverage: entitlement check (blocking gate, deliberately front-loaded given near-certain licensing gap) → issuance service → fail-open wiring into the one place that matters (chain start) → Agent Card advertisement → education-panel truth update → use-case catalog registration so the feature is chip-dispatchable like every other UC. Covers "agent-to-user binding, portable claims across org boundaries" from the comparison doc plus this session's follow-up ask.
- Fail-open by design (Task 2, Step 4): Verified Trust issuance failing must never break the existing, working bearer-token A2A delegation — this is the single most important constraint in this plan given how much is unconfirmed about tenant entitlement.
- Explicitly NOT in scope: a wallet UI, credential revocation flow, or cross-organization verification by a real external relying party (Coupa's actual ask implies a second organization verifying the claim — this plan only gets as far as *issuing* a verifiable one; a second demo tenant or mock relying-party verifier would be a separate follow-up plan).
- Task 5's catalog entry reuses UC2's `owasp` mapping as a starting point — don't ship it unverified; the credential surface may warrant its own threat/section mapping.
