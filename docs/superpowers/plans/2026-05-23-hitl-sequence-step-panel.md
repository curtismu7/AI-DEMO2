# HITL Sequence Diagram — Step-by-Step Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Mermaid render on `/architecture/hitl` with a custom SVG renderer and interactive left panel that walks through each HITL consent flow step with `why`, `request/response`, `rulesEvaluated`, and `onError` explanations — matching the UX of `/sequence-diagram` exactly.

**Architecture:** New self-contained `HitlSequenceDiagram.js` holds all data (`HITL_PARTICIPANTS`, `HITL_STEPS`, `HITL_SCENARIOS`) and renders the custom SVG. `StepInfoPanel` and its helpers are copied verbatim from `SequenceDiagramPage.js`. `HitlSequencePage.jsx` is stripped of its Mermaid dependency and renders the new component instead.

**Tech Stack:** React 18 (CRA), inline styles, SVG, no new npm dependencies.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_ui/src/components/HitlSequenceDiagram.js` | Create | All step data, SVG renderer, simulation controls, StepInfoPanel copy |
| `demo_api_ui/src/components/HitlSequencePage.jsx` | Modify | Strip Mermaid, render HitlSequenceDiagram |

---

## Reference: Key patterns from SequenceDiagramPage.js

Before starting, understand these patterns — they are copied directly:

**Participant x-position formula:**
```js
const participantIndex = (id) => PARTICIPANTS.findIndex((p) => p.id === id);
const x = 100 + participantIndex(id) * 120;  // horizontal centre of each lifeline
```

**Step y-position formula:**
```js
const y = 120 + stepIndex * 20;  // vertical position of each step row
```

**Active/past/future colouring:**
```js
stroke={isActive ? "#004687" : isPast ? "#dbeafe" : "#cbd5e1"}
strokeWidth={isActive ? 3 : 1.5}
opacity={isPast ? 0.5 : 1}
```

**Simulation loop (2500ms per step, 4000ms hold on last):**
```js
steps.slice(startIdx).forEach((_, offset) => {
  const i = startIdx + offset;
  const t = setTimeout(() => {
    applyStep(i);
    if (i === steps.length - 1) {
      const done = setTimeout(() => { resetDiagram(); setIsSimulating(false); }, 4000);
      simTimeouts.current.push(done);
    }
  }, (offset + (startIdx === 0 ? 0 : 1)) * 2500);
  simTimeouts.current.push(t);
});
```

**Resizable panel drag:**
```js
const handleMouseDownResize = (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = leftPanelWidth;
  const handleMouseMove = (moveEvent) => {
    const deltaX = moveEvent.clientX - startX;
    const newWidth = Math.max(240, Math.min(500, startWidth + deltaX));
    setLeftPanelWidth(newWidth);
  };
  const handleMouseUp = () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
};
```

---

## Task 1: Scaffold HitlSequenceDiagram.js with participants and empty step array

**Files:**
- Create: `demo_api_ui/src/components/HitlSequenceDiagram.js`

- [ ] **Step 1: Create the file with imports, participants, and empty HITL_STEPS**

```js
import { useState, useRef, useCallback, useEffect } from "react";

// HITL_PARTICIPANTS — matches hitl-sequence.mmd participant declarations
const HITL_PARTICIPANTS = [
  { id: "B",   label: "Browser" },
  { id: "BFF", label: "BFF (demo_api_server)" },
  { id: "TC",  label: "transactionConsent.js" },
  { id: "P1",  label: "PingOne MFA" },
];

// HITL_STEPS — populated in Task 2 and Task 3
const HITL_STEPS = [];

// HITL_SCENARIOS — populated in Task 4
const HITL_SCENARIOS = {
  all:       HITL_STEPS,
  homegrown: HITL_STEPS.filter((s) => s.path === "shared" || s.path === "homegrown"),
  onetime:   HITL_STEPS.filter((s) => s.path === "shared" || s.path === "onetime"),
  device:    HITL_STEPS.filter((s) => s.path === "shared" || s.path === "device"),
};

export default function HitlSequenceDiagram() {
  return <div style={{ padding: "1rem", color: "#475569" }}>Loading…</div>;
}
```

- [ ] **Step 2: Verify it imports cleanly — no build errors**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/HitlSequenceDiagram.js
git commit -m "feat(hitl): scaffold HitlSequenceDiagram with participants"
```

---

## Task 2: Add HITL_STEPS — shared preamble + Path 1 (Homegrown OTP)

**Files:**
- Modify: `demo_api_ui/src/components/HitlSequenceDiagram.js`

Reference: `HitlSequencePage.jsx` lines 10–86 for the exact Mermaid source to map.

- [ ] **Step 1: Replace the empty HITL_STEPS array with the shared preamble steps (path: "shared") and Path 1 steps (path: "homegrown")**

