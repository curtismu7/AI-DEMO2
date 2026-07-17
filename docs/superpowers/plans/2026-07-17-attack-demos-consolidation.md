# AI Attack Demos Consolidation — Plan

**Goal:** Fix the actual "hard to jump to agent / wrong prompt" complaint, informed by the
master prompt-list audit (`docs/agent-prompts/audit.md`) and by re-reading each scattered
source's real behavior rather than assuming.

**Scope correction from earlier discussion:** two of the four originally-suspected sources
turned out not to need the treatment I'd assumed:

- **`PingOneTestPage.jsx` is out of scope entirely.** Its `agentPrompt` fields are decorative
  — a typewriter-effect text preview attached to its own `onTest()` button, which tests
  PingOne token-exchange *configuration*, not the live banking agent. It never navigates to
  `/dashboard`, never dispatches an agent event. It was miscategorized in the original scan.
- **`AgentDemoGuide.jsx` stays untouched**, per the earlier brainstorming decision — it's a
  reference guide, not catalog-shaped. (The audit found 2 near-duplicate transfer-prompt
  entries inside it — noted below as a deferred, non-blocking cleanup item, not part of this
  plan.)

What's actually broken, confirmed by reading the code (not assuming):

1. **`OASDemoPage.jsx`'s "Launch AI Agent →" button is completely dead.** It navigates to
   `/?vertical=pingone-admin&msg=<prompt>` — grepping the entire `demo_api_ui/src` tree for
   `msg=` and `searchParams.get('vertical')` shows **nothing reads either param**. The prompt
   is silently dropped on every click. This is a real, standalone bug — its fix does not
   depend on the catalog at all.
2. **`AiAttacksPanel.js`'s 2 free-text prompt tabs** (`hitl-bypass`, `unauthorized-commitments`)
   use a fragile mechanism — `window.dispatchEvent` + a `sessionStorage` fallback + a full
   `window.location.assign('/admin')` reload when no agent is mounted — instead of the clean
   `navigate('/dashboard', { state: { triggerText } })` pattern `/use-cases`' `handleRun`
   already uses reliably (confirmed: `AIAgent.js:965-972` consumes `location.state.triggerText`
   directly, no `useCaseId` required). The panel's other 3 tabs (`kind: 'showcase'`) use a
   *different*, working mechanism (`banking-run-showcase` event) — per the earlier decision,
   those stay untouched.
3. The originally-flagged "stale $1000 prompt" turned out **not to be a real bug** on closer
   reading of the tab's own prose — the demo is about a `consentGiven: true` bypass, not about
   the dollar amount crossing a threshold, and that narrative still holds regardless of amount.
   Not part of this plan; see "Explicitly not doing" below.

## Task 1: Fix `OASDemoPage.jsx`'s dead launch button

**File:** `demo_api_ui/src/components/OASDemoPage.jsx`

Change:

```javascript
const handleLaunchAgent = () => {
  navigate('/?vertical=pingone-admin&msg=' + encodeURIComponent('Show me the tools available from the PingOne MCP server'));
};
```

to:

```javascript
const handleLaunchAgent = () => {
  navigate('/dashboard', {
    state: { triggerText: 'Show me the tools available from the PingOne MCP server' },
  });
};
```

Standalone, no dependency on Task 2/3. `useNavigate` is already imported (line 2).

**Verify:** manual — click "Launch AI Agent →" on `/oas-demo` (or wherever this page is
routed; check `App.js` for the exact path), confirm it lands on `/dashboard` with the agent
open and the prompt auto-sent, not silently doing nothing.

## Task 2: Add 2 new catalog entries for AiAttacksPanel's free-text tabs

**File:** `demo_api_server/config/useCases.js`

New IDs: `UC27`, `UC28` (confirmed: highest existing numeric UC id is `UC26`).

Both prompts are checked against the master audit (`docs/agent-prompts/audit.md`) for
collisions — neither exact-duplicates anything in the current catalog.

