// /privilege-cedar-live (in the app) and /standalone/cedar-live (chrome-free, no live calls): "Cedar in Privilege (live)".
// A guided tour of three Cedar cases against the real Privilege gateway. It composes the existing live services and content:
// the hold case is /privilege-ai-policies (config/privilegeAiPoliciesDemo + services/privilegeAiPoliciesDemoService), the
// token-scope and act.sub cases are the BFF run behind /privilege-pf-token (services/privilegePfTokenDemoService). This file
// holds only what the tour adds: the step wording, how a run's answer is read, and the measured / not-measured lists.
// Nothing here evaluates a policy; Cedar runs inside the gateway.

export const LIVE_PATH = '/privilege-cedar-live';
export const WALKTHROUGH_PATH = '/standalone/cedar-live';

// Measured 2026-11-16 on the owner's Privilege tenant with a real PingFederate token; the other two cases are the earlier
// measurements the sibling pages already record (hold 2026-10-13, token scope 2026-10-27).
export const STEPS = [
  {
    id: 'hold',
    kicker: 'Step 1 of 3',
    title: 'Hold for a human',
    expect: 'The gateway holds SearchIndexTool and returns an approval id. Approve it in the Privilege console under Access Request Approvals, press Retry, and the same call is allowed.',
    expectWord: 'HELD',
    needs: 'Needs your Privilege sign-in on the opensearch-hitl door (the same sign-in as the AI Policies demo).',
    measured: 'Verified end to end on this door on 2026-10-13.',
  },
  {
    id: 'scope',
    kicker: 'Step 2 of 3',
    title: 'Token-scope gate',
    expect: 'One PingFederate token carries opensearch:admin, another also carries opensearch:search. Both are let through to SearchIndexTool by the grant. The policy refuses the first and allows the second.',
    expectWord: 'BLOCKED BY CEDAR, then ALLOWED',
    needs: 'Needs your demo app sign-in and the PingFederate client secret on the api-server. The page mints the tokens on the server and never shows them.',
    measured: 'Measured 2026-10-27.',
  },
  {
    id: 'actsub',
    kicker: 'Step 3 of 3',
    title: 'Agent act.sub gate',
    expect: 'One PingFederate token whose act claim names this agent. The policy that names this agent lets CountTool run. The policy that names another value refuses ListIndexTool.',
    expectWord: 'ALLOWED, then BLOCKED BY CEDAR',
    needs: 'Needs your demo app sign-in, the PingFederate client secret, and two Active act.sub policies on the pftoken door that the owner creates in the console. This page creates none.',
    measured: 'Measured 2026-11-16.',
  },
];

// What the tour measured, one line per case, from the same measurements the sibling pages record.
export const MEASURED = [
  'Hold: SearchIndexTool was held with an approval id, and allowed on retry after a person approved it in the console (opensearch-hitl door, 2026-10-13).',
  'Token scope: with the policy Active, a PingFederate token without opensearch:search was refused on SearchIndexTool and one with it was allowed (2026-10-27).',
  'act.sub: the AI Policy template "Restrict a tool to tokens carrying a claim" writes Cedar that reads context.token.claims["act.sub"].contains("<agent>") inside a forbid ... unless, and the controller validated it (2026-11-16).',
  'act.sub: with two Active policies on the pftoken door, a real PingFederate client-credentials token whose act is the object {"sub":"<agent>"} was allowed on the tool whose policy names that agent (CountTool) and refused on the tool whose policy names a different value (ListIndexTool): "action denied by policy: ListIndexTool requires act.sub to be <other>" (JSON-RPC -32600).',
  'act.sub: with no policy both tools were allowed, and after the policies were deleted both were allowed again. The refusal showed on the first poll about 7 seconds after the policies were created: one observation, not a propagation time.',
];

// What it did not measure. The last five are the act.sub list the PingFederate token page already records.
export const NOT_MEASURED = [
  'A second real agent with a different act.sub.',
  'act emitted as the text "{}" instead of an object.',
  'The wording of the refusal when no token is sent.',
  'A Candidate policy not enforcing: that is console documentation, it was not re-run.',
  'Exact versus substring matching of the claim: the policy uses contains.',
  'How long a policy change takes to reach the gateway: the console says about 4 minutes, and the 7 seconds above is a single observation.',
  'The approval itself: this page cannot see who approved a held call, it only sees the gateway answer to the retry.',
];

// A /run body is usable when PingFederate refused to mint (shown on its own) or when both gateway answers are there.
const hasAnswers = (data) => Boolean(data?.mint?.error || (data?.pfToken && data?.garbage));

// Reads a { status, data } answer from the BFF run. Returns { signedOut } | { problem } | { data }.
// The wording of the problems matches the PingFederate token page, which makes the same call.
export function interpretRun({ status, data } = {}) {
  if (status === 401) return { signedOut: true };
  if (status === 503) return { problem: 'The PingFederate client secret is not set on the api-server (PF_TOKEN_DEMO_CLIENT_SECRET).' };
  if (!hasAnswers(data)) {
    const why = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : '';
    return { problem: `The run did not return a result (HTTP ${status}).${why ? ` ${why}` : ''}` };
  }
  return { data };
}

// Step 2: the two scope cases. 'enforcing' only when the token without the scope was refused by Cedar AND the one with it
// was allowed. Both allowed is "no policy was enforcing", never the gate working. Anything else is reported as unexpected.
export function scopeGate(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return { state: 'none' };
  const without = cases.find((c) => c.key === 'without');
  const withScope = cases.find((c) => c.key === 'with');
  if (without?.verdict === 'blocked-by-cedar' && withScope?.verdict === 'allowed') return { state: 'enforcing' };
  if (cases.every((c) => c.verdict === 'allowed')) return { state: 'not-enforcing' };
  return { state: 'unexpected' };
}

// Step 1: what the run of the hold scenario means. previous is the outcome of the run before it.
// 'held' and 'approved-retry' are the two expected moments of the walk-through. A first run that is simply allowed means no
// hold policy was enforcing (or an approval is already on record): never reported as the gate working.
export function holdState({ outcome, previous } = {}) {
  if (outcome === 'hold') return 'held';
  if (outcome === 'allow' && previous === 'hold') return 'approved-retry';
  if (outcome === 'allow') return 'not-held';
  if (outcome === 'signin') return 'signin';
  return 'other';
}