```js
const HITL_STEPS = [
  // ── Shared preamble ─────────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "P1"],
    path: "shared",
    text: "ALL PATHS — 428 gate enforces consent requirement",
    description: "428 gate",
    why: "Every write operation (transfer, withdrawal, deposit >= $250) is gated by a mandatory consent challenge. The 428 Precondition Required response is the BFF telling the browser 'you must prove consent before I'll execute this'. No challenge ID, no transaction.",
    onError: [
      "Feature flag ff_hitl_enabled=false — gate is bypassed entirely; expected in dev/test only",
      "Amount below threshold — 428 is not issued; transaction proceeds without challenge",
    ],
  },
  {
    step: 1,
    path: "shared",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions (transfer, or withdrawal/deposit >= $250)",
    type: "request",
    description: "POST /api/transactions",
    why: "The user has triggered a write operation in the UI. The BFF receives it, checks the HITL feature flag and amount threshold, and immediately returns 428 — it does not attempt the transaction. This makes the gate synchronous and impossible to race.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500 },
    },
    response: {
      status: 428,
      headers: { "Content-Type": "application/json" },
      body: { error: "precondition_required", message: "Consent challenge required before executing this transaction" },
    },
    rulesEvaluated: [
      { rule: "ff_hitl_enabled = true", result: "PASS", detail: "configStore.getEffective('ff_hitl_enabled') = 'true'" },
      { rule: "amount >= confirm_threshold_usd ($250)", result: "PASS", detail: "amount=500 >= threshold=250" },
    ],
    onError: [
      "200 returned instead of 428 — HITL flag is off or amount is below threshold",
      "401 — session expired; user must re-authenticate before retrying",
    ],
  },
  {
    step: 2,
    path: "shared",
    from: "BFF",
    to: "B",
    label: "428 Precondition Required",
    type: "response",
    description: "428 response",
    why: "RFC 6585 §3: 428 signals that the server requires a precondition the client hasn't met. The UI uses this status code to trigger the consent modal — it's not an error, it's a protocol signal.",
    response: {
      status: 428,
      body: { error: "precondition_required", message: "Consent challenge required" },
    },
    onError: [
      "UI treats 428 as a generic error and shows an error toast — UI must handle 428 specifically",
      "Browser blocks the response — CORS misconfiguration on the BFF",
    ],
  },
  {
    step: 3,
    path: "shared",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge { type, amount, fromAccountId, ... }",
    type: "request",
    description: "Create challenge",
    why: "The browser now creates a consent challenge, attaching the transaction details. The BFF hashes a snapshot of those details into the challenge record — this snapshot is checked at verify time to prevent tampering with the amount or destination between challenge creation and execution.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", amount: 500, fromAccountId: "acct_01", toAccountId: "acct_02", currency: "USD" },
    },
    response: {
      status: 201,
      body: { challengeId: "ch_01ABC", expiresAt: "2026-05-23T…", snapshot: "sha256:…" },
    },
    onError: [
      "400 — missing required field (type, amount, fromAccountId)",
      "401 — session expired",
      "Challenge created but snapshot hash wrong — tampering detection will fail at verify step",
    ],
  },
  {
    step: 4,
    path: "shared",
    from: "BFF",
    to: "TC",
    label: "createChallenge()",
    type: "request",
    description: "createChallenge()",
    why: "The BFF delegates challenge lifecycle to transactionConsentChallenge.js. This service stores the challenge in the session (keyed by challengeId), including a SHA-256 snapshot of the transaction details. Keeping it in the session ties the challenge to the authenticated user — a different session cannot consume it.",
    request: { call: "createChallenge({ type, amount, fromAccountId, toAccountId, userId })" },
    response: { returns: "{ challengeId, expiresAt, snapshot }" },
    rulesEvaluated: [
      { rule: "User is authenticated", result: "PASS", detail: "req.session.user.id present" },
      { rule: "Challenge fields valid", result: "PASS", detail: "type, amount, fromAccountId all present and typed correctly" },
    ],
    onError: [
      "Session missing — createChallenge throws; BFF returns 401",
      "Duplicate challengeId collision — extremely unlikely (UUID v4); retry is safe",
    ],
  },
  {
    step: 5,
    path: "shared",
    from: "BFF",
    to: "B",
    label: "201 { challengeId, expiresAt, snapshot }",
    type: "response",
    description: "Challenge created",
    why: "The browser receives the challengeId it will attach to every subsequent consent-flow request. The expiresAt field lets the UI display a countdown and disable the form when the challenge expires. The snapshot is opaque to the browser — it's for server-side tamper detection only.",
    response: {
      status: 201,
      body: { challengeId: "ch_01ABC", expiresAt: "2026-05-23T12:05:00Z", snapshot: "sha256:abc…" },
    },
    onError: [
      "UI doesn't store challengeId — subsequent confirm call will 404",
      "UI ignores expiresAt — user submits OTP after expiry; verify returns 410 Gone",
    ],
  },

  // ── Path 1: Homegrown OTP ────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "TC"],
    path: "homegrown",
    text: "PATH 1 — mode = homegrown (BFF-generated OTP, any amount)",
    description: "Path 1 start",
    why: "When hitl_consent_mfa_mode=homegrown, the BFF generates and emails a 6-digit OTP itself — no PingOne call needed. This path is the simplest: no external MFA dependency, no device enrollment, works at any amount. It's the fallback for environments without PingOne MFA configured.",
    onError: [
      "Config flag is wrong — check configStore.getEffective('hitl_consent_mfa_mode')",
    ],
  },
  {
    step: 6,
    path: "homegrown",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/confirm",
    type: "request",
    description: "Confirm challenge (P1)",
    why: "The browser posts to confirm, signalling that the user has reviewed the transaction details in the modal and is ready to receive the OTP. The BFF checks the challenge is still pending and not expired before generating the OTP.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/confirm",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: {},
    },
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z" },
    },
    onError: [
      "404 — challengeId not found or already consumed",
      "410 — challenge expired (expiresAt in the past)",
      "403 — session user doesn't match challenge subject",
    ],
  },
  {
    step: 7,
    path: "homegrown",
    from: "BFF",
    to: "TC",
    label: "confirmChallenge() — mode=homegrown — generates OTP, stores HMAC hash",
    type: "request",
    description: "Generate OTP",
    why: "transactionConsentChallenge.js generates a cryptographically random 6-digit OTP and stores its HMAC-SHA256 hash in the challenge record (never the plaintext). The OTP is emailed to the user's registered address. Storing the hash means a DB read can't leak the OTP.",
    request: { call: "confirmChallenge(challengeId, { mode: 'homegrown' })" },
    response: { returns: "{ otpSent: true, otpExpiresAt }" },
    rulesEvaluated: [
      { rule: "Challenge status = pending", result: "PASS", detail: "ch.status='pending'" },
      { rule: "Challenge not expired", result: "PASS", detail: "ch.expiresAt > now" },
      { rule: "mode = homegrown", result: "PASS", detail: "configStore 'hitl_consent_mfa_mode' = 'homegrown'" },
    ],
    onError: [
      "Email send fails — BFF returns 500; user must retry",
      "OTP generation uses Math.random() — must use crypto.randomInt() for security",
    ],
  },
  {
    step: 8,
    path: "homegrown",
    from: "BFF",
    to: "B",
    label: "200 { otpSent: true, otpExpiresAt }",
    type: "response",
    description: "OTP sent (P1)",
    why: "The browser receives confirmation that an OTP email was sent. The UI should now show the OTP entry field and the expiry countdown. Note: no maskedContact is returned on this path (unlike Path 2) because the BFF already knows the address from the session.",
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z" },
    },
    onError: [
      "UI doesn't show OTP field — it must check otpSent: true to reveal the input",
    ],
  },
  {
    step: 9,
    path: "homegrown",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/verify-otp { otp }",
    type: "request",
    description: "Submit OTP (P1)",
    why: "The user enters the 6-digit OTP and submits. The BFF will compare it against the stored HMAC hash using timingSafeEqual to prevent timing-based oracle attacks.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/verify-otp",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { otp: "123456" },
    },
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "401 — OTP wrong; challenge status remains 'pending'; user can retry until expiry",
      "410 — OTP expired (otpExpiresAt in the past)",
      "429 — too many wrong OTP attempts (if rate limiting is enabled)",
    ],
  },
  {
    step: 10,
    path: "homegrown",
    from: "BFF",
    to: "TC",
    label: "verifyOtp() — timingSafeEqual(hash) — status = confirmed",
    type: "request",
    description: "Verify OTP (P1)",
    why: "timingSafeEqual prevents an attacker from guessing the OTP one digit at a time by measuring response latency. Once verified, the challenge status is set to 'confirmed' and a confirmExpiresAt window is set — the actual transaction must be submitted within this window.",
    request: { call: "verifyOtp(challengeId, otp)" },
    response: { returns: "{ confirmed: true, confirmExpiresAt }" },
    rulesEvaluated: [
      { rule: "HMAC hash matches OTP", result: "PASS", detail: "crypto.timingSafeEqual(stored, submitted)" },
      { rule: "OTP not expired", result: "PASS", detail: "ch.otpExpiresAt > now" },
    ],
    onError: [
      "Using string equality instead of timingSafeEqual — timing oracle vulnerability",
      "Status not updated to 'confirmed' — transaction step will re-challenge",
    ],
  },
  {
    step: 11,
    path: "homegrown",
    from: "BFF",
    to: "B",
    label: "200 { challengeId, confirmExpiresAt }",
    type: "response",
    description: "OTP verified (P1)",
    why: "The browser now knows the challenge is confirmed. It has a window (confirmExpiresAt) to submit the actual transaction. The UI should immediately POST the transaction without waiting for user interaction — the consent was given.",
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "UI delays transaction submission past confirmExpiresAt — transaction is rejected",
    ],
  },
  {
    step: 12,
    path: "homegrown",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions { consentChallengeId }",
    type: "request",
    description: "Execute transaction (P1)",
    why: "The original transaction is now re-submitted with the consentChallengeId attached. The BFF will verify and consume the challenge (one-time use) before executing. The transaction payload is exactly what the user reviewed — the snapshot check ensures it hasn't changed.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500, consentChallengeId: "ch_01ABC" },
    },
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed" },
    },
    onError: [
      "409 — challenge already consumed (replay attempt)",
      "422 — snapshot mismatch (amount or destination tampered)",
      "410 — confirmExpiresAt passed",
    ],
  },
  {
    step: 13,
    path: "homegrown",
    from: "BFF",
    to: "TC",
    label: "verifyAndConsumeChallenge() — snapshot match, one-time use",
    type: "request",
    description: "Consume challenge (P1)",
    why: "Two invariants are checked atomically: (1) the transaction snapshot matches what the user approved — prevents amount/destination tampering between challenge creation and execution; (2) the challenge is marked consumed so it can never be replayed, even if the network retransmits the request.",
    request: { call: "verifyAndConsumeChallenge(challengeId, { type, amount, fromAccountId, toAccountId })" },
    response: { returns: "{ consumed: true }" },
    rulesEvaluated: [
      { rule: "Challenge status = confirmed", result: "PASS", detail: "ch.status='confirmed'" },
      { rule: "Snapshot matches transaction payload", result: "PASS", detail: "sha256(payload) === ch.snapshot" },
      { rule: "confirmExpiresAt not passed", result: "PASS", detail: "ch.confirmExpiresAt > now" },
      { rule: "Challenge not already consumed", result: "PASS", detail: "ch.consumed = false" },
    ],
    onError: [
      "Snapshot mismatch — attacker modified amount after user approved",
      "Challenge already consumed — replay attack or network retry",
    ],
  },
  {
    step: 14,
    path: "homegrown",
    from: "BFF",
    to: "B",
    label: "200 transaction result",
    type: "response",
    description: "Transaction complete (P1)",
    why: "The transaction executed successfully. The challenge lifecycle is complete — created, confirmed, consumed. The UI can now show the success state and close the modal.",
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed", amount: 500, type: "transfer" },
    },
    onError: [
      "Downstream banking error after consent passed — show error but don't re-challenge",
    ],
  },
];
```

