'use strict';

/** A2A demo use cases (the only ones that render the A2A teaching section). */
export function isA2aUseCase(uc) {
  return !!uc && (uc.id === 'UC2' || uc.id === 'UC2.5');
}

function byId(events, id) {
  return (Array.isArray(events) ? events : []).find((e) => e && e.id === id) || null;
}

/** Flatten a nested act claim { sub, act:{ sub, … } } to ['sub','sub',…]. */
function flattenAct(act) {
  const chain = [];
  let node = act;
  let guard = 0;
  while (node && typeof node === 'object' && guard < 6) {
    if (node.sub) chain.push(String(node.sub));
    else if (node.client_id) chain.push(String(node.client_id));
    node = node.act;
    guard += 1;
  }
  return chain.length ? chain : null;
}

function flatAud(aud) {
  if (!aud) return null;
  return Array.isArray(aud) ? (aud[aud.length - 1] || null) : String(aud);
}

/**
 * Map the four a2a-* token events to display facts. Tolerates missing events
 * (returns nulls, never throws) so the modal can render an empty live-panel.
 */
export function extractA2aFacts(tokenEvents) {
  const ex1 = byId(tokenEvents, 'a2a-exchange1');
  const ex2 = byId(tokenEvents, 'a2a-exchange2');
  const a1 = byId(tokenEvents, 'a2a-agent1-actor');
  const a2 = byId(tokenEvents, 'a2a-agent2-actor');
  const present = !!ex2;

  return {
    present,
    generalist: a1?.claims?.client_id || a1?.claims?.sub || null,
    specialist: ex2?.specialist || a2?.specialist || a2?.claims?.client_id || null,
    intermediateAud: flatAud(ex1?.claims?.aud),
    gatewayAud: flatAud(ex2?.claims?.aud),
    scope: ex2?.scope || ex2?.claims?.scope || null,
    actChainDepth: typeof ex2?.actChainDepth === 'number' ? ex2.actChainDepth : null,
    tool: ex2?.a2aTool || null,
    actChain: flattenAct(ex2?.claims?.act),
  };
}
