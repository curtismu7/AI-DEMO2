// What Ping decided for a Dot reply, read from the invoke response. Nothing is invented: a reply with no
// Authorize evaluation (a catalog answer, a chat with no tool call) carries no governance at all.
const VERDICTS = ['PERMIT', 'DENY', 'INDETERMINATE'];

export function governanceFrom(data) {
  const decision = String(data?.mcpAuthorizeEvaluation?.decision || '').toUpperCase();
  if (!VERDICTS.includes(decision)) return undefined;
  const tools = Array.isArray(data?.toolsCalled)
    ? data.toolsCalled.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
    : [];
  return { decision, tools };
}