- [ ] **Step 2: Verify build still passes**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/HitlSequenceDiagram.js
git commit -m "feat(hitl): add HITL_STEPS shared preamble + Path 1 (Homegrown OTP)"
```

---

## Task 3: Add HITL_STEPS — Path 2 (PingOne One-Time) and Path 3 (Device Picker)

**Files:**
- Modify: `demo_api_ui/src/components/HitlSequenceDiagram.js`

Append these entries to the `HITL_STEPS` array (after step 14):

- [ ] **Step 1: Append Path 2 and Path 3 steps to HITL_STEPS**

```js
  // ── Path 2: PingOne One-Time OTP ──────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "P1"],
    path: "onetime",
    text: "PATH 2 — mode = onetime (DEFAULT) — PingOne sends OTP, no device enrollment needed",
    description: "Path 2 start",
    why: "The default mode. PingOne sends the OTP directly to the user's email or phone on file — no device enrollment, no FIDO2. The BFF acts as an intermediary: it fetches the user's contact details from PingOne, initiates a deviceAuthentication, and then delegates OTP verification to PingOne.",
    onError: [
      "User has no email/phone in PingOne — GET /users/:id returns no contact; confirm fails",
    ],
  },
  {
    step: 15,
    path: "onetime",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/confirm",
    type: "request",
    description: "Confirm challenge (P2)",
    why: "Same endpoint as Path 1 confirm. The BFF reads the mode config flag to decide which confirmation path to take. On this path it will look up the user's PingOne contact details before initiating the deviceAuthentication.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/confirm",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: {},
    },
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z", maskedContact: "j***@example.com" },
    },
    onError: [
      "404 — challengeId not found",
      "410 — challenge expired",
      "PingOne returns 404 for user — userId in session doesn't exist in PingOne",
    ],
  },
  {
    step: 16,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "confirmChallenge() — mode=onetime — getPingOneUserContact(userId)",
    type: "request",
    description: "Confirm, get contact",
    why: "transactionConsentChallenge.js switches on mode=onetime and fetches the user's contact details from PingOne via the management API. The maskedContact (e.g. 'j***@example.com') is returned to the browser so the user knows where the OTP is being sent.",
    request: { call: "confirmChallenge(challengeId, { mode: 'onetime' })" },
    response: { returns: "{ otpSent: true, otpExpiresAt, maskedContact }" },
    rulesEvaluated: [
      { rule: "Challenge status = pending", result: "PASS", detail: "ch.status='pending'" },
      { rule: "mode = onetime", result: "PASS", detail: "configStore 'hitl_consent_mfa_mode' = 'onetime'" },
    ],
    onError: [
      "PingOne worker token expired — re-auth required before contact lookup",
    ],
  },
  {
    step: 17,
    path: "onetime",
    from: "BFF",
    to: "P1",
    label: "GET /environments/{envId}/users/{userId} (worker token)",
    type: "request",
    description: "Get user contact",
    why: "The BFF calls the PingOne management API with a worker (client_credentials) token to fetch the user's email and mobilePhone. A user token cannot be used here — the user is at the consent modal, not in an active OAuth flow.",
    request: {
      method: "GET",
      url: "https://api.pingone.com/v1/environments/{envId}/users/{userId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}" },
    },
    response: {
      status: 200,
      body: { id: "{userId}", email: "jane.doe@example.com", mobilePhone: "+1555…" },
    },
    onError: [
      "401 — worker token expired; BFF must re-acquire via client_credentials before retrying",
      "404 — userId not found in PingOne; check session userId vs PingOne user store",
    ],
  },
  {
    step: 18,
    path: "onetime",
    from: "P1",
    to: "BFF",
    label: "{ email, mobilePhone }",
    type: "response",
    description: "User contact returned",
    why: "PingOne returns the user's contact details. The BFF uses the email (or mobilePhone) to determine maskedContact for the UI and to drive the upcoming deviceAuthentication OTP delivery.",
    response: {
      status: 200,
      body: { id: "{userId}", email: "jane.doe@example.com", mobilePhone: "+1555…" },
    },
    onError: [
      "email and mobilePhone both null — no contact to send OTP to; BFF should return 422",
    ],
  },
  {
    step: 19,
    path: "onetime",
    from: "BFF",
    to: "P1",
    label: "POST /environments/{envId}/deviceAuthentications (user token)",
    type: "request",
    description: "Initiate deviceAuth",
    why: "The BFF initiates a PingOne deviceAuthentication using the user's token. PingOne will send the OTP to the user's email or phone. The returned daId is stored in the session — it's needed for OTP verification in the next step.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications",
      headers: { Authorization: "Bearer {USER_TOKEN}", "Content-Type": "application/json" },
      body: { userId: "{userId}" },
    },
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "OTP_REQUIRED", maskedContact: "j***@example.com" },
    },
    onError: [
      "400 — user has no registered devices and no email/phone for onetime OTP",
      "User token expired — deviceAuthentication call fails with 401",
    ],
  },
  {
    step: 20,
    path: "onetime",
    from: "P1",
    to: "BFF",
    label: "{ id: daId, status: OTP_REQUIRED, maskedContact }",
    type: "response",
    description: "deviceAuth initiated",
    why: "PingOne has created the deviceAuthentication and sent the OTP. The daId is the handle the BFF will use to check the OTP. status: OTP_REQUIRED tells the BFF the OTP was dispatched and the user just needs to enter it.",
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "OTP_REQUIRED", maskedContact: "j***@example.com" },
    },
    onError: [
      "status: FAILED — PingOne couldn't deliver the OTP (invalid contact); user must update their profile",
    ],
  },
  {
    step: 21,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "ch.oneTimePath=true, ch.daId stored in session",
    type: "request",
    description: "Store daId in challenge",
    why: "The challenge record is updated with the daId and a flag marking this as a one-time-path challenge. This ties the PingOne deviceAuthentication to the specific consent challenge so the OTP verify step can look it up.",
    request: { call: "updateChallenge(challengeId, { oneTimePath: true, daId: 'da_01ABC' })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "Challenge still in session", result: "PASS", detail: "session.challenges[challengeId] exists" },
    ],
    onError: [
      "Session lost between confirm and verify — challenge can't be found; user must restart",
    ],
  },
  {
    step: 22,
    path: "onetime",
    from: "BFF",
    to: "B",
    label: "200 { otpSent: true, otpExpiresAt, maskedContact }",
    type: "response",
    description: "OTP sent (P2)",
    why: "The browser receives the masked contact so the user knows where to look for the OTP. The UI shows the OTP entry field and countdown timer.",
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z", maskedContact: "j***@example.com" },
    },
    onError: [
      "maskedContact not shown in UI — user doesn't know where to look for OTP",
    ],
  },
  {
    step: 23,
    path: "onetime",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/verify-otp { otp }",
    type: "request",
    description: "Submit OTP (P2)",
    why: "The user enters the OTP from their email/phone. The BFF will forward it to PingOne's deviceAuthentication endpoint for verification rather than checking a local hash — PingOne owns the OTP lifecycle on this path.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/verify-otp",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { otp: "123456" },
    },
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "401 — OTP wrong; PingOne returns FAILED status",
      "OTP 123123 bypasses PingOne in demo environments (bypass code hardcoded for demos)",
    ],
  },
  {
    step: 24,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "verifyMfa() — getChallengePath() = onetime",
    type: "request",
    description: "Route to onetime verify",
    why: "transactionConsentChallenge.js reads the stored path flag (oneTimePath=true) to decide which verification branch to take. This is the routing step — actual PingOne call happens next.",
    request: { call: "verifyMfa(challengeId, otp)" },
    response: { returns: "delegates to mfaService.verifyOnetime(daId, otp)" },
    rulesEvaluated: [
      { rule: "ch.oneTimePath = true", result: "PASS", detail: "routing to onetime branch" },
    ],
    onError: [
      "Path flag not set — falls through to wrong branch; verify fails",
    ],
  },
  {
    step: 25,
    path: "onetime",
    from: "BFF",
    to: "P1",
    label: "POST /deviceAuthentications/{daId} — otp.check (worker token)",
    type: "request",
    description: "Check OTP with PingOne",
    why: "The BFF submits the OTP to PingOne's deviceAuthentication check endpoint using a worker token. PingOne validates the OTP against the one it sent and returns COMPLETED or FAILED.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications/{daId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}", "Content-Type": "application/json" },
      body: { otp: { value: "123456" } },
    },
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "status: FAILED — wrong OTP; BFF returns 401 to browser",
      "status: OTP_EXPIRED — user took too long; challenge must be restarted",
    ],
  },
  {
    step: 26,
    path: "onetime",
    from: "P1",
    to: "BFF",
    label: "{ status: COMPLETED }",
    type: "response",
    description: "PingOne OTP verified",
    why: "PingOne confirms the OTP was correct. The BFF can now mark the challenge as confirmed and return the confirmExpiresAt window to the browser.",
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "COMPLETED returned but BFF doesn't update challenge status — transaction step will reject",
    ],
  },
  {
    step: 27,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "status = confirmed",
    type: "request",
    description: "Mark confirmed (P2)",
    why: "The challenge status is updated to 'confirmed' in the session. This is the gate that verifyAndConsumeChallenge checks — it won't execute the transaction unless status is confirmed.",
    request: { call: "updateChallenge(challengeId, { status: 'confirmed', confirmExpiresAt })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "PingOne status = COMPLETED", result: "PASS", detail: "verified upstream before this call" },
    ],
    onError: [
      "Session expired between PingOne verify and status update — challenge lost",
    ],
  },
  {
    step: 28,
    path: "onetime",
    from: "BFF",
    to: "B",
    label: "200 { challengeId, confirmExpiresAt }",
    type: "response",
    description: "OTP verified (P2)",
    why: "Same response shape as Path 1. Browser proceeds to submit the transaction immediately.",
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "UI delays transaction past confirmExpiresAt window",
    ],
  },
  {
    step: 29,
    path: "onetime",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions { consentChallengeId }",
    type: "request",
    description: "Execute transaction (P2)",
    why: "Same as Path 1 step 12 — the transaction is re-submitted with the challengeId. verifyAndConsumeChallenge runs the same snapshot + one-time-use checks regardless of which path was used to confirm.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500, consentChallengeId: "ch_01ABC" },
    },
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed" },
    },
    onError: [
      "409 — replay attempt",
      "422 — snapshot mismatch",
    ],
  },
  {
    step: 30,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "verifyAndConsumeChallenge() — snapshot match, one-time use",
    type: "request",
    description: "Consume challenge (P2)",
    why: "Identical invariants to Path 1: snapshot match + one-time consumption. The consume step is path-agnostic by design — any confirmed challenge, regardless of how it was confirmed, goes through the same final gate.",
    request: { call: "verifyAndConsumeChallenge(challengeId, payload)" },
    response: { returns: "{ consumed: true }" },
    rulesEvaluated: [
      { rule: "Challenge status = confirmed", result: "PASS", detail: "ch.status='confirmed'" },
      { rule: "Snapshot matches payload", result: "PASS", detail: "sha256(payload) === ch.snapshot" },
      { rule: "confirmExpiresAt not passed", result: "PASS", detail: "ch.confirmExpiresAt > now" },
      { rule: "Challenge not consumed", result: "PASS", detail: "ch.consumed = false" },
    ],
    onError: [
      "Snapshot mismatch — payload was modified after approval",
      "Already consumed — replay or double-submit",
    ],
  },
  {
    step: 31,
    path: "onetime",
    from: "BFF",
    to: "B",
    label: "200 transaction result",
    type: "response",
    description: "Transaction complete (P2)",
    why: "Transaction executed. Challenge lifecycle complete.",
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed", amount: 500, type: "transfer" },
    },
    onError: [
      "Downstream banking error — show error; do not re-challenge",
    ],
  },

  // ── Path 3: Device Picker ────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "P1"],
    path: "device",
    text: "PATH 3 — mode = device_picker, amount >= confirm_stepup_threshold_usd ($500)",
    description: "Path 3 start",
    why: "For high-value transactions (>= $500 by default), the user is required to authenticate with an enrolled device (EMAIL, SMS, FIDO2, etc.) rather than a one-time OTP. The device_picker mode adds a device selection step before the OTP is sent.",
    onError: [
      "amount below confirm_stepup_threshold_usd — device picker not triggered even in device_picker mode",
    ],
  },
  {
    step: 32,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/confirm",
    type: "request",
    description: "Confirm challenge (P3)",
    why: "Same confirm endpoint. Mode=device_picker + amount >= $500 triggers the device selection path. The BFF initiates a deviceAuthentication that returns a list of the user's enrolled devices rather than immediately sending an OTP.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/confirm",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: {},
    },
    response: {
      status: 200,
      body: { mfaRequired: true, devices: [{ id: "dev_01", type: "EMAIL", maskedContact: "j***@…" }, { id: "dev_02", type: "SMS", maskedContact: "+1***5678" }] },
    },
    onError: [
      "No enrolled devices — returns mfaRequired: true but devices: [] — UI must handle empty state",
      "amount < threshold — falls through to onetime path instead",
    ],
  },
  {
    step: 33,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "confirmChallenge() — mode=device_picker + amount >= $500",
    type: "request",
    description: "Confirm, device picker mode",
    why: "transactionConsentChallenge.js takes the device_picker branch when both mode=device_picker and amount >= confirm_stepup_threshold_usd. It initiates a deviceAuthentication that returns DEVICE_SELECTION_REQUIRED and the list of the user's registered devices.",
    request: { call: "confirmChallenge(challengeId, { mode: 'device_picker', amount: 500 })" },
    response: { returns: "{ mfaRequired: true, devices: [...] }" },
    rulesEvaluated: [
      { rule: "mode = device_picker", result: "PASS", detail: "configStore 'hitl_consent_mfa_mode' = 'device_picker'" },
      { rule: "amount >= confirm_stepup_threshold_usd", result: "PASS", detail: "amount=500 >= threshold=500" },
    ],
    onError: [
      "Threshold mis-configured — device picker triggered for small amounts; check configStore",
    ],
  },
  {
    step: 34,
    path: "device",
    from: "BFF",
    to: "P1",
    label: "POST /environments/{envId}/users/{userId}/deviceAuthentications (user token)",
    type: "request",
    description: "Initiate deviceAuth (P3)",
    why: "The BFF posts to the user-scoped deviceAuthentications endpoint. PingOne returns DEVICE_SELECTION_REQUIRED and the list of the user's enrolled devices, which the BFF passes to the browser for the user to choose from.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/users/{userId}/deviceAuthentications",
      headers: { Authorization: "Bearer {USER_TOKEN}", "Content-Type": "application/json" },
    },
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "DEVICE_SELECTION_REQUIRED", devices: [{ id: "dev_01", type: "EMAIL" }, { id: "dev_02", type: "SMS" }] },
    },
    onError: [
      "User has no enrolled devices — DEVICE_SELECTION_REQUIRED but devices: [] — UI dead end",
      "User token expired — 401; re-auth required",
    ],
  },
  {
    step: 35,
    path: "device",
    from: "P1",
    to: "BFF",
    label: "{ id: daId, status: DEVICE_SELECTION_REQUIRED, devices: [...] }",
    type: "response",
    description: "Devices returned",
    why: "PingOne returns the available devices. The BFF stores the daId in the session (needed for selectDevice and submitOtp calls) and returns the device list to the browser.",
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "DEVICE_SELECTION_REQUIRED", devices: [{ id: "dev_01", type: "EMAIL", maskedContact: "j***@…" }] },
    },
    onError: [
      "daId not stored in session — subsequent selectDevice call will fail",
    ],
  },
  {
    step: 36,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "ch.mfaPath=true, ch.daId, ch.devices stored in session",
    type: "request",
    description: "Store devices in challenge",
    why: "The challenge record is updated with the daId, the device list, and a flag marking this as an mfa-path challenge. This ties the PingOne deviceAuthentication to the challenge and makes the device list available for the select-device step.",
    request: { call: "updateChallenge(challengeId, { mfaPath: true, daId: 'da_01ABC', devices: [...] })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "Challenge still in session", result: "PASS", detail: "session.challenges[challengeId] exists" },
    ],
    onError: [
      "Session evicted between confirm and device selection — user must restart the challenge",
    ],
  },
  {
    step: 37,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 { mfaRequired: true, devices: [{ id, type, maskedContact }] }",
    type: "response",
    description: "Device list returned",
    why: "The browser receives the list of enrolled devices. The UI renders a device picker so the user can choose which enrolled device (EMAIL, SMS, FIDO2) to receive the OTP on.",
    response: {
      status: 200,
      body: { mfaRequired: true, devices: [{ id: "dev_01", type: "EMAIL", maskedContact: "j***@…" }, { id: "dev_02", type: "SMS", maskedContact: "+1***5678" }] },
    },
    onError: [
      "UI doesn't render device picker — user is stuck at the confirm button",
    ],
  },
  {
    step: 38,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/select-device { deviceId }",
    type: "request",
    description: "Select device",
    why: "The user picks a device from the picker. The BFF tells PingOne which device to send the OTP to, and PingOne transitions the deviceAuthentication from DEVICE_SELECTION_REQUIRED to OTP_REQUIRED.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/select-device",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { deviceId: "dev_01" },
    },
    response: {
      status: 200,
      body: { otpSent: true },
    },
    onError: [
      "deviceId not in the stored devices list — 400 Bad Request",
      "daId missing from session — device selection fails; challenge must be restarted",
    ],
  },
  {
    step: 39,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "selectMfaDevice() — mfaService.selectDevice(daId, deviceId)",
    type: "request",
    description: "Delegate device select",
    why: "transactionConsentChallenge.js delegates to mfaService.selectDevice(), which posts the device selection to PingOne. Once PingOne confirms OTP_REQUIRED, the BFF returns otpSent: true to the browser.",
    request: { call: "selectMfaDevice(challengeId, deviceId)" },
    response: { returns: "{ otpSent: true }" },
    rulesEvaluated: [
      { rule: "ch.mfaPath = true", result: "PASS", detail: "routing to device-picker branch" },
      { rule: "deviceId in ch.devices", result: "PASS", detail: "dev_01 found in stored device list" },
    ],
    onError: [
      "daId stale — PingOne returns 404 for the deviceAuthentication",
    ],
  },
  {
    step: 40,
    path: "device",
    from: "BFF",
    to: "P1",
    label: "POST /deviceAuthentications/{daId} — device.select (worker token)",
    type: "request",
    description: "Select device in PingOne",
    why: "The BFF posts the device selection to PingOne's deviceAuthentication endpoint. PingOne sends the OTP to the selected device and returns OTP_REQUIRED.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications/{daId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}", "Content-Type": "application/json" },
      body: { device: { id: "dev_01" } },
    },
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "OTP_REQUIRED" },
    },
    onError: [
      "DEVICE_NOT_FOUND — device was de-registered between list and select",
    ],
  },
  {
    step: 41,
    path: "device",
    from: "P1",
    to: "BFF",
    label: "{ status: OTP_REQUIRED | ASSERTION_REQUIRED }",
    type: "response",
    description: "OTP dispatched",
    why: "PingOne confirms the OTP was sent (or ASSERTION_REQUIRED for FIDO2 devices). The BFF returns otpSent: true to the browser. For FIDO2 the UI would need to trigger the authenticator — not covered in this demo flow.",
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "OTP_REQUIRED" },
    },
    onError: [
      "ASSERTION_REQUIRED — FIDO2 device selected; UI needs WebAuthn flow (out of scope for this demo)",
    ],
  },
  {
    step: 42,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 { otpSent: true }",
    type: "response",
    description: "OTP sent (P3)",
    why: "The browser now shows the OTP entry field. The user enters the code from their chosen device.",
    response: {
      status: 200,
      body: { otpSent: true },
    },
    onError: [
      "UI doesn't show OTP input — must check otpSent: true",
    ],
  },
  {
    step: 43,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/verify-otp { deviceId, otp }",
    type: "request",
    description: "Submit OTP (P3)",
    why: "The user submits the OTP from their selected device. deviceId is included so the BFF can route to the correct mfaService.submitOtp call.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/verify-otp",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { deviceId: "dev_01", otp: "123456" },
    },
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "401 — wrong OTP",
      "410 — OTP expired",
    ],
  },
  {
    step: 44,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "verifyMfa() — getChallengePath() = mfa",
    type: "request",
    description: "Route to mfa verify",
    why: "transactionConsentChallenge.js reads the mfaPath flag (true) and routes to mfaService.submitOtp. Same routing pattern as Path 2 but the mfa branch.",
    request: { call: "verifyMfa(challengeId, otp, deviceId)" },
    response: { returns: "delegates to mfaService.submitOtp(daId, deviceId, otp)" },
    rulesEvaluated: [
      { rule: "ch.mfaPath = true", result: "PASS", detail: "routing to mfa branch" },
    ],
    onError: [
      "mfaPath flag not set — falls to wrong branch",
    ],
  },
  {
    step: 45,
    path: "device",
    from: "BFF",
    to: "P1",
    label: "mfaService.submitOtp(daId, deviceId, otp) — worker token",
    type: "request",
    description: "Submit OTP to PingOne (P3)",
    why: "The BFF submits the OTP to PingOne via the worker token. PingOne validates it against the code it sent to the selected device.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications/{daId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}", "Content-Type": "application/json" },
      body: { otp: { value: "123456" }, device: { id: "dev_01" } },
    },
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "status: FAILED — wrong OTP; BFF returns 401",
    ],
  },
  {
    step: 46,
    path: "device",
    from: "P1",
    to: "BFF",
    label: "{ status: COMPLETED }",
    type: "response",
    description: "PingOne OTP verified (P3)",
    why: "PingOne confirms the OTP. BFF proceeds to mark the challenge confirmed.",
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "COMPLETED returned but status not persisted — transaction gate will reject",
    ],
  },
  {
    step: 47,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "status = confirmed",
    type: "request",
    description: "Mark confirmed (P3)",
    why: "Challenge status set to 'confirmed'. Same pattern as Path 2 step 27.",
    request: { call: "updateChallenge(challengeId, { status: 'confirmed', confirmExpiresAt })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "PingOne status = COMPLETED", result: "PASS", detail: "verified upstream" },
    ],
    onError: [
      "Session expired between PingOne verify and status update",
    ],
  },
  {
    step: 48,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 { challengeId, confirmExpiresAt }",
    type: "response",
    description: "OTP verified (P3)",
    why: "Browser proceeds to submit the transaction. Same window as Paths 1 and 2.",
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "UI delays transaction past window",
    ],
  },
  {
    step: 49,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions { consentChallengeId }",
    type: "request",
    description: "Execute transaction (P3)",
    why: "Transaction re-submitted with challengeId. verifyAndConsumeChallenge runs identical snapshot + one-time-use checks.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500, consentChallengeId: "ch_01ABC" },
    },
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed" },
    },
    onError: ["409 — replay", "422 — snapshot mismatch"],
  },
  {
    step: 50,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "verifyAndConsumeChallenge() — snapshot match, one-time use",
    type: "request",
    description: "Consume challenge (P3)",
    why: "Identical to Path 1 step 13 and Path 2 step 30. The consume gate is path-agnostic.",
    request: { call: "verifyAndConsumeChallenge(challengeId, payload)" },
    response: { returns: "{ consumed: true }" },
    rulesEvaluated: [
      { rule: "Challenge status = confirmed", result: "PASS", detail: "ch.status='confirmed'" },
      { rule: "Snapshot matches payload", result: "PASS", detail: "sha256(payload) === ch.snapshot" },
      { rule: "confirmExpiresAt not passed", result: "PASS", detail: "ch.confirmExpiresAt > now" },
      { rule: "Challenge not consumed", result: "PASS", detail: "ch.consumed = false" },
    ],
    onError: [
      "Snapshot mismatch — payload modified after approval",
      "Already consumed — replay",
    ],
  },
  {
    step: 51,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 transaction result",
    type: "response",
    description: "Transaction complete (P3)",
    why: "Transaction executed. Full HITL device-picker consent lifecycle complete.",
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed", amount: 500, type: "transfer" },
    },
    onError: [
      "Downstream error — show error; do not re-challenge",
    ],
  },

  // ── Closing note ─────────────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "TC"],
    path: "shared",
    text: "OTP 123123 bypasses PingOne in paths 2 and 3 for demo environments",
    description: "Demo bypass note",
    why: "The magic OTP '123123' short-circuits PingOne MFA verification in demo environments so engineers can test the HITL flow without a real PingOne tenant or enrolled devices. It must never be enabled in production — the bypass is guarded by an environment check.",
    onError: [
      "Bypass active in production — critical security vulnerability; check NODE_ENV and bypass guard",
    ],
  },
];
```

- [ ] **Step 2: Fix HITL_SCENARIOS to reference HITL_STEPS after it is fully populated**

Because `HITL_SCENARIOS` is defined with inline `.filter()` calls at module load time, it must be defined *after* `HITL_STEPS` is fully populated. Move `HITL_SCENARIOS` to immediately after the `HITL_STEPS` closing `];` :

```js
const HITL_SCENARIOS = {
  all:       HITL_STEPS,
  homegrown: HITL_STEPS.filter((s) => s.path === "shared" || s.path === "homegrown"),
  onetime:   HITL_STEPS.filter((s) => s.path === "shared" || s.path === "onetime"),
  device:    HITL_STEPS.filter((s) => s.path === "shared" || s.path === "device"),
};
```

- [ ] **Step 3: Build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/HitlSequenceDiagram.js
git commit -m "feat(hitl): add HITL_STEPS Path 2 (PingOne One-Time) + Path 3 (Device Picker)"
```

