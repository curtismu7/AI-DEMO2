# UC22 CIBA — Separate-Device Approval Page — Design

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan
**Scope:** `demo_api_server` (2 new `routes/ciba.js` endpoints) + `demo_api_ui`
(1 new page/route, small changes to the 2 existing CIBA-initiate call sites
in `AIAgent.js`).

## Goal

CIBA is "client-initiated backchannel authentication" — the whole point is
that approval happens *out of band*, on a separate device. Today the demo
shows a chat bubble with an inline "Approve" button in the same window,
which doesn't sell that story. This adds a second browser tab, styled as a
branded PingOne approval page, that opens automatically when CIBA starts —
so the presenter visibly approves "on another device" instead of clicking a
button next to the chat that requested it.

Related: [2026-07-19-uc22-ciba-step-up-override-design.md](2026-07-19-uc22-ciba-step-up-override-design.md)
(which use case forces CIBA) and the 2026-07-20 `REGRESSION_PLAN.md` §4 fix
(why the post-approval retry now completes instead of looping) — this design
sits on top of both; it only changes what the user sees while a CIBA request
is pending, not whether/when CIBA fires or how the retry resolves.

## Non-goals

- Not replacing the existing inline "Waiting for CIBA approval…" chat bubble
  or its own Approve button — both stay exactly as they are today, as the
  fallback path (see "Popup blocked" below). This is purely additive.
- Not changing real (non-simulated) CIBA behavior — the new page works
  identically whether `routes/ciba.js` is running the real bc-authorize path
  or the simulated fallback (see `cibaSimulatedService.js`); it only ever
  talks to the same session-scoped pending-request object either way.
- Not building a generic "open any step-up method in a new tab" framework —
  this is CIBA-specific, matching the existing idiom of hardcoded UC22/CIBA
  special-casing already in this codebase.

## Architecture

### New backend endpoints (`demo_api_server/routes/ciba.js`)

Two additions alongside the existing `/initiate`, `/poll/:authReqId`,
`/approve-now/:authReqId`, `/cancel/:authReqId`:

```javascript
// GET /api/auth/ciba/request/:authReqId — public display details for the
// approval page. Same session-ownership check as /poll.
router.get('/request/:authReqId', authenticateToken, (req, res) => {
  const pending = req.session.cibaRequests?.[req.params.authReqId];
  if (!pending) return res.status(404).json({ error: 'unknown_request' });
  if (Date.now() > pending.expiresAt) return res.status(410).json({ error: 'request_expired' });
  res.json({
    binding_message: pending.binding_message,
    amount: pending.amount ?? null,
    from_account_label: pending.fromAccountLabel ?? null,
    to_account_label: pending.toAccountLabel ?? null,
  });
});

// POST /api/auth/ciba/deny/:authReqId — explicit user denial, distinct from
// cancel (give up waiting) or expire (timed out). Marks the pending request
// so the ORIGINAL tab's next /poll call returns a real 403 denied — the
// exact same response shape /poll already returns for a real-PingOne deny,
// so no new branch is needed in AIAgent.js's poll-result handling.
router.post('/deny/:authReqId', authenticateToken, (req, res) => {
  const pending = req.session.cibaRequests?.[req.params.authReqId];
  if (!pending) return res.status(404).json({ error: 'unknown_request' });
  pending.deniedByUser = true;
  req.session.save((saveErr) => {
    if (saveErr) console.error('[CIBA] session save error on deny:', saveErr);
    res.json({ ok: true });
  });
});
```

`GET /poll/:authReqId`'s existing simulated branch gets one new check ahead
of the `isSimulatedApproved` check: if `pending.deniedByUser`, delete the
pending request and return the same 403 `{status:'denied', error:'access_denied'}`
shape it already returns for the real-CIBA-deny case (~line 311-315 today) —
reuses the existing branch, no new response shape for the frontend to handle.

`initiate`'s pending-request object (`req.session.cibaRequests[authReqId]`,
currently `{initiatedAt, expiresAt, loginHint, scope, acr_values,
binding_message, simulated}`) gains three optional fields: `amount`,
`fromAccountLabel`, `toAccountLabel` — populated from the same request body
fields the two frontend call sites already have in scope (see below), so
`/initiate`'s existing required-field validation is unchanged; these are
purely additive and optional.

### New frontend page (`demo_api_ui`)

`CibaApprovalPage.js`, routed at `/ciba-approve` in `App.js` (a plain route,
not nested under the dashboard shell — this tab has no session-restore
concerns beyond the shared cookie, same as `/pingcli` or `/use-cases`).
Reads `authReqId` from the query string, `GET`s the new endpoint, renders
the approved "PingOne Identity Verification" branded card:

```
PingOne Identity Verification
A sign-in attempt needs your approval.
  Transfer: $600.00
  Checking → Savings
[Approve]  [Deny]
```

Approve → `POST /api/auth/ciba/approve-now/:authReqId` (existing, unchanged).
Deny → `POST /api/auth/ciba/deny/:authReqId` (new). Either way, the page
then shows a persistent result state ("Approved ✓" / "Denied") — the tab
stays open per your call; no auto-close, no `window.close()`.

