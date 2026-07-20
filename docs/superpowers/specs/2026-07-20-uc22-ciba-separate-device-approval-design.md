# UC22 CIBA — Separate-Device Approval Page — Design

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan
**Scope:** `demo_api_server` (2 new `routes/ciba.js` endpoints) + `demo_api_ui`
(1 new page/route, small changes to the 2 existing CIBA-initiate call sites
in `AIAgent.js`, 1 new small QR-generation dependency).

## Goal

CIBA is "client-initiated backchannel authentication" — the whole point is
that approval happens *out of band*, on a separate device. Today the demo
shows a chat bubble with an inline "Approve" button in the same window,
which doesn't sell that story. This adds a second browser tab, styled as a
branded PingOne approval page, that opens automatically when CIBA starts —
so the presenter visibly approves "on another device" instead of clicking a
button next to the chat that requested it. That page also shows a QR code
linking to itself, so a presenter can scan it with an actual phone instead
of (or in addition to) the auto-opened tab — the strongest version of "a
separate device," not just a separate window on the same machine.

**Not the OAuth Device Authorization Grant.** A QR code next to a `user_code`
and a "waiting for approval" poller looks like RFC 8628's device flow (a
genuinely different, PingOne-supported auth pattern — kiosk/TV-style
enrollment). CIBA has no `user_code` or QR concept in its spec: it identifies
the user via `login_hint` and pushes to their already-registered device. This
design does **not** implement device-flow semantics — the QR code here is
purely a convenience carrier for the CIBA approval page's own URL
(`/ciba-approve?authReqId=...`), not a protocol element. Don't render a
`user_code` field or imply the code itself authorizes anything; that would
misrepresent which grant this demo is exercising.

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

**Storage model change (required for the QR code):** the existing pending-request
object lives only in `req.session.cibaRequests[authReqId]` — reachable *only*
from the same browser/session that called `/initiate`. A phone that scans the
QR code is a different browser with no session cookie at all, so it cannot be
gated the same way real CIBA gates a push (which targets an already-enrolled,
already-authenticated device). The trust model here is the one magic
links/password-reset links already use: **possession of the unguessable
`authReqId` is the credential**, not the caller's session.

To support that without weakening the existing session-gated endpoints, add a
small session-independent store, `cibaPendingRequestsStore.js` (in-memory
`Map<authReqId, {ownerUserId, expiresAt, binding_message, amount,
fromAccountLabel, toAccountLabel, simulated, status}>`, mirroring the
in-process pattern `cibaSimulatedService.js` already uses), populated by
`/initiate` alongside (not instead of) the existing `req.session.cibaRequests`
entry:

```javascript
// GET /api/auth/ciba/request/:authReqId — PUBLIC (no authenticateToken).
// Possession of authReqId is the credential, same as a magic link.
router.get('/request/:authReqId', (req, res) => {
  const pending = cibaPendingRequestsStore.get(req.params.authReqId);
  if (!pending) return res.status(404).json({ error: 'unknown_request' });
  if (Date.now() > pending.expiresAt) return res.status(410).json({ error: 'request_expired' });
  res.json({
    binding_message: pending.binding_message,
    amount: pending.amount ?? null,
    from_account_label: pending.fromAccountLabel ?? null,
    to_account_label: pending.toAccountLabel ?? null,
  });
});

// POST /api/auth/ciba/deny/:authReqId — PUBLIC, same trust model. Distinct
// from cancel (give up waiting) or expire (timed out) — an explicit denial.
router.post('/deny/:authReqId', (req, res) => {
  const pending = cibaPendingRequestsStore.get(req.params.authReqId);
  if (!pending) return res.status(404).json({ error: 'unknown_request' });
  cibaPendingRequestsStore.markDenied(req.params.authReqId);
  res.json({ ok: true });
});
```

The **existing** session-gated endpoints (`/poll`, `/approve-now`, `/cancel`)
are unchanged in behavior and unchanged in security posture: they keep
checking `req.session.cibaRequests[authReqId]` for ownership exactly as
today. `/poll`'s simulated branch gets one new check ahead of
`isSimulatedApproved`: if `cibaPendingRequestsStore.get(authReqId)?.status
=== 'denied'` (set by the new public deny endpoint, from either the
auto-opened tab or a phone), return the same 403
`{status:'denied', error:'access_denied'}` shape `/poll` already returns for
a real-PingOne deny — reuses the existing branch, no new response shape for
`AIAgent.js`'s poll handling to learn. `approve-now` (existing, session-gated)
additionally writes `status: 'approved'` into the new store so a QR-scanned
phone's `GET /request/:authReqId` reflects it too (`404` after
`markDenied`/approval — deleted, same "resolved" semantics `/poll` already
has for its own map).

`initiate`'s existing `req.session.cibaRequests[authReqId]` object
(`{initiatedAt, expiresAt, loginHint, scope, acr_values, binding_message,
simulated}`) is unchanged; the new store entry is a parallel write at the
same call site, carrying the display-relevant subset plus `amount`,
`fromAccountLabel`, `toAccountLabel` — populated from the same request body
fields the two frontend call sites already have in scope (see below).
`/initiate`'s existing required-field validation is unchanged; these are
purely additive fields on a new, separate object.

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