---

## Task 4: Copy StepInfoPanel and helpers from SequenceDiagramPage.js

**Files:**
- Modify: `demo_api_ui/src/components/HitlSequenceDiagram.js`

The following functions are copied verbatim from `SequenceDiagramPage.js`. They use only React hooks and inline styles — no external dependencies.

- [ ] **Step 1: Add FlowClaimRow, OneFlowCard, StepDetailSection, HttpDetailGrid, and StepInfoPanel to HitlSequenceDiagram.js**

Insert after the imports and before `HITL_PARTICIPANTS`. Copy these functions exactly from `SequenceDiagramPage.js` lines 24–695:

- `FlowClaimRow` (lines 24–72)
- `OneFlowCard` (lines 74–157)  
- `StepDetailSection` (lines 174–228)
- `HttpDetailGrid` (lines 233–265)
- `StepInfoPanel` (lines 267–696) — **one change required**: replace the reference to `PARTICIPANTS` on line 330 with `HITL_PARTICIPANTS`:

```js
// In StepInfoPanel, change:
const fromParticipant = PARTICIPANTS.find((p) => p.id === activeStep.from);
const toParticipant = PARTICIPANTS.find((p) => p.id === activeStep.to);
// To:
const fromParticipant = HITL_PARTICIPANTS.find((p) => p.id === activeStep.from);
const toParticipant = HITL_PARTICIPANTS.find((p) => p.id === activeStep.to);
```

