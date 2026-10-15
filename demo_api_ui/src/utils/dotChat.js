// Maps one /api/agent/invoke response to the items the Dot workbench renders.
// Verdicts come only from what the route returns; if a verdict can't be
// determined no card is shown (fail closed in the UI).
const FAILED = { kind: 'error', text: 'Dot could not complete that request.' };
// 502/503/504 are the gateway giving up on the model backend (e.g. llama.cpp down: a 60s wait, then 504).
// Say that and name the fix, instead of the generic failure.
const MODEL_DOWN = { kind: 'error', text: 'The model did not answer — it may be unavailable. Switch to Heuristics (top right) and try again.' };

export function mapInvokeResult(status, body) {
  if (status === 401 || body?.need_auth || body?.requiresLogin) return { signedOut: true, items: [], memories: [] };
  if (status === 403 && body?.error === 'intent_not_authorized') {
    return { signedOut: false, memories: [], items: [{ kind: 'tool', name: body.intent || 'request', verdict: 'DENY', reason: body.message }] };
  }
  if (status === 428 && body?.requiresConsent) {
    return { signedOut: false, memories: [], items: [{ kind: 'tool', name: body.action || 'request', verdict: 'CONSENT', reason: body.message }] };
  }
  if (status === 502 || status === 503 || status === 504) return { signedOut: false, memories: [], items: [MODEL_DOWN] };
  if (status >= 400 || !body || typeof body !== 'object') return { signedOut: false, memories: [], items: [FAILED] };

  const tools = Array.isArray(body.toolsCalled) ? body.toolsCalled : [];
  if (tools.length && (body.requiresConsent || body.error === 'hitl_required')) {
    return { signedOut: false, memories: [], items: tools.map((name) => ({ kind: 'tool', name, verdict: 'CONSENT', reason: body.reply })) };
  }
  const denied = body.success === false || body.mcpAuthorizeEvaluation?.decision === 'DENY';
  if (denied && tools.length) {
    return { signedOut: false, memories: [], items: tools.map((name) => ({ kind: 'tool', name, verdict: 'DENY', reason: body.reply })) };
  }
  const items = tools.map((name) => ({ kind: 'tool', name, verdict: 'PERMIT' }));
  if (body.reply) items.push({ kind: 'dot', text: body.reply });
  return { signedOut: false, items, memories: Array.isArray(body.dotMemories) ? body.dotMemories : [] };
}
