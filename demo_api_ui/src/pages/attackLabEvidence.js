const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function normalizeAttackEvidence(attackId, sourceResult, mode = 'deterministic') {
  const source = isRecord(sourceResult) ? sourceResult : {};
  const candidate = isRecord(source.enforcement) ? source.enforcement : null;
  const enforcement = candidate && typeof candidate.component === 'string'
    && typeof candidate.outcome === 'string'
    ? {
      component: candidate.component,
      outcome: candidate.outcome,
      reason: typeof candidate.reason === 'string' ? candidate.reason : null,
    }
    : null;

  return {
    attackId,
    mode,
    path: typeof source.path === 'string' ? source.path : 'Request path not reported',
    enforcement,
    outcome: enforcement?.outcome || 'not-evaluated',
    modelReached: typeof source.modelReached === 'boolean' ? source.modelReached : null,
    backendReached: typeof source.backendReached === 'boolean' ? source.backendReached : null,
    steps: Array.isArray(source.steps) ? source.steps.filter(isRecord) : [],
    raw: sourceResult ?? null,
  };
}
