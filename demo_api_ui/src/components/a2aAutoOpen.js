// demo_api_ui/src/components/a2aAutoOpen.js
'use strict';

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
