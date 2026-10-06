// What the agent says when a run it started (Step 25A, the Step 26 chain) fails.
//
// Two upstream model errors are common in a demo and need different advice:
//   429  out of quota or tokens: the provider refuses requests until its quota or rate limit
//        resets, so wait for the reset or switch the model.
//   503  the provider is overloaded ("high demand") or did not answer in time: temporary, so
//        try again in a minute.
// The run uses the standalone main agent's own model (MAIN_AGENT_PROVIDER in its .env), not the
// chat's LLM picker, so switching the picker changes nothing; say so, or the presenter switches
// the wrong thing.
const QUOTA = /\b429\b|quota|rate.?limit|too many requests|resource.?exhausted/i;
const OVERLOADED = /\b503\b|\b529\b|overload|high\s+demand|did\s+not\s+answer\s+within/i;

/** One short line: an upstream error can be a long multi-line JSON blob. */
export function briefRunError(error) {
  const text = String(error || 'unknown error').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237)}…` : `${text}.`;
}

export function isQuotaError(error) {
  return QUOTA.test(String(error || ''));
}

/** Overloaded or not answering. A quota error is never reported as this, even if its text matches. */
export function isOverloadedError(error) {
  const text = String(error || '');
  return !QUOTA.test(text) && OVERLOADED.test(text);
}

const SWITCH_MODEL = 'switch the model this run uses: set MAIN_AGENT_PROVIDER (and its model and key) in the standalone Privilege A2A agent\'s .env, then restart the main agent.';
const NOT_THE_PICKER = 'This run does not use the chat\'s LLM picker, so changing the picker will not help.';

/** The transcript message for a failed run of `stepLabel`. */
export function runFailureMessage(stepLabel, error) {
  if (isQuotaError(error)) {
    return [
      `${stepLabel} — the run failed: the model behind this run returned 429.`,
      'That means its provider is refusing requests because the quota or rate limit is used up, not that the demo is broken.',
      `Wait for the quota to reset, or ${SWITCH_MODEL}`,
      NOT_THE_PICKER,
    ].join(' ');
  }
  if (isOverloadedError(error)) {
    return [
      `${stepLabel} — the run failed: the model behind this run is overloaded right now (503 "high demand", or it did not answer in time).`,
      'That is temporary and not a problem with the demo.',
      `Try again in a minute. If it keeps happening, ${SWITCH_MODEL}`,
      NOT_THE_PICKER,
    ].join(' ');
  }
  return `${stepLabel} — the run failed: ${briefRunError(error)}`;
}
