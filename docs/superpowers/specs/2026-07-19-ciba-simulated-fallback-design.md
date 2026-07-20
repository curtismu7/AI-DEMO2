# CIBA Simulated Fallback — Design

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation plan
**Scope:** demo_api_server only. No demo_api_ui changes (see Non-goals).

## Goal

Let the CIBA demo (CIBAPanel "Try It" tab, and the transfer step-up bridge
when `STEP_UP_METHOD=ciba`) complete end-to-end on environments where
PingOne's `/as/bc-authorize` endpoint is not provisioned — confirmed live on
`01d89b06-66d5-430e-9f28-65636843788b` (raw AWS API Gateway
`IncompleteSignatureException`, not a PingOne error; see the "Known gap"
callout in `claudSkills/pingone/pingone-mfa/SKILL.md` and
`claudSkills/pingone/ciba/SKILL.md`).

## Non-goals

- No UI changes. The approved design calls for the simulated path to be
  **indistinguishable** from the real one in the UI — same CIBAPanel markup,
  same toast copy, same poll log format. "Simulated" is an internal-only
  session flag, never rendered.
- No simulated *denial* path. Only the approve happy-path is in scope. Real
  PingOne's deny/expire code paths are untouched and still used verbatim
  when CIBA *is* reachable elsewhere.
- No change to `STEP_UP_METHOD` defaults or to the P1MFA
  (`deviceAuthentications`) step-up path, which remains the primary,
  already-working mechanism on this environment.
- No change to `/api/auth/ciba/notify` (ping delivery mode) — failover only
  applies to the poll delivery mode path this demo actually uses.

## Confirmed decisions

1. **Trigger:** auto-fallback. `/initiate` tries the real `bc-authorize` call
   first; only on failure does it fall back to the simulated engine. No
   explicit user-facing toggle.
2. **Where the fake approval happens:** server-side, in a new sibling module
   to `cibaService.js` — mirrors the existing `authorize_failover_mode` /
   `simulatedAuthorizeService.js` pattern already in this codebase. The
   browser-side code (`CIBAPanel.js`, `UserDashboard.js`'s
   `handleCibaStepUp`/poll effect, `CibaStepUpFlowPanel.jsx`) needs **no
   changes** — it already just calls `POST /initiate` and polls
   `GET /poll/:authReqId`, reading `{ status }`.
3. **Approval UX:** auto-approve after a short delay (~7s) — no explicit
   approve/deny button. Mimics the real 5s poll cadence closely enough that
   the "Waiting for approval on your device…" state reads naturally before
   resolving.
4. **Coverage:** both the CIBAPanel "Try It" tab and the transfer step-up
   bridge, since both are just callers of the same two routes.
5. **Transparency:** indistinguishable in the UI. Internally, the session
   still tags the request `simulated: true` for our own
   debugging/audit-log purposes — that tag is never sent in any HTTP
   response body.

## Architecture

### 1. `services/cibaSimulatedService.js` (new)

Mirrors the exported shape of `cibaService.js` so `routes/ciba.js` can call
either behind one interface:

```javascript
function initiateSimulated(loginHint, bindingMessage, scope, acrValues) {
  return {
    auth_req_id: `sim-${crypto.randomUUID()}`,
    expires_in: 300,
    interval: 5,
  };
}

function isSimulatedApproved(pending) {
  // pending = req.session.cibaRequests[auth_req_id]
  return Date.now() - pending.initiatedAt >= SIMULATED_APPROVE_DELAY_MS; // 7000
}
```

No network calls, no PingOne credentials involved. `logAppEvent` calls mirror
`cibaService.js`'s `auth_lifecycle` logging so the existing Activity Log /
Token Chain teaching surfaces keep working, tagged distinctly in the log
`metadata` (`{ engine: 'simulated' }`) for our own debugging — never
surfaced to the browser.

### 2. `routes/ciba.js` changes

**`POST /initiate`:**