- [ ] **Step 2: Build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/HitlSequenceDiagram.js
git commit -m "feat(hitl): copy StepInfoPanel and helpers into HitlSequenceDiagram"
```

---

## Task 5: Add simulation state and controls

**Files:**
- Modify: `demo_api_ui/src/components/HitlSequenceDiagram.js`

- [ ] **Step 1: Replace the stub default export with the full component shell — state, handlers, and controls bar**

```js
export default function HitlSequenceDiagram() {
  const [selectedScenario, setSelectedScenario] = useState("all");
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);
  const [zoomLevel, setZoomLevel] = useState(100);
  const simTimeouts = useRef([]);
  const pausedStepIdx = useRef(-1);

  const steps = HITL_SCENARIOS[selectedScenario] || HITL_STEPS;
  const activeStep = currentStepIdx >= 0 ? steps[currentStepIdx] : null;

  const participantIndex = (id) => HITL_PARTICIPANTS.findIndex((p) => p.id === id);

  const applyStep = useCallback((idx) => { setCurrentStepIdx(idx); }, []);

  const resetDiagram = useCallback(() => {
    setCurrentStepIdx(-1);
    setIsPaused(false);
    pausedStepIdx.current = -1;
  }, []);

  const scheduleSteps = useCallback((startIdx) => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    steps.slice(startIdx).forEach((_, offset) => {
      const i = startIdx + offset;
      const t = setTimeout(() => {
        applyStep(i);
        if (i === steps.length - 1) {
          const done = setTimeout(() => { resetDiagram(); setIsSimulating(false); }, 4000);
          simTimeouts.current.push(done);
        }
      }, (offset + (startIdx === 0 ? 0 : 1)) * 2500);
      simTimeouts.current.push(t);
    });
  }, [steps, applyStep, resetDiagram]);

  const runSimulation = useCallback(() => {
    if (isSimulating) return;
    setCurrentStepIdx(-1);
    setIsSimulating(true);
    setIsPaused(false);
    scheduleSteps(0);
  }, [isSimulating, scheduleSteps]);

  const pause = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    pausedStepIdx.current = currentStepIdx;
    setIsPaused(true);
  }, [currentStepIdx]);

  const resume = useCallback(() => {
    if (!isPaused) return;
    setIsPaused(false);
    scheduleSteps(pausedStepIdx.current + 1);
  }, [isPaused, scheduleSteps]);

  const prevStep = useCallback(() => {
    if (!isPaused) return;
    const prev = pausedStepIdx.current - 1;
    if (prev < 0) return;
    applyStep(prev);
    pausedStepIdx.current = prev;
  }, [isPaused, applyStep]);

  const nextStep = useCallback(() => {
    if (!isPaused) return;
    const next = pausedStepIdx.current + 1;
    if (next >= steps.length) { resetDiagram(); setIsSimulating(false); return; }
    applyStep(next);
    pausedStepIdx.current = next;
  }, [isPaused, steps.length, applyStep, resetDiagram]);

  const stopSim = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    resetDiagram();
    setIsSimulating(false);
  }, [resetDiagram]);

  const handleStepClick = useCallback((idx) => {
    if (!isPaused) return;
    applyStep(idx);
    pausedStepIdx.current = idx;
  }, [isPaused, applyStep]);

  const handleMouseDownResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMove = (ev) => {
      const newWidth = Math.max(240, Math.min(500, startWidth + ev.clientX - startX));
      setLeftPanelWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const scenarioLabel = {
    all: "All Paths",
    homegrown: "Path 1 — Homegrown OTP",
    onetime: "Path 2 — PingOne One-Time",
    device: "Path 3 — Device Picker",
  }[selectedScenario] || "All Paths";

  const arrowSteps = steps.filter((s) => s.step);
  const stepCounter = activeStep?.step
    ? `Step ${activeStep.step} of ${arrowSteps.length} · ${scenarioLabel}`
    : `${arrowSteps.length} steps · ${scenarioLabel}`;

  return (
    <div style={{ background: "#fff" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 1rem", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#475569" }}>Scenario:</label>
        <select
          value={selectedScenario}
          onChange={(e) => { stopSim(); setSelectedScenario(e.target.value); }}
          style={{ fontSize: "0.8rem", border: "1px solid #cbd5e1", borderRadius: 4, padding: "0.25rem 0.4rem" }}
        >
          <option value="all">All Paths</option>
          <option value="homegrown">Path 1 — Homegrown OTP</option>
          <option value="onetime">Path 2 — PingOne One-Time</option>
          <option value="device">Path 3 — Device Picker</option>
        </select>
        {!isSimulating && (
          <button type="button" onClick={runSimulation} style={ctrlBtn(false)}>Simulate</button>
        )}
        {isSimulating && !isPaused && (
          <button type="button" onClick={pause} style={ctrlBtn(false)}>Pause</button>
        )}
        {isSimulating && isPaused && (
          <button type="button" onClick={resume} style={ctrlBtn(false)}>Resume</button>
        )}
        {isSimulating && (
          <button type="button" onClick={stopSim} style={ctrlBtn(false)}>Stop</button>
        )}
        <button type="button" onClick={prevStep} disabled={!isPaused} style={ctrlBtn(!isPaused)}>← Prev</button>
        <button type="button" onClick={nextStep} disabled={!isPaused} style={ctrlBtn(!isPaused)}>Next →</button>
        <button type="button" onClick={() => setZoomLevel((z) => Math.max(50, z - 25))} style={ctrlBtn(false)}>− Zoom</button>
        <button type="button" onClick={() => setZoomLevel((z) => Math.min(200, z + 25))} style={ctrlBtn(false)}>+ Zoom</button>
        <span style={{ fontSize: "0.8rem", color: "#475569", fontWeight: 600 }}>{zoomLevel}%</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{stepCounter}</span>
      </div>

      {/* Split layout */}
      <div style={{ display: "flex" }}>
        <StepInfoPanel
          activeStep={activeStep}
          currentStepIdx={currentStepIdx}
          steps={steps}
          isPaused={isPaused}
          onStepClick={handleStepClick}
          panelWidth={leftPanelWidth}
        />
        {/* Drag handle */}
        <div
          onMouseDown={handleMouseDownResize}
          style={{ width: 4, cursor: "col-resize", background: "#e2e8f0", flexShrink: 0 }}
        />
        {/* SVG area — rendered in Task 6 */}
        <div style={{ flex: 1, overflow: "auto", background: "#f8fafc", padding: "1.5rem" }}>
          <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left", transition: "transform 0.15s" }}>
            <p style={{ color: "#94a3b8", fontSize: "0.8rem" }}>SVG diagram — Task 6</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ctrlBtn(disabled) {
  return {
    fontSize: "0.8rem", fontWeight: 600,
    border: "1px solid #cbd5e1", borderRadius: 4,
    padding: "0.3rem 0.6rem",
    background: disabled ? "#f1f5f9" : "#fff",
    color: disabled ? "#94a3b8" : "#0f172a",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
```

- [ ] **Step 2: Build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors.

- [ ] **Step 3: Smoke test in browser**

Navigate to `https://api.ping.demo:4000/architecture/hitl` (server must be running via `./run.sh`). Confirm:
- Controls bar renders (Scenario dropdown, Simulate button, zoom buttons)
- Scenario dropdown lists all 4 options
- StepInfoPanel shows "Press Simulate to begin" placeholder
- No console errors

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/HitlSequenceDiagram.js
git commit -m "feat(hitl): add simulation state, controls bar, and resizable panel"
```

---

## Task 6: Add custom SVG renderer

**Files:**
- Modify: `demo_api_ui/src/components/HitlSequenceDiagram.js`

- [ ] **Step 1: Replace the "SVG diagram — Task 6" placeholder div with the SVG renderer**

Replace:
```js
<p style={{ color: "#94a3b8", fontSize: "0.8rem" }}>SVG diagram — Task 6</p>
```

With:

```js
<svg
  width={100 + HITL_PARTICIPANTS.length * 160}
  style={{ display: "block", minHeight: `${140 + steps.length * 22 + 60}px` }}
  aria-label="HITL consent sequence diagram"
  role="img"
>
  <title>HITL consent flow sequence diagram</title>
  <defs>
    <marker id="hitl-solid" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
    </marker>
    <marker id="hitl-solid-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#004687" />
    </marker>
    <marker id="hitl-dashed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
    </marker>
    <marker id="hitl-dashed-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L8,3 z" fill="#004687" />
    </marker>
  </defs>

  {/* Path background rects — drawn before lifelines so arrows appear on top */}
  {["homegrown", "onetime", "device"].map((pathKey) => {
    const pathColor = { homegrown: "#e8f5e9", onetime: "#e8f0ff", device: "#fff3e0" }[pathKey];
    const pathStroke = { homegrown: "#a5d6a7", onetime: "#9fa8da", device: "#ffe082" }[pathKey];
    const pathSteps = steps.filter((s) => s.path === pathKey);
    if (pathSteps.length === 0) return null;
    const firstIdx = steps.indexOf(pathSteps[0]);
    const lastIdx = steps.indexOf(pathSteps[pathSteps.length - 1]);
    const y1 = 140 + firstIdx * 22 - 14;
    const y2 = 140 + lastIdx * 22 + 14;
    return (
      <rect
        key={pathKey}
        x={60}
        y={y1}
        width={100 + (HITL_PARTICIPANTS.length - 1) * 160 - 20}
        height={y2 - y1}
        rx={4}
        fill={pathColor}
        stroke={pathStroke}
        strokeWidth={1}
        opacity={0.5}
      />
    );
  })}

  {/* Participant boxes and lifelines */}
  {HITL_PARTICIPANTS.map((p, i) => {
    const x = 100 + i * 160;
    const words = p.label.split(" ");
    const lines = [];
    let cur = "";
    words.forEach((w) => {
      if ((cur + w).length > 14) { if (cur) lines.push(cur.trim()); cur = w; }
      else { cur += (cur ? " " : "") + w; }
    });
    if (cur) lines.push(cur.trim());
    return (
      <g key={p.id}>
        <rect x={x - 60} y={20} width={120} height={20 + lines.length * 16} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={1} rx={4} />
        {lines.map((line, li) => (
          <text key={li} x={x} y={40 + li * 16} textAnchor="middle" fontSize={11} fontWeight="600" fill="#0f172a">{line}</text>
        ))}
        <line x1={x} y1={20 + lines.length * 16 + 10} x2={x} y2={140 + steps.length * 22 + 40} stroke="#cbd5e1" strokeDasharray="4" strokeWidth={1} />
      </g>
    );
  })}

  {/* Steps */}
  {steps.map((step, idx) => {
    const isActive = idx === currentStepIdx;
    const isPast = idx < currentStepIdx;
    const y = 140 + idx * 22;
    const opacity = isPast ? 0.35 : 1;

    if (step.type === "note") {
      const partIdxs = step.participants.map(participantIndex).filter((i) => i >= 0);
      if (partIdxs.length === 0) return null;
      const minX = 100 + Math.min(...partIdxs) * 160 - 50;
      const maxX = 100 + Math.max(...partIdxs) * 160 + 50;
      return (
        <g key={`note-${idx}`} opacity={opacity}>
          <rect x={minX} y={y - 13} width={maxX - minX} height={26} rx={5}
            fill={isActive ? "#fef08a" : "#fef9c3"} stroke="#d97706" strokeWidth={isActive ? 2 : 1} />
          <text x={(minX + maxX) / 2} y={y + 4} textAnchor="middle" fontSize={10} fill="#451a03" fontWeight="600">
            {step.text.length > 70 ? step.text.slice(0, 68) + "…" : step.text}
          </text>
        </g>
      );
    }

    const fromX = 100 + participantIndex(step.from) * 160;
    const toX = 100 + participantIndex(step.to) * 160;
    const midX = (Math.min(fromX, toX) + Math.max(fromX, toX)) / 2;
    const isDashed = step.type === "response";
    const arrowColor = isActive ? "#004687" : "#475569";
    const markerId = isActive
      ? (isDashed ? "hitl-dashed-active" : "hitl-solid-active")
      : (isDashed ? "hitl-dashed" : "hitl-solid");

    return (
      <g key={`step-${step.step}-${idx}`} opacity={opacity}>
        <line
          x1={fromX} y1={y} x2={toX} y2={y}
          stroke={isActive ? "#004687" : "#cbd5e1"}
          strokeWidth={isActive ? 3 : 1.5}
          strokeDasharray={isDashed ? "6 3" : undefined}
          markerEnd={`url(#${markerId})`}
        />
        <text x={midX} y={y - 4} textAnchor="middle" fontSize={9.5}
          fill={isActive ? "#004687" : "#475569"} fontWeight={isActive ? 700 : 400}>
          {step.step ? `${step.step}. ` : ""}{step.label.length > 55 ? step.label.slice(0, 53) + "…" : step.label}
        </text>
        {isActive && (
          <g>
            <circle cx={fromX} cy={y} r={9} fill="#1d4ed8" />
            <text x={fromX} y={y + 4} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="700">{step.step}</text>
          </g>
        )}
      </g>
    );
  })}
</svg>
```

- [ ] **Step 2: Build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors.

- [ ] **Step 3: Smoke test — SVG renders**

Navigate to `https://api.ping.demo:4000/architecture/hitl`. Confirm:
- 4 participant boxes render at top
- Lifelines extend downward
- All path background rects visible (green / blue / orange bands)
- Hit Simulate — arrows animate one by one, active arrow highlighted blue
- Pause — step panel shows `why`, request/response, rules, onError for current step
- Prev/Next navigate steps; step counter updates
- Scenario dropdown "Path 1 — Homegrown OTP" shows only shared + homegrown steps
- No console errors

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/HitlSequenceDiagram.js
git commit -m "feat(hitl): add custom SVG renderer with participant lifelines and path rects"
```

---

## Task 7: Update HitlSequencePage.jsx — strip Mermaid, render HitlSequenceDiagram

**Files:**
- Modify: `demo_api_ui/src/components/HitlSequencePage.jsx`

- [ ] **Step 1: Replace the entire content of HitlSequencePage.jsx**

```js
/**
 * HitlSequencePage.jsx — /architecture/hitl
 *
 * Interactive sequence diagram for the HITL consent challenge flow.
 * Diagram and step-by-step panel are provided by HitlSequenceDiagram.js.
 * Source reference: hitl-sequence.mmd at the repo root.
 */
import HitlSequenceDiagram from "./HitlSequenceDiagram";

const PATHS = [
  { key: "homegrown", label: "Path 1 — Homegrown OTP",           color: "rgb(232,245,233)", desc: "BFF-generated HMAC OTP emailed directly. Feature flag: mode=homegrown." },
  { key: "onetime",   label: "Path 2 — PingOne One-Time (default)", color: "rgb(232,240,255)", desc: "PingOne sends OTP to user's email/phone on file. No enrolled device required. Feature flag: mode=onetime." },
  { key: "device",    label: "Path 3 — PingOne Device Picker",    color: "rgb(255,243,224)", desc: "User picks from enrolled devices (EMAIL, SMS, FIDO2). Requires amount >= $500. Feature flag: mode=device_picker." },
];

export default function HitlSequencePage() {
  return (
    <div style={{ padding: "2rem", maxWidth: "100%", overflowX: "auto" }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <p style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280", marginBottom: "0.25rem" }}>
          HITL Consent Challenge
        </p>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#111827", margin: 0 }}>
          Sequence Diagram — All Paths
        </h1>
        <p style={{ color: "#6b7280", marginTop: "0.5rem", fontSize: "0.9rem" }}>
          Full request/response flow for the three HITL consent modes. Controlled by{" "}
          <code style={{ background: "#f3f4f6", padding: "0.1em 0.3em", borderRadius: 4 }}>hitl_consent_mfa_mode</code>{" "}
          config flag.
        </p>
      </header>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {PATHS.map((p) => (
          <div key={p.key} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.6rem 0.9rem", maxWidth: 280 }}>
            <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 3, background: p.color, flexShrink: 0, marginTop: 3 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#111827" }}>{p.label}</div>
              <div style={{ fontSize: "0.78rem", color: "#6b7280", marginTop: 2 }}>{p.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <HitlSequenceDiagram />
    </div>
  );
}
```

- [ ] **Step 2: Build passes — mermaid is no longer imported**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|error TS|Failed" | head -10
```
Expected: no errors. Confirm `mermaid` is gone from this file:
```bash
grep "mermaid" demo_api_ui/src/components/HitlSequencePage.jsx
```
Expected: no output.

- [ ] **Step 3: Full smoke test**

Navigate to `https://api.ping.demo:4000/architecture/hitl`. Verify all spec acceptance criteria:
- Page loads, no console errors
- Path legend chips (green/blue/orange) render above the diagram
- Scenario dropdown: All Paths / Path 1 / Path 2 / Path 3 — switching filters correctly
- Simulate auto-walks all steps, step counter updates, resets after last step
- Pause → Prev/Next navigate; step panel shows description, why, request, response, rules, onError
- Active arrow highlighted blue, others dimmed
- All 4 panel sections have data on at least one step per path
- Zoom in/out scales the SVG

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/HitlSequencePage.jsx
git commit -m "feat(hitl): replace Mermaid render with HitlSequenceDiagram interactive step panel"
```

---

## Task 8: Final build verification

**Files:** None changed — verification only.

- [ ] **Step 1: Full production build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```
Expected: "The build folder is ready to be deployed."

- [ ] **Step 2: No regression on /sequence-diagram**

Navigate to `https://api.ping.demo:4000/sequence-diagram`. Confirm it still loads and simulates correctly. No changes were made to `SequenceDiagramPage.js`.

- [ ] **Step 3: Commit (if any stray changes)**

```bash
git status
# If clean, no commit needed
```

---

## Task 9: Cross-diagram color + responsive layout consistency

**Goal:** All custom SVG diagrams use the same color palette and fill available viewport height on large monitors.

**Files:**
- Modify: `demo_api_ui/src/components/SequenceDiagramPage.js`
- Modify: `demo_api_ui/src/components/HitlSequenceDiagram.js` (colors already done in Tasks 6–8; responsive layout)
- Modify: `demo_api_ui/src/components/HitlSequencePage.jsx` (full-height wrapper)
- Modify: `demo_api_ui/src/App.css` (`main-content` flex chain)

### Color token reference (canonical — all diagrams must use these)

| Token | Value | Usage |
|---|---|---|
| Participant box fill | `#f1f5f9` | All participant header rects |
| Participant box stroke | `#cbd5e1` | All participant header rect borders |
| Lifeline stroke | `#cbd5e1` dashed | All vertical lifelines |
| Arrow idle | `#cbd5e1` | Non-active, non-past arrows |
| Arrow active | `#004687` | Currently highlighted arrow + label |
| Arrow past | `#cbd5e1` at 0.35 opacity | Already-passed steps |
| Arrow marker idle fill | `#475569` | Arrowhead fill when idle |
| Arrow marker active fill | `#004687` | Arrowhead fill when active |
| Step label idle | `#475569` | Non-active step text |
| Step label active | `#004687` bold | Active step text |
| Step label past | `#94a3b8` | Past step text |
| Active step badge | `#1d4ed8` fill, `#fff` text | Step number badge on active source node |
| Note fill | `#fef9c3` | Note/annotation background |
| Note fill active | `#fef08a` | Note background when active |
| Note stroke | `#d97706` | Note border |
| Note text | `#451a03` | Note label |
| Path band — homegrown/green | `#bbf7d0` fill / `#4ade80` stroke | HITL Path 1 section band |
| Path band — onetime/blue | `#bfdbfe` fill / `#60a5fa` stroke | HITL Path 2 section band |
| Path band — device/orange | `#fed7aa` fill / `#fb923c` stroke | HITL Path 3 section band |
| SVG background | `#f8fafc` | Scroll area behind diagram |

### Responsive layout pattern (all diagram pages)

All diagram pages must fill the available viewport height rather than being content-tall:

```
App (flex column, min-height: 100vh)
  └── main-content (flex: 1, display: flex, flex-direction: column)
        └── DiagramPage (display: flex, flex-direction: column, height: 100%)
              ├── page header (flex-shrink: 0)
              └── DiagramComponent (flex: 1, min-height: 0)
                    ├── controls bar (flex-shrink: 0)
                    └── split pane (flex: 1, min-height: 0)
                          ├── StepInfoPanel (overflow-y: auto)
                          └── SVG area (flex: 1, overflow: auto)
                                └── svg[viewBox, width="100%"]
```

**Key rules:**
- SVG must use `viewBox` + `width="100%"` — not a fixed pixel width — so it scales to the container
- `flex: 1; min-height: 0` on every flex child that should grow to fill (without `min-height: 0`, flex overflow is clipped rather than scrolled)
- Page header uses `flex-shrink: 0` so it never gets squeezed

### Changes needed in SequenceDiagramPage.js

- [ ] **Step 1: Fix arrow past color** — change `isPast ? "#dbeafe"` to `isPast ? "#cbd5e1"` (line ~4132). `#dbeafe` is a blue tint; HITL uses neutral `#cbd5e1` at 0.35 opacity for past arrows.

- [ ] **Step 2: Fix arrow marker fill** — markers `#markerSolid` and `#markerDashed` use static `fill="#cbd5e1"`. Add active variants (`#markerSolidActive`, `#markerDashedActive`) with `fill="#004687"` and switch `markerEnd` based on `isActive`.

- [ ] **Step 3: Fix outer wrapper** — change `return (<div style={{ padding: "1rem", background: "#fff" }}>` to `display: flex; flex-direction: column; height: 100%`.

- [ ] **Step 4: Fix diagram+panel container** — change `minHeight: "800px"` and `maxHeight: "90vh"` to `flex: 1; min-height: 0` so the pane grows to fill the viewport on large screens without being capped.

- [ ] **Step 5: Add `display: flex; flex-direction: column` to `.main-content` in `App.css`** so `height: 100%` in child pages resolves through the flex chain.

- [ ] **Step 6: Build passes**

```bash
cd demo_api_ui && npm run build 2>&1 | grep -E "ERROR|Failed" | head -5
```

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/SequenceDiagramPage.js demo_api_ui/src/App.css
git commit -m "feat(diagrams): cross-diagram color consistency + full-height responsive layout"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Every arrow = one step (~48 total) | Task 2 + 3 (51 steps: 5 shared + 9 P1 + 17 P2 + 17 P3 + 3 notes + closing note) |
| Scenario dropdown: All / P1 / P2 / P3 | Task 5 |
| Custom React SVG renderer | Task 6 |
| `why`, `request/response`, `rulesEvaluated`, `onError` per step | Task 2 + 3 (all steps have all four) |
| `StepInfoPanel` copied from SequenceDiagramPage.js | Task 4 |
| `HITL_PARTICIPANTS` 4 entries | Task 1 |
| Resizable panel, drag divider | Task 5 |
| Active arrow highlighted, others dimmed | Task 6 |
| Path background rects green/blue/orange | Task 6 |
| Remove mermaid import from HitlSequencePage.jsx | Task 7 |
| Keep page header + legend chips | Task 7 |
| `cd demo_api_ui && npm run build` exits 0 | Tasks 1–8 (every task) |

**Placeholder scan:** No TBDs or TODOs. All code blocks are complete. All step data has `why` and `onError`. All arrow steps have `request`/`response`.

**Type consistency:** `HITL_PARTICIPANTS`, `HITL_STEPS`, `HITL_SCENARIOS` defined in Task 1; extended in Tasks 2–3; consumed in Tasks 4–6. `participantIndex` defined in Task 5 and used in Task 6. `StepInfoPanel` props (`activeStep`, `currentStepIdx`, `steps`, `isPaused`, `onStepClick`, `panelWidth`) match what's passed in Task 5. `ctrlBtn` helper defined and used in Task 5.
