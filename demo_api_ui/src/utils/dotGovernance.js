// What Ping decided for a Dot reply, read from the invoke response. Nothing is invented: a reply with no
// verdict (a chat with no tool call, a consent prompt) carries no governance at all.
//
// The verdict lives in the gateway's own token events (`gw-authorize`, status permit | deny | indeterminate). The
// response's `mcpAuthorizeEvaluation` is only a fallback: when the gateway is authoritative the server skips
// its own check and that object has no decision (`{ ran: false, skipReason: 'gateway_authoritative' }`).
const VERDICTS = ['PERMIT', 'DENY', 'INDETERMINATE'];
// Several decisions in one run: the worst one is the run's verdict.
const SEVERITY = ['DENY', 'INDETERMINATE', 'PERMIT'];

function decisionOf(data) {
  const fromGateway = (Array.isArray(data?.tokenEvents) ? data.tokenEvents : [])
    .filter((event) => event?.id === 'gw-authorize')
    .map((event) => String(event.status || '').toUpperCase())
    .filter((status) => VERDICTS.includes(status));
  if (fromGateway.length) return SEVERITY.find((verdict) => fromGateway.includes(verdict));
  const fromServer = String(data?.mcpAuthorizeEvaluation?.decision || '').toUpperCase();
  return VERDICTS.includes(fromServer) ? fromServer : undefined;
}

export function governanceFrom(data) {
  const decision = decisionOf(data);
  if (!decision) return undefined;
  const tools = Array.isArray(data?.toolsCalled)
    ? data.toolsCalled.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
    : [];
  return { decision, tools };
}