```javascript
let result;
let simulated = false;
try {
  result = await cibaService.initiateBackchannelAuth(loginHint, binding_message, scope, acr_values);
} catch (err) {
  const failoverMode = configStore.getEffective('ciba_failover_mode') || 'fallback_simulated';
  if (failoverMode !== 'fallback_simulated') throw err; // preserves today's 502 behavior when explicitly configured off
  result = cibaSimulatedService.initiateSimulated(loginHint, binding_message, scope, acr_values);
  simulated = true;
}
```

The existing `catch` block's 502 response becomes the `failoverMode !== 'fallback_simulated'` branch — unchanged behavior when a caller (or a future test) explicitly disables failover. Default is failover-on, matching
`authorize_failover_mode`'s existing default in
`transactionAuthorizationService.js`.

`req.session.cibaRequests[auth_req_id]` gets one new internal field:
`simulated: true`. Everything else about that record (`expiresAt`,
`loginHint`, `scope`, `acr_values`, `binding_message`) is unchanged.

**`GET /poll/:authReqId`:**

```javascript
if (pending.simulated) {
  if (!cibaSimulatedService.isSimulatedApproved(pending)) {
    return res.json({ status: 'pending' });
  }
  // approved — set the SAME session fields the real path sets today,
  // MINUS the oauthTokens swap (see "Key simplification" below).
  delete req.session.cibaRequests[authReqId];
  req.session.stepUpVerified = Date.now() + STEP_UP_TTL_MS;
  return req.session.save((saveErr) => {
    if (saveErr) console.error('[CIBA] session save error on simulated approval:', saveErr);
    res.json({ status: 'approved', scope: pending.scope });
  });
}
// ...existing real-poll code below, unchanged
```

### 3. Key simplification — no fake token needed

Confirmed via `routes/transactions.js:576-582`: the transfer step-up gate
reads `req.session.stepUpVerified` as a single-use flag and — if fresh —
overrides `effectiveAcr = 'Multi_Factor'` **without re-reading the session's
access token at all**. The real CIBA poll handler's `req.session.oauthTokens`
write (routes/ciba.js:191-199) is therefore not load-bearing for the step-up
gate; it exists to store a genuinely fresher token when CIBA legitimately
minted one.

The simulated branch skips that write entirely. The user's existing, real,
already-validated session access token is untouched and still authenticates
every subsequent request (including the retried transfer) — nothing
downstream ever needs to validate a fake token against PingOne.

The CIBAPanel "Try It" tab's standalone flow (not tied to a transaction) has
no further step after `approved` today either — it already just shows a
static success notice, so it needs nothing extra.

### 4. configStore key

| Key | Default | Notes |
|---|---|---|
| `ciba_failover_mode` | `fallback_simulated` | `fallback_simulated` \| `deny` — naming/behavior mirrors `authorize_failover_mode`. `deny` preserves today's 502-on-failure behavior for anyone who wants CIBA failures to stay loud. |

## Data flow (simulated branch)

```text
Browser                    BFF (routes/ciba.js)              cibaSimulatedService
  │  POST /initiate           │                                    │
  ├──────────────────────────►│  try real bc-authorize ──✗ fails   │
  │                            ├───────────────────────────────────►│ initiateSimulated()
  │                            │◄───────────────────────────────────┤ { auth_req_id: sim-..., expires_in, interval }
  │◄──── 200 { auth_req_id, expires_in, interval, login_hint_display }
  │                            │ session.cibaRequests[id] = {..., simulated: true}
  │  GET /poll/:id (every 5s)  │
  ├──────────────────────────►│  pending.simulated? yes            │
  │                            ├───────────────────────────────────►│ isSimulatedApproved()? false
  │◄──── 200 { status: 'pending' }
  │  ... ~7s elapse ...
  │  GET /poll/:id             │
  ├──────────────────────────►│                                    ├─►│ isSimulatedApproved()? true
  │                            │  session.stepUpVerified = now + 5min
  │◄──── 200 { status: 'approved', scope }
```

## Error handling

