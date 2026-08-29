'use strict';
/**
 * Replies that must NEVER become a REPLAY golden.
 *
 * Goldens are the Layer-3 demo fallback: when the live stack cannot answer, the
 * recorded reply is served instead. A golden holding a FAILURE message is worse
 * than no golden at all — it fires in front of an audience at exactly the moment
 * the stack is already struggling, and says the demo is broken with a straight
 * face.
 *
 * This list lives here, not in the capture spec, because BOTH sides need it:
 *   - capture-goldens.real.spec.js  — refuse to write one
 *   - check-goldens.js              — refuse to keep one already on disk
 *
 * Capture-side filtering alone is not enough, and that is not hypothetical. On
 * 2026-07-27 two failure replies were captured and sat in the repo until
 * 2026-08-03:
 *   banking/mortgage-delegated-access.json (UC33)
 *     "The llamacpp LLM could not complete this request (empty_answer)…"
 *   banking/unauthorized-commitment-fee-waiver.json (UC28)
 *     "I don't recognize that action (request_fee_waiver). Try …"
 * Neither matched the four patterns the capture spec had, and nothing ever
 * re-validated what was already committed. Both patterns are now below.
 *
 * Adding a pattern here retroactively fails the gate on any golden already on
 * disk that matches it — that is the intent, not a side effect.
 */
const AGENT_FAILURE_PROSE = [
  /unable to retrieve/i,
  /could ?n[o']t complete that request/i,
  /please try rephrasing/i,
  /needs an LLM mode/i,
  // Escaped the capture filter on 2026-07-27 — the LLM's own give-up message.
  // Deliberately broader than the llamacpp wording: any provider that "could not
  // complete this request" is reporting a failure, not answering.
  /could not complete this request/i,
  // The agent's no-match refusal. It names a real tool, so it reads like a
  // response rather than an error — which is exactly why it slipped through.
  /I don'?t recogni[sz]e that action/i,
  // Empty-answer / model-not-loaded reports, whatever prose wraps them.
  /\(empty_answer\)/i,
  // Token/scope plumbing that broke BEFORE policy ran. Four banking goldens
  // carried "Transfer failed: local-fallback: insufficient_scope: missing
  // transfer" on 2026-08-28 — captured while the agent lacked the transfer
  // scope. check-goldens passed all four (no pattern here matched them) and
  // only the full CI suite caught it, via stepVerificationExpectations.test.js
  // asserting banking/UC8 reads like a human-approval gate.
  //
  // NOT `/transfer failed:/i`, tempting as it is. banking/authz-denied is a
  // LEGITIMATE golden whose reply opens "Transfer failed: PingOne Authorize
  // denied MCP tool access for this session." — expectedOutcome DENY, the
  // policy working, exactly what that use case demonstrates. Both candidates
  // were tested against all 131 goldens on disk; the two below match zero of
  // them, `/transfer failed:/i` matches that one.
  //
  // The line is "did policy decide, or did the plumbing fail first": a named
  // Authorize denial is a demo; a local-fallback scope error is a defect.
  /insufficient_scope/i,
  /local-fallback:/i,
];

/**
 * Only the LEADING window of the reply is tested, because a genuine failure
 * message IS the whole reply — it opens with the failure and is short.
 *
 * Matching the full text produces false positives on use cases whose SUBJECT is
 * a failure. UC35 ("Explain why my last blocked action was denied") is exactly
 * that: a healthy 2296-char markdown explanation that says "could not complete
 * this request" at offset 1595 while describing what the agent observed. The two
 * real failures matched at offset 0 and 17 in replies of 110 and 295 chars.
 *
 * Position, not content, is what separates "this reply reports a failure" from
 * "this reply discusses one".
 */
const LEAD_WINDOW = 200;

/**
 * @param {string} reply
 * @returns {RegExp|null} the pattern that matched, or null when the reply is clean.
 */
function failurePatternFor(reply) {
  if (typeof reply !== 'string') return null;
  const lead = reply.trim().slice(0, LEAD_WINDOW);
  return AGENT_FAILURE_PROSE.find((re) => re.test(lead)) || null;
}

module.exports = { AGENT_FAILURE_PROSE, failurePatternFor, LEAD_WINDOW };
