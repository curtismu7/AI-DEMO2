export function classifyHostileAgentOutcome(result = {}) {
  const error = String(result.error || result.message || '');
  if (/user not found in system/i.test(error)) {
    return { kind: 'user-not-found', conclusive: false, detail: error };
  }
  if (error) return { kind: 'unavailable', conclusive: false, detail: error };

  const trace = Array.isArray(result.trace) ? result.trace : [];
  const transfer = trace.find((step) => step?.tool === 'create_transfer');
  if (!transfer) {
    return { kind: 'inconclusive', conclusive: false, detail: 'No create_transfer call was observed.' };
  }
  if (transfer.verdict === 'denied') {
    return { kind: 'denied', conclusive: true, detail: transfer.detail || 'Privilege denied create_transfer.' };
  }
  if (transfer.verdict === 'allowed') {
    return { kind: 'allowed-stub', conclusive: true, detail: transfer.detail || 'The hostile MCP stub ran; it moves no money.' };
  }
  return { kind: 'inconclusive', conclusive: false, detail: transfer.detail || 'A create_transfer call was observed, but no policy outcome was reported.' };
}

export function hostileAgentOutcomeLabel(outcome) {
  if (!outcome) return '';
  if (outcome.kind === 'denied') return `Privilege denied create_transfer. The hostile tool backend was not reached. ${outcome.detail}`;
  if (outcome.kind === 'allowed-stub') return `Privilege allowed create_transfer. The hostile MCP stub ran and moved no money. ${outcome.detail}`;
  if (outcome.kind === 'user-not-found') return `Demo user not found in Privilege. Sync the demo user before testing this policy. Run inconclusive. ${outcome.detail}`;
  if (outcome.kind === 'inconclusive') return `${outcome.detail} Run inconclusive.`;
  return `The hostile run could not be evaluated. ${outcome.detail}`;
}