[QR code — encodes this same page's own URL]
Scan to open this approval on your phone.
```

The QR code encodes `window.location.href` (the page's own
`/ciba-approve?authReqId=...` URL) — scanning it with a phone opens the same
page there, but that phone has *no session cookie at all* (different
browser). This is exactly why `GET /request/:authReqId` and the new `deny`
endpoint are public and keyed by the session-independent
`cibaPendingRequestsStore` above, not `req.session` — the phone authenticates
by possessing the link, not by being logged in. New frontend dependency: a
small client-side QR generator (e.g. `qrcode.react`) — no external QR-generation service call,
consistent with keeping the demo self-contained.

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
  → POST /api/auth/ciba/initiate (body now also carries amount/account labels;
    writes both req.session.cibaRequests[id] (existing) AND
    cibaPendingRequestsStore (new, session-independent))
  → tab handle navigates to /ciba-approve?authReqId=...
  → chat still shows today's "Waiting for CIBA approval" bubble + inline Approve
  → CibaApprovalPage (desktop tab OR a phone that scanned the QR code):
    GET /api/auth/ciba/request/:authReqId (public) → renders card + QR code
  → user clicks Approve or Deny, from EITHER the desktop tab or the phone
      Approve → POST .../approve-now/:authReqId (existing, session-gated —
                only reachable from the desktop tab, which has the cookie)
      Deny    → POST .../deny/:authReqId (new, public — reachable from either)
  → ORIGINAL tab's existing poll loop picks up the result on its next tick,
    completely unchanged: approved → runAction/resend with isRefire; denied →
    the existing "❌ ... denied ..." message already wired for real-CIBA-deny
```

Approve is intentionally *not* made public/phone-reachable — it's the action
that actually resumes the pending transfer, and doing that still goes
through the existing session-gated `approve-now`, matching how the demo
already trusts that endpoint. A phone that scanned the QR can *deny* (a
safe, one-way action) or just *view* the pending request; approving still
happens on the device that's logged into the demo session, same as today.

## Error handling

- **Popup blocked anyway** (user has "block all popups" hard-on, or
  `window.open('', '_blank')` otherwise returns `null`): silently fall back
  to today's inline-only flow. No new failure mode — the inline Approve
  button is a complete path on its own already.
- **Tab/phone opened past expiry**: `GET /request/:authReqId` returns 410 once
  `Date.now() > pending.expiresAt`; the approval page shows the same
  "expired, please try again" state the chat already shows for an expired
  poll.
- **Double-decision** (deny from the phone after already approving from the
  desktop tab, or vice versa, or a reload after deciding): both new
  endpoints no-op past the first resolution — `cibaPendingRequestsStore`
  deletes the entry once `approve-now` or `deny` resolves it, so a second
  call 404s, the same "resolved" semantics `/poll` already has for its own
  session-nested copy.
- **`cibaPendingRequestsStore` memory growth**: entries are deleted on
  resolution (approve/deny) same as the session-nested map; anything left
  unresolved is pruned on its own `expiresAt` (opportunistic sweep on next
  store access, matching the existing pattern in `cibaSimulatedService.js`)
  so an abandoned QR scan can't leak memory indefinitely.

## Testing

- **Backend** (`demo_api_server/tests` — extend the existing `routes/ciba.js`
  suite): `GET /request/:authReqId` found/not-found/expired, reachable with
  no `x-test-user`/session at all (proves it's genuinely public); `POST
  /deny/:authReqId` same (public, no session) and the next `/poll` call (on
  the ORIGINAL session) returns the existing denied shape; `approve-now`
  (existing) also resolves the new store, so a subsequent `GET
  /request/:authReqId` 404s; `/initiate` still works with no `amount`/label
  fields in the body (backward compatible for any other caller).
- **Frontend**: a focused test for `CibaApprovalPage` (renders fetched
  details, Approve/Deny call the right endpoints, expired state renders,
  the QR code element encodes `window.location.href`); a test at each
  `AIAgent.js` call site that `window.open` is invoked synchronously ahead
  of the `initiate` fetch and later navigated (mock `window.open`, assert
  `.href`/`.location` set after resolution).
- **Live smoke test** (manual, post-implementation): run UC22 from
  `/use-cases`, confirm a second tab opens automatically showing the real
  $600 / Checking → Savings details AND a scannable QR code, approving from
  either the tab or a phone that scanned the QR resumes the original tab's
  transfer exactly as approving inline does today.

## Files touched

| File | Change |
|---|---|
| `demo_api_server/services/cibaPendingRequestsStore.js` | New file — session-independent `Map<authReqId, {...}>`, mirrors `cibaSimulatedService.js`'s in-process pattern |
| `demo_api_server/routes/ciba.js` | New `GET /request/:authReqId`, new `POST /deny/:authReqId` (both public), one new branch in `GET /poll/:authReqId`'s simulated path, `/initiate` and `approve-now` write through to the new store, `amount`/`fromAccountLabel`/`toAccountLabel` added at `/initiate` |
| `demo_api_ui/package.json` | New dependency: a small client-side QR generator (e.g. `qrcode.react`) |
| `demo_api_ui/src/pages/CibaApprovalPage.js` | New file — includes the self-referential QR code |
| `demo_api_ui/src/App.js` | New `/ciba-approve` route |
| `demo_api_ui/src/components/AIAgent.js` | Both CIBA-initiate call sites open+navigate a tab; no other logic changed |
| `demo_api_server/tests/...` (existing `ciba` test file) | New test cases for the 2 new endpoints, including "reachable with no session" |
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
- **New attack surface: two public, unauthenticated endpoints.** This is a
  deliberate, scoped trade — `authReqId` is already a high-entropy random
  token with a 5-minute TTL (same as today), and `GET /request` only ever
  returns a transfer amount + account *labels* (not account numbers, not
  tokens) for a request that's about to expire anyway. `POST /deny` can only
  ever make an approval *fail* (never succeed) without the caller having a
  session — it cannot be used to approve anything. This mirrors the trust
  model of the real CIBA email/SMS-link delivery mode
  (`demo_api_server/routes/ciba.js`'s `/notify` route is already public for
  the same reason). If this were ever pointed at a non-demo environment,
  revisit whether `GET /request` should redact the amount for an
  unauthenticated caller — out of scope for this demo-only feature.