- Failures in `initiateSimulated`/`isSimulatedApproved` themselves (there are
  none expected — no I/O, and `crypto.randomUUID()` / `Date.now()` don't
  throw) are not specially handled. `initiateSimulated` is called from
  inside the `catch (realErr)` block, not the outer session-write try/catch
  — a throw there would surface as an unhandled rejection, not a clean 502.
  Acceptable given nothing in that call path can realistically throw.
- Input validation (`binding_message` length/control-char stripping,
  `missing_login_hint`) happens **before** the real-vs-simulated branch, so
  it's identical in both paths — a bad request never silently succeeds via
  the simulated fallback.
- Session ownership/expiry checks in `/poll` (`404` unknown request, `410`
  locally-expired) are unchanged and apply identically to simulated
  requests, since they operate on `req.session.cibaRequests`, not on which
  engine produced the entry.

## Testing

- `cibaSimulatedService.test.js` (new): `initiateSimulated` returns the
  right shape; `isSimulatedApproved` false before the delay, true after
  (use fake timers, not a real 7s sleep).
- `ciba.test.js` additions: mock `cibaService.initiateBackchannelAuth` to
  reject, assert `/initiate` returns 200 with a `sim-` prefixed
  `auth_req_id` and the session record has `simulated: true` (never in the
  response body); assert `/poll` returns `pending` then `approved` across
  the delay boundary; assert `ciba_failover_mode=deny` preserves today's 502.
- `step-up-gate.test.js`: one new case — after a simulated CIBA approval
  (`stepUpVerified` set, no `oauthTokens` change), a high-value transfer with
  the *original* (unmodified) test user token succeeds.
- Live Playwright pass (manual, post-implementation): CIBAPanel "Try It" tab
  end-to-end on this environment; a real ≥$250 transfer with
  `STEP_UP_METHOD=ciba` temporarily set, confirming the retry succeeds after
  simulated approval.

## Mock HTML

`docs/superpowers/specs/2026-07-19-ciba-simulated-fallback-mock.html` — a
static storyboard of the 5 UI states (idle → initiating → pending/countdown
→ auto-approved toast → retried transaction succeeds). Reference artifact
for implementation/review only; not shipped in the app, since the live UI
is intentionally unchanged from today's CIBAPanel.

## Files touched

| File | Change |
|---|---|
| `demo_api_server/services/cibaSimulatedService.js` | new |
| `demo_api_server/routes/ciba.js` | `/initiate` try/catch failover branch, `/poll` simulated branch |
| `demo_api_server/src/__tests__/cibaSimulatedService.test.js` | new |
| `demo_api_server/src/__tests__/ciba.test.js` | failover + simulated-poll cases |
| `demo_api_server/src/__tests__/step-up-gate.test.js` | one new case |

`ciba_failover_mode` is a `configStore` key, not an env var — no `.env`/
`env.example` entry, consistent with how `authorize_failover_mode` is
documented (in code comments on `transactionAuthorizationService.js`, not
`env.example`).

## Open risks

- If PingOne ever *does* provision CIBA on this environment, the real path
  resumes working automatically (failover only triggers on failure) — no
  cleanup needed, but the simulated code becomes dead weight worth removing
  in a follow-up.
  **2026-07-20:** this scenario now has a plan —
  `docs/superpowers/plans/2026-07-20-ciba-real-platform-provisioning.md`
  provisions a dedicated CIBA-only PingOne app + DaVinci flow (console/DaVinci
  steps, not yet executed) and points `cibaService.js` at it via
  `PINGONE_CIBA_CLIENT_ID`/`PINGONE_CIBA_CLIENT_SECRET`. This fallback stays
  as-is either way — the plan keeps it deliberately, as a resilience safety
  net, not dead weight to remove.
- `crypto.randomUUID()` needs Node ≥14.17 with the `crypto` global — already
  used elsewhere in this codebase (`cibaService.js`'s
  `_generateNotificationToken` uses `crypto.randomBytes`), so no new
  dependency.