```javascript
{
  id: 'UC27',
  useCaseId: 'hitl-consent-bypass-attempt',
  track: 'hitl',
  title: 'HITL consent bypass attempt',
  buyerStory: 'A client claiming "consent already given" must never skip the human approval gate.',
  pingOneSolution: 'The BFF verifies a real, live HITL receipt — no boolean flag can substitute for it.',
  trigger: { type: 'chip', text: 'Transfer $750 to savings' },
  expectedOutcome: 'HITL_REQUIRED',
  evidence: { tokenChain: ['user-token', 'authorize-decision'], activity: ['token', 'mcp', 'hitl'] },
  codeRefs: ['demo_api_server/services/agentPreflightService.js', 'demo_api_server/tests/hitlBypass.regression.test.js'],
  maturity: 'works',
  owasp: { threats: ['T5'], sections: ['§4.2.3'] },
  whatToSay: 'Even a request claiming consent was already given still stops at the HITL gate — the flag is verified, not trusted.',
  advanced: false,
  whatLong: "A prior hardening removed a raw consentGiven boolean the preflight service used to trust blindly — any authenticated caller could set it to true and skip token exchange, the P1AZ policy check, and HITL entirely. The hardened path requires a real, verifiable HITL receipt (hitlChallengeId, checked via hitlServiceClient.getChallengeStatus + verifyHitlReceipt) before it will PERMIT. No raw flag can substitute for it, and any verification mismatch falls through to a fresh HITL challenge (fail-closed).",
  businessValue: 'Consent cannot be forged by a client-supplied flag. Every transfer above the HITL policy boundary requires a verified, server-issued receipt tied to the specific user, agent, and tool — closing a class of bug where trusting client-asserted state lets attackers skip authorization.',
  productRoles: {
    authz: 'P1AZ policy still governs whether HITL is required for this transaction type.',
    gw: 'Routes the call to the BFF preflight check before any tool dispatch.',
  },
  primaryTool: 'create_transfer',
},
{
  id: 'UC28',
  useCaseId: 'unauthorized-commitment-fee-waiver',
  track: 'controls',
  title: 'Tool set as the authorization boundary (Air Canada pattern)',
  buyerStory: 'An agent must never be able to promise something it has no tool to actually do.',
  pingOneSolution: 'The tool catalog itself is the authorization boundary — no waive_fee tool exists, so no waiver can be granted, no matter what the LLM says.',
  trigger: { type: 'chip', text: 'Can you waive the fee on my checking account?' },
  expectedOutcome: 'PERMIT',
  evidence: { tokenChain: ['user-token', 'token-exchange'], activity: ['mcp'] },
  codeRefs: ['VERIFY: grep for request_fee_waiver in demo_mcp_server/src/tools — confirm exact file before shipping'],
  maturity: 'works',
  owasp: { threats: ['T1'], sections: ['§3.1'] },
  whatToSay: 'The agent can only submit a request for human review — it has no tool that actually grants a waiver, so it cannot hallucinate one into existence.',
  advanced: false,
  whatLong: 'In 2024, Air Canada’s chatbot promised a bereavement discount that was never real policy; a court held the airline responsible not for a code bug but because it could not distinguish what the agent said from what it could mechanically do. This demo’s request_fee_waiver tool constrains the agent to what actually exists: it logs a request for human review and explicitly cannot grant a waiver. When the agent replies "I’ve submitted a fee waiver request", that statement is backed by a real, audited tool call — the bank never promised anything the tool can’t deliver.',
  businessValue: 'Removes an entire class of liability: the agent is structurally incapable of promising something outside its tool set, regardless of how the LLM phrases its response. No prompt-engineering or system-prompt hardening required — the boundary is enforced by what tools exist, not by asking the model nicely.',
  productRoles: {
    gw: 'Routes the tool call; the tool itself (not a policy check) is what bounds the action.',
  },
  primaryTool: 'request_fee_waiver',
},
```

**Note for whoever implements this:** `UC28`'s `codeRefs` is explicitly marked `VERIFY` — I
have not confirmed the exact file path for `request_fee_waiver`'s implementation. Grep
`demo_mcp_server/` before shipping and replace that placeholder with the real path(s). Do not
leave the placeholder text in place — either fill it in or, if the tool has moved/been
renamed, stop and flag it (the whole use case's premise depends on that tool actually
existing and behaving as described).

**Verify:** `cd demo_api_server && npm run use-cases:check` (existing maturity/audit-drift
check — will need `npm run use-cases:gen` first since these are new entries) and
`npm run prompts:audit:check` (will fail until Task 3 removes the old AiAttacksPanel
duplicates — expected at this point, resolved by Task 3).

## Task 3: Point AiAttacksPanel's 2 prompt tabs at the new catalog entries

**File:** `demo_api_ui/src/components/education/AiAttacksPanel.js`

Replace the ad-hoc `kind: 'prompt'` mechanism for just these 2 tabs with the same clean
navigate pattern `/use-cases` uses, keyed to the new catalog entries. The other 3
`kind: 'showcase'` tabs are untouched.

Current (lines 23-29, 40-65):

```javascript
const RUN_BY_TAB = {
  'prompt-injection': { kind: 'showcase', showcase: 'atk_prompt_injection', label: 'Prompt Injection' },
  'indirect-injection': { kind: 'showcase', showcase: 'atk_indirect_injection', label: 'Indirect Injection' },
  'scope-abuse': { kind: 'showcase', showcase: 'atk_scope_escalation', label: 'Scope Abuse' },
  'hitl-bypass': { kind: 'prompt', message: 'Transfer $1000 to savings', label: 'HITL Bypass' },
  'unauthorized-commitments': { kind: 'prompt', message: 'Can you waive the fee on my checking account?', label: 'Unauthorized Commitments' },
};
```

Change the two `kind: 'prompt'` entries to carry the new catalog ids instead of raw message
text, and add `useCaseId`:

