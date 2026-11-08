// Shared by PolicyDecisionTree (the diagram) and PolicyDecisionTracePage (the summary card), so the
// two never disagree about the verdict word.

export const DECISION_LABELS = {
  PERMIT: 'APPROVED',
  DENY: 'DENIED',
  STEP_UP: 'STEP-UP REQUIRED',
  CONSENT: 'CONSENT REQUIRED',
  INDETERMINATE: 'INDETERMINATE',
};

/** Map the normalized evaluate result to one overall display token. */
export function overallDecision(result) {
  if (!result) return 'INDETERMINATE';
  if (result.stepUpRequired) return 'STEP_UP';
  if (result.consentRequired || result.hitlRequired) return 'CONSENT';
  return result.decision || 'INDETERMINATE';
}

/** Chip tone for a display token ('ok' | 'warn' | 'danger' | 'neutral'). */
export function decisionTone(decision) {
  if (decision === 'PERMIT') return 'ok';
  if (decision === 'DENY') return 'danger';
  if (decision === 'STEP_UP' || decision === 'CONSENT') return 'warn';
  return 'neutral';
}

/**
 * Which engine produced the evaluation, from the `engine` field the BFF puts on the result.
 * Only 'pingone' is a real PingOne Authorize decision; every other value is the BFF's own rules.
 */
export function engineLabel(engine) {
  if (engine === 'pingone') return { label: 'PingOne Authorize', tone: 'info', real: true };
  if (engine === 'mock_authz_server') return { label: 'Mock authorization server', tone: 'warn', real: false };
  if (typeof engine === 'string' && /simulated/.test(engine)) return { label: 'Simulated rules', tone: 'warn', real: false };
  if (engine === 'off') return { label: 'Engine off', tone: 'neutral', real: false };
  return { label: 'Not recorded', tone: 'neutral', real: false };
}

/** Total evaluation time in ms from the PingOne response, or null when it was not returned. */
export function elapsedMs(result) {
  const raw = result?.pingoneResponse || result?.raw || {};
  return typeof raw.elapsedMicroseconds === 'number' ? raw.elapsedMicroseconds / 1000 : null;
}