### Changed call sites (`demo_api_ui/src/components/AIAgent.js`)

Both places that currently initiate CIBA get the same two-line change —
open a blank tab *before* the initiate fetch (so the browser still counts
it as a direct result of the user's gesture), then point it at the real URL
once `/initiate` resolves:

1. `runAction`'s step-up branch (currently ~line 4057-4093): the blank tab
   opens at the top of the click handler that starts `runAction`, before any
   `await`. `amount`/`fromAccountLabel`/`toAccountLabel` for the new
   `/initiate` body come from the same `normalized`/`form` fields already
   used two lines above to build the OTP modal's `contextLine` (~line
   4036-4047) — no new data plumbing, just reading fields already in scope.
2. `handleNlResumeResponse`'s CIBA branch (currently ~line 7002-7033): same
   pattern. `response.transactionAmount`/`fromAccountId`/`toAccountId` are
   already read two branches below (~line 7078-7085) for the monetary HITL
   consent shape — reuse those, resolving account *labels* (not raw ids) via
   whatever the existing `liveAccounts` state already uses to render account
   names elsewhere in this file (avoids a new backend account lookup).

Neither call site's existing behavior changes otherwise — the chat bubble,
the inline Approve button, `pollCibaStepUp`/`pollCibaThenResumeNl`, and the
resume-on-approval logic are all untouched.

## Data flow

```
User triggers a CIBA-eligible action (chip / typed transfer / demo step)
  → window.open('', '_blank') fires synchronously (tab handle saved in a ref)
  → POST /api/auth/ciba/initiate (body now also carries amount/account labels)
  → tab handle navigates to /ciba-approve?authReqId=...
  → chat still shows today's "Waiting for CIBA approval" bubble + inline Approve
  → CibaApprovalPage: GET /api/auth/ciba/request/:authReqId → renders card
  → user clicks Approve or Deny in the NEW tab
      Approve → POST .../approve-now/:authReqId (existing)
      Deny    → POST .../deny/:authReqId (new)
  → ORIGINAL tab's existing poll loop picks up the result on its next tick,
    completely unchanged: approved → runAction/resend with isRefire; denied →
    the existing "❌ ... denied ..." message already wired for real-CIBA-deny
```

## Error handling

- **Popup blocked anyway** (user has "block all popups" hard-on, or
  `window.open('', '_blank')` otherwise returns `null`): silently fall back
  to today's inline-only flow. No new failure mode — the inline Approve
  button is a complete path on its own already.
- **Tab left open past expiry**: `GET /request/:authReqId` returns 410 once
  `Date.now() > pending.expiresAt`; the approval page shows the same
  "expired, please try again" state the chat already shows for an expired
  poll.
- **Double-decision** (user clicks Approve then Deny, or the tab is
  reloaded after deciding): both endpoints no-op past the first decision
  the same way `/poll` already does — `pending` is deleted from the session
  once resolved, so a second call 404s exactly like calling `/poll` twice
  after resolution does today.

## Testing

- **Backend** (`demo_api_server/tests` — extend the existing `routes/ciba.js`
  suite): `GET /request/:authReqId` found/not-found/expired; `POST
  /deny/:authReqId` marks `deniedByUser` and the next `/poll` call returns
  the existing denied shape; `/initiate` still works with no `amount`/label
  fields in the body (backward compatible for any other caller).
- **Frontend**: a focused test for `CibaApprovalPage` (renders fetched
  details, Approve/Deny call the right endpoints, expired state renders);
  a test at each `AIAgent.js` call site that `window.open` is invoked
  synchronously ahead of the `initiate` fetch and later navigated (mock
  `window.open`, assert `.href`/`.location` set after resolution).
- **Live smoke test** (manual, post-implementation): run UC22 from
  `/use-cases`, confirm a second tab opens automatically showing the real
  $600 / Checking → Savings details, approving there resumes the original
  tab's transfer exactly as approving inline does today.

## Files touched

| File | Change |
|---|---|
| `demo_api_server/routes/ciba.js` | New `GET /request/:authReqId`, new `POST /deny/:authReqId`, one new branch in `GET /poll/:authReqId`'s simulated path, `amount`/`fromAccountLabel`/`toAccountLabel` added to the `/initiate` pending-request object |
| `demo_api_ui/src/pages/CibaApprovalPage.js` | New file |
| `demo_api_ui/src/App.js` | New `/ciba-approve` route |
| `demo_api_ui/src/components/AIAgent.js` | Both CIBA-initiate call sites open+navigate a tab; no other logic changed |
| `demo_api_server/tests/...` (existing `ciba` test file) | New test cases for the 2 new endpoints |
| `demo_api_ui/src/pages/__tests__/CibaApprovalPage.test.js` | New file |

## Open risks

- Account *labels* (not just amounts) aren't necessarily available at both
  call sites in the same shape — the implementation plan should confirm the
  exact field names at each site before writing the `/initiate` body change,
  rather than assume the design doc's field names are pixel-exact.
- `window.open('', '_blank')` popup-allowance behavior can still vary by
  browser/embedding context (e.g. an iframe-embedded demo) — the "silently
  fall back to inline" behavior is the safety net; no further mitigation
  planned unless live testing shows it's needed more often than expected.