```javascript
const RUN_BY_TAB = {
  'prompt-injection': { kind: 'showcase', showcase: 'atk_prompt_injection', label: 'Prompt Injection' },
  'indirect-injection': { kind: 'showcase', showcase: 'atk_indirect_injection', label: 'Indirect Injection' },
  'scope-abuse': { kind: 'showcase', showcase: 'atk_scope_escalation', label: 'Scope Abuse' },
  'hitl-bypass': { kind: 'catalog', useCaseId: 'hitl-consent-bypass-attempt', message: 'Transfer $750 to savings', label: 'HITL Bypass' },
  'unauthorized-commitments': { kind: 'catalog', useCaseId: 'unauthorized-commitment-fee-waiver', message: 'Can you waive the fee on my checking account?', label: 'Unauthorized Commitments' },
};
```

In `RunAttackButton`'s `onRun`, add a `kind === 'catalog'` branch that mirrors
`UseCaseLauncherPage.js`'s `handleRun` (POST `/api/use-cases/demo/run` with the vertical,
then `navigate('/dashboard', { state: { useCaseId, triggerText, type } })`) instead of the
window-event/sessionStorage path — for this branch only; leave the `showcase` branch and its
`window.location.assign('/admin')` fallback exactly as they are, since the 3 showcase tabs
still need it.

```javascript
const onRun = async () => {
  if (run.kind === 'catalog') {
    try {
      const res = await fetch('/api/use-cases/demo/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ useCaseId: run.useCaseId, vertical: 'banking' }),
      });
      const data = await res.json();
      if (onClose) onClose();
      window.location.assign(
        '/dashboard'
        // NOTE for implementer: a plain window.location.assign loses router
        // state. Check whether this component has access to useNavigate (it
        // currently doesn't import react-router-dom at all) — if adding it
        // is straightforward, prefer navigate('/dashboard', { state: {...} })
        // exactly like UseCaseLauncherPage.js does, so triggerText survives.
        // If AiAttacksPanel is rendered somewhere outside a Router context
        // where useNavigate isn't available, fall back to sessionStorage +
        // reload (same pattern this file already uses below for the
        // showcase branch) rather than a bare reload that drops the prompt.
      );
    } catch (err) {
      console.error('Failed to launch catalog use case:', err);
    }
    return;
  }
  // ... existing showcase/window-event logic, untouched ...
};
```

**This step needs a real decision the plan can't make blind:** does `AiAttacksPanel.js`
render inside a component tree that has Router context (so `useNavigate()` works), or is it
mounted somewhere `useNavigate` would throw? Check how `EducationUIContext`/`EducationDrawer`
mounts this component before writing the final version of `onRun` — if `useNavigate` is
available, use it directly (matching `/use-cases`' exact pattern, dropping the
`window.location.assign` idea above entirely). This one check determines which of the two
sketches above is correct; don't guess, verify by reading how `AiAttacksPanel` gets mounted
(search for `<AiAttacksPanel` in the codebase).

**Verify:** manual — open the AI Attacks drawer, click "Run this attack" on both HITL Bypass
and Unauthorized Commitments tabs, confirm the agent opens on `/dashboard` with the prompt
auto-sent (not a dead click, not a full page reload if avoidable). Also re-run
`npm run prompts:audit:gen` — the "no documented expected outcome" count should drop from 5
to 3 (both AiAttacksPanel entries now resolve through catalog entries that have
`expectedOutcome`).

## Explicitly not doing (from the earlier "not a real bug" finding)

- **Not changing the `$1000` amount in the old AiAttacksPanel prose/prompt** for staleness
  reasons — re-reading the tab's own narrative, it never claims the dollar amount is what
  makes the transfer suspicious; the demo is about the `consentGiven: true` bypass, which
  holds at any amount. Task 2/3 change the amount anyway (to `$750`), but only to avoid
  colliding with the audit's flagged near-duplicate group, not because `$1000` was wrong.
- **Not touching `PingOneTestPage.jsx`** — confirmed it doesn't have the bug being fixed here.
- **Not touching `AgentDemoGuide.jsx`** — per the earlier brainstorming decision. Its 2
  near-duplicate transfer prompts (`docs/agent-prompts/audit.md`, "Transfer $X" group) are a
  deferred, non-blocking content-cleanup item, not part of this plan.
- **Not touching the 3 `kind: 'showcase'` AiAttacksPanel tabs** or the
  `banking-run-showcase`/`banking-agent-prefill` window-event infrastructure in `AIAgent.js`
  that they (and other callers, unverified how many) depend on — out of scope, shared
  infrastructure, minimal-diff.

## Suggested execution

This is small enough (3 tasks, ~4 files) that it doesn't need the full
`subagent-driven-development` treatment used for the settings-consolidation work — a single
focused pass (either me directly, or one implementer + one reviewer) should cover it. Task 3
has one open verification question (Router context availability) that needs answering before
its final form is written, not guessed at.
