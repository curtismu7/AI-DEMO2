// Copy + logic for the standalone Personal Agent Studio learning page (/personal-agent/learn).
// The gate states come from the REAL token events (deriveGates in PersonalAgentStudioPage); nothing
// here invents an outcome — explainRun() only describes what the gates actually reported.

/** The three real gates, in order, with the plain-English teaching copy. ids match deriveGates(). */
export const GATE_COPY = [
  {
    id: 'mfa',
    title: 'Signed in with MFA',
    question: 'Is this a real, signed-in person who passed MFA?',
    why: 'The agent never gets power of its own. The server checks your sign-in, and that MFA happened, before it will mint anything for the agent.',
    results: { permit: 'Signed in and MFA verified', deny: 'Sign-in or MFA check failed', checking: 'Checking your session…' },
  },
  {
    id: 'gw',
    title: 'Gateway token check',
    question: "Is the agent's token valid for this tool?",
    why: "The gateway checks the token's audience, validates it live (RFC 7662 introspection) and requires an act claim that names the agent. A stolen or mis-aimed token stops here.",
    results: { permit: 'Token valid, audience and act claim accepted', deny: 'Token rejected at the gateway', checking: 'Validating the token…' },
  },
  {
    id: 'authz',
    title: 'PingOne Authorize',
    question: "Is this user's agent allowed to do this, right now?",
    why: "Authorize decides on every tool call, live, from the agent's identity, your tier and the action's scope. Risky actions can be held for step-up or approval instead of getting a flat yes or no.",
    results: { permit: 'PERMIT', deny: 'DENY: this action is not allowed', checking: 'Waiting for the decision…' },
  },
];

/** The learning path. Prompts are real airline-vertical prompts; `watch` says what to look at, not what will happen. */
export const LESSONS = [
  {
    id: 'allowed',
    title: 'Run a simple request',
    learn: "A read of your own data. Watch the three gates fill in and where the agent's own token comes from.",
    prompt: 'What is my loyalty status?',
  },
  {
    id: 'stepup',
    title: 'Ask for something sensitive',
    learn: 'Sensitive data needs more than a sign-in. See PingOne hold the request and ask for MFA before the agent can continue.',
    prompt: 'access my sensitive airline bookings',
  },
  {
    id: 'money',
    title: 'Move money',
    learn: 'Paying a fee is a write, so the bar is higher. Watch what Ping requires before the agent is allowed to act.',
    prompt: 'pay a $300 change fee',
  },
];

const BADGE = { waiting: 'Waiting', checking: 'Checking', permit: 'Pass', deny: 'Denied', held: 'Held' };
export const badgeLabel = (status) => BADGE[status] || 'Waiting';

/** The display status of one gate. `held` overrides a still-checking Authorize gate while a step-up is pending. */
export function gateStatus(gate, phase) {
  if (phase === 'held' && gate.id === 'authz' && gate.status !== 'permit' && gate.status !== 'deny') return 'held';
  return gate.status || 'waiting';
}

/** One line under a gate title describing its current result. */
export function gateResult(gate, phase) {
  const copy = GATE_COPY.find((g) => g.id === gate.id);
  const s = gateStatus(gate, phase);
  if (s === 'held') return 'HELD: waiting for step-up (MFA) before this can run';
  if (s === 'waiting') return '';
  return copy?.results[s] || '';
}

/**
 * Plain-English summary of the run, written from the gates that actually reported.
 * @param {{ id: string, status: string }[]} gates deriveGates() output
 * @param {{ phase: 'idle'|'running'|'held'|'done'|'error', errorText?: string }} run
 */
export function explainRun(gates, { phase, errorText = '' }) {
  if (phase === 'idle') return null;
  if (phase === 'running') return { tone: 'info', text: 'Running. Watch the gates fill in as the evidence arrives.' };
  if (phase === 'held') {
    return { tone: 'held', text: 'Held, not refused. The request is paused until you prove it is really you with PingOne MFA. Complete the prompt to release it.' };
  }
  if (phase === 'error') return { tone: 'deny', text: `The request did not complete. ${errorText || 'Try it again.'}`.trim() };
  const denied = gates.find((g) => g.status === 'deny');
  if (denied) {
    const copy = GATE_COPY.find((g) => g.id === denied.id);
    return { tone: 'deny', text: `Refused at "${copy?.title || denied.id}". The agent stopped there, so nothing after that gate ran. That is the control working.` };
  }
  if (gates.every((g) => g.status === 'permit')) {
    return { tone: 'permit', text: 'Allowed. All three gates passed, and the agent acted with a delegated token that names both you and the agent.' };
  }
  const done = gates.filter((g) => g.status === 'permit').length;
  return { tone: 'info', text: `Finished. ${done} of 3 gates reported a pass; the rest did not report for this request.` };
}
