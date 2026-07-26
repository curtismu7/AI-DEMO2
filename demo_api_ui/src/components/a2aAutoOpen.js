// demo_api_ui/src/components/a2aAutoOpen.js
'use strict';

import { extractA2aFacts } from '../utils/a2aFacts';

/**
 * True when an agent response is a successful A2A delegation: the reply says
 * "Delegation complete", an a2a-exchange2 token event exists, and no
 * a2a-exchange-failed event is present. Only A2A delegations emit
 * a2a-exchange2, so this response signal alone is sufficient — no use-case id
 * needed. Never throws on a null/partial response.
 */
export function shouldAutoOpenA2a(response) {
  if (!response) return false;
  const events = Array.isArray(response.tokenEvents) ? response.tokenEvents : [];
  const hasExchange2 = events.some((e) => e && e.id === 'a2a-exchange2');
  const failed = events.some((e) => e && e.id === 'a2a-exchange-failed');
  const replyOk = /Delegation complete/i.test(String(response.reply || ''));
  return replyOk && hasExchange2 && !failed;
}

/**
 * Full explain-modal UC for a successful A2A run.
 * The auto-open path used to pass a stub without productRoles / primaryTool,
 * which left Ping products, Authorize, and Gateway sections empty.
 */
export function buildA2aExplainUc(response) {
  const facts = extractA2aFacts(response?.tokenEvents);
  return {
    id: 'UC2',
    a2a: true,
    track: 'foundations',
    title: 'Agent-to-Agent delegation',
    whatLong:
      response?.reply ||
      'A generalist AI agent hands a task to a specialist sub-agent with a nested RFC 8693 act chain.',
    pingOneSolution:
      'PingOne mints a nested RFC 8693 act chain; Authorize decides PERMIT/DENY over the chain.',
    businessValue:
      'Multi-agent pipelines stay governed end-to-end. Each specialist inherits only the scope the handoff explicitly granted — least privilege across agent hops, with the full chain visible in the token.',
    productRoles: {
      idp: 'Mints a nested-act delegated token for the specialist, narrowing scope at each exchange hop.',
      gw: 'Validates the nested act chain on the A2A gateway audience and routes the specialist tool call after PERMIT.',
      authz: 'Evaluates ActChainDepth and NestedActClientId; PERMITs depth-2 specialist delegation and DENIEs the generalist acting alone on a2aDelegated tools.',
    },
    // Topology is keyed by the specialist MCP tool, not delegate_to_specialist.
    primaryTool: facts.tool || 'get_portfolio_summary',
  };
}
