# PingOne Admin Agent — Message Routing Fix

## Problem

The PingOne Admin AI Agent (`vertical === 'pingone-admin'`) has a real, dedicated
backend — `demo_api_server/services/adminAgentService.js`, reachable at
`POST /api/admin-agent/message`. It's fully LLM-driven against a dynamically
discovered live PingOne Management API tool set (`config/admin/tools.js` →
`buildAdminToolSchemas`/`executeAdminTool`) and has its own system prompt
(`buildAdminSystemPrompt`).

Discovered live (2026-07-19, during verification of PR #647's admin Demo Steps
fix): clicking any of the 4 admin demo steps — or typing free text directly
into the admin agent's chat box — never reaches that backend. Instead it hits
the customer/banking agent's `processAgentMessage`
(`demo_api_server/services/demoAgentLangGraphService.js`) via
`POST /api/agent/invoke`, which has its own admin-token guard
(`customerTokenGuard.js`'s `isVerticalExemptFromAdminTokenGuard`, currently
exempting only `{admin, oauth-teaching}` — not `pingone-admin`). The guard
correctly refuses ("This action needs a customer sign-in...") because an admin
token genuinely can't read customer banking data — but the whole call was
going to the wrong backend to begin with.

There IS a correct, working path already: `demo_api_ui/src/components/AIAgent.js`
line ~8043 has `if (PINGONE_ADMIN_CHIP_IDS.has(chipId)) { fetch('/api/admin-agent/message', ...) }`
— but it only fires for a handful of pre-wired chip buttons. Demo-step clicks
(`nlResumeAfterAuth` effect, ~line 6593) and free-typed chat (multiple call
sites inside the ~2500-line `handleNaturalLanguageInner`, e.g. ~5839, ~7210)
never carry a `chipId` and never reach it, so they always fall through to the
generic `sendAgentMessage()` → `/api/agent/invoke` → banking agent path.

## Why not patch each call site (Approach A, rejected)

At least 3 separate `sendAgentMessage` call sites in `AIAgent.js` (plus the
`nlResumeAfterAuth` effect) are reachable for a `pingone-admin`-vertical
message before the existing chip-id gate. This exact file/area
(`AIAgent.js` chat send/routing) has broken 3+ times before per
`REGRESSION_PLAN.md` §4 — patching N scattered call sites individually risks
missing one, now or when a new send path is added later.

## Why not a server-side branch in `agentInvokeRoute.js` (Approach B, rejected)

Single choke point, but that route is entangled with banking-specific intent
extraction, risk scoring, and HITL authorization
(`evaluateIntentAuthorization`, `intentRiskScorer`) that don't apply to admin
actions and would need careful, risky bypass logic inside an already complex,
protected route.

## Design (Approach C)

Single change, one file: `demo_api_ui/src/services/demoAgentService.js`.

Every existing call site — chip clicks (outside the `PINGONE_ADMIN_CHIP_IDS`
fast path), demo steps, free-typed chat, heuristic-resolved vertical
re-dispatch — already funnels through `sendAgentMessage()` before it ever
calls `/api/agent/invoke`. Add a branch at the very top:

```js
export async function sendAgentMessage(message, consentId = null, opts = {}) {
  if (opts.vertical === 'pingone-admin') {
    return sendToAdminAgent(message, opts);
  }
  // ...existing banking-path body/SSE/fetch logic, unchanged
}
```

New sibling function `sendToAdminAgent(message, { signal, onTokenEvent } = {})`:

- `POST /api/admin-agent/message` with `{ message, customer: adminCustomerContext.get() }`,
  `credentials: 'include'`, a 30s timeout (`signal` if the caller passed one,
  else `AbortSignal.timeout(30000)`) — mirrors the existing working inline
  fetch at `AIAgent.js:8047`.
- Parse the JSON response; on parse failure fall back to
  `{ reply: 'Admin agent request failed.', success: false }` (same fallback
  the existing inline block uses).
- If `data.tokenEvents` is an array, call `onTokenEvent?.(ev)` once per item.
  The banking path streams token events live via SSE mid-call; the admin
  agent endpoint returns them all at once on response — this fires the same
  callback, just batched instead of streamed. Same visual result downstream.
- Return `{ reply, success, requiresConsent: false, agentConfigured, inputTokens, outputTokens, tokenEvents: tokenEvents || [], _status: res.status }`
  — matches `sendAgentMessage`'s existing return contract
  (`{ ...data, _status: res.status }`), only the fields callers actually
  read. Fields the admin agent has no concept of (`step_up_required`,
  `needsParams`, `requiresCustomerLogin`) are simply absent, which every
  existing caller already treats as falsy/optional.
- Let fetch/timeout errors propagate (throw) — identical to the banking
  path; every caller already wraps `sendAgentMessage` in try/catch +
  `reportNlFailure`.

## Non-goals

- `AIAgent.js:8043`'s `PINGONE_ADMIN_CHIP_IDS` chip-gated block is untouched.
  It still early-returns before ever calling `sendAgentMessage`, so it keeps
  working exactly as today. Minor logic duplication with the new
  `sendToAdminAgent` is accepted — not worth the risk of refactoring proven,
  tested code to chase DRY.
- `agentInvokeRoute.js`, `processAgentMessage`, `customerTokenGuard.js`'s
  exempt list — untouched. Banking/healthcare/retail/etc. never pass
  `vertical: 'pingone-admin'`, so they never hit the new branch. Zero risk to
  them.
- SSE/flow-trace wiring (`openMcpFlowSse`, `setCurrentTurn`/`clearCurrentTurn`)
  for the banking path — untouched. The new admin branch returns before that
  setup runs at all (the admin agent doesn't publish to that SSE hub).

## Testing

- Live re-verification (browser, real PingOne admin login): each of the 4
  admin demo steps gets a real tool-backed reply, not the "log in as a
  customer" card. Free-typed text into the admin agent chat box also works.
- Banking vertical regression check: chat + chips still work unchanged.
- `cd demo_api_ui && npm run build` exits 0 (regression-guard requirement for
  any `demo_api_ui` change).
- `REGRESSION_PLAN.md` §4 gets a new reverse-chron entry (files changed / what
  was broken / what was fixed / do not break / verify) — this is a real bug
  fix, not a trivial edit.
