// What the agent says when a run it started (Step 25A, the Step 26 chain) fails.
//
// A 429 from the model provider is the common one in a demo: the provider is refusing
// requests until its quota or rate limit resets. The run uses the standalone main agent's
// own model (MAIN_AGENT_PROVIDER in its .env), not the chat's LLM picker, so switching the
// picker changes nothing; say so, or the presenter switches the wrong thing.
const QUOTA = /\b429\b|quota|rate.?limit|too many requests|resource.?exhausted/i;

/** One short line: an upstream error can be a long multi-line JSON blob. */
export function briefRunError(error) {
  const text = String(error || 'unknown error').replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237)}…` : `${text}.`;
}

export function isQuotaError(error) {
  return QUOTA.test(String(error || ''));
}

/** The transcript message for a failed run of `stepLabel`. */
export function runFailureMessage(stepLabel, error) {
  if (isQuotaError(error)) {
    return [
      `${stepLabel} — the run failed: the model behind this run returned 429.`,
      'That means its provider is refusing requests because the quota or rate limit is used up, not that the demo is broken.',
      'Wait for the quota to reset, or switch the model this run uses: set MAIN_AGENT_PROVIDER (and its model and key) in the standalone Privilege A2A agent\'s .env, then restart the main agent.',
      'This run does not use the chat\'s LLM picker, so changing the picker will not help.',
    ].join(' ');
  }
  return `${stepLabel} — the run failed: ${briefRunError(error)}`;
}
