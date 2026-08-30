// demo_api_ui/src/utils/a2aChainDetail.js
'use strict';

import { extractA2aFacts } from './a2aFacts';

function byId(events, id) {
  return (Array.isArray(events) ? events : []).find((e) => e && e.id === id) || null;
}

/** Shorten a client id / sub for diagram labels. */
function shortId(v) {
  if (!v) return null;
  const s = String(v);
  return s.length > 14 ? `${s.slice(0, 10)}…` : s;
}

/**
 * Build actor CC request/response pair from an a2a-*-actor event.
 * @param {object|null} ev
 * @param {string} title
 */
function actorHop(ev, title) {
  if (!ev) return null;
  const clientId = ev.claims?.client_id || ev.claims?.sub || null;
  return {
    id: ev.id,
    title,
    request: {
      grant_type: 'client_credentials',
      client_id: clientId,
      audience: Array.isArray(ev.claims?.aud)
        ? ev.claims.aud[ev.claims.aud.length - 1]
        : ev.claims?.aud || null,
      scope: ev.claims?.scope || null,
    },
    response: {
      status: ev.status || null,
      token_type: 'access_token',
      client_id: clientId,
      aud: ev.claims?.aud || null,
      scope: ev.claims?.scope || null,
      exp: ev.claims?.exp || null,
    },
  };
}

/**
 * Build RFC 8693 exchange hop from an a2a-exchange* event.
 * @param {object|null} ev
 * @param {string} title
 */
function exchangeHop(ev, title) {
  if (!ev) return null;
  return {
    id: ev.id,
    title,
    request: ev.exchangeRequest || null,
    response: {
      status: ev.status || null,
      sub: ev.claims?.sub || null,
      aud: ev.claims?.aud || null,
      scope: ev.claims?.scope || ev.scope || null,
      act: ev.claims?.act || null,
      actChainDepth: ev.actChainDepth ?? null,
    },
  };
}

/**
 * Aggregate A2A token-chain events for the Token Inspector overview.
 * Returns present:false when the run has no A2A events (never throws).
 *
 * @param {object[]} tokenEvents
 * @returns {{
 *   present: boolean,
 *   generalist: string|null,
 *   specialist: string|null,
 *   tool: string|null,
 *   vertical: string|null,
 *   diagramLines: string[],
 *   hops: object[],
 *   agentCard: object|null,
 *   protocol: object|null,
 * }}
 */
export function buildA2aChainDetail(tokenEvents) {
  const facts = extractA2aFacts(tokenEvents);
  const a1 = byId(tokenEvents, 'a2a-agent1-actor');
  const ex1 = byId(tokenEvents, 'a2a-exchange1');
  const a2 = byId(tokenEvents, 'a2a-agent2-actor');
  const ex2 = byId(tokenEvents, 'a2a-exchange2');
  const cardEv = byId(tokenEvents, 'a2a-agent-card');
  const protoEv = byId(tokenEvents, 'a2a-protocol-message');
  const bearerEv = byId(tokenEvents, 'a2a-protocol-bearer');

  const hasAny = !!(a1 || ex1 || a2 || ex2 || cardEv || protoEv || bearerEv);
  if (!hasAny) {
    return {
      present: false,
      generalist: null,
      specialist: null,
      tool: null,
      vertical: null,
      diagramLines: [],
      hops: [],
      agentCard: null,
      protocol: null,
    };
  }

  const generalist =
    facts.generalist ||
    a1?.claims?.client_id ||
    a1?.claims?.sub ||
    'Agent 1 (generalist)';
  const specialist =
    facts.specialist ||
    a2?.specialist ||
    a2?.claims?.client_id ||
    'Agent 2 (specialist)';
  const tool = facts.tool || ex2?.a2aTool || null;
  const vertical = ex2?.vertical || a2?.vertical || a1?.vertical || cardEv?.vertical || null;

  const gLabel = shortId(generalist) || 'generalist';
  const sLabel = typeof specialist === 'string' && !specialist.includes('-')
    ? specialist
    : shortId(specialist) || 'specialist';

  const diagramLines = [
    'User (subject)',
    '    │',
    '    │  Exchange #1 · RFC 8693',
    '    ▼',
    `Agent 1 · ${gLabel}`,
    '    │',
    '    │  Exchange #2 · nested act',
    '    ▼',
    `Agent 2 · ${sLabel}`,
  ];
  if (tool) {
    diagramLines.push('    │', `    ▼  tool: ${tool}`);
  }
  if (cardEv) {
    diagramLines.push(
      '    │',
      '    │  Agent Card discovery',
      '    ▼',
      `SendMessage → ${cardEv.agentName || sLabel}`,
    );
  }

  const hops = [
    actorHop(a1, 'Agent 1 (generalist) · client_credentials'),
    exchangeHop(ex1, 'Exchange #1 · User → Agent 1'),
    actorHop(a2, `Agent 2 (${sLabel}) · client_credentials`),
    exchangeHop(ex2, 'Exchange #2 · nested act'),
  ].filter(Boolean);

  const agentCard = cardEv
    ? {
        agentName: cardEv.agentName || null,
        cardUrl: cardEv.cardUrl || null,
        skills: cardEv.skills || [],
        protocolBinding: cardEv.protocolBinding || null,
        protocolVersion: cardEv.protocolVersion || null,
        securitySchemes: cardEv.securitySchemes || [],
        mode: cardEv.mode || null,
        card: cardEv.agentCard || null,
      }
    : null;

  // The wire bearer is layer 2's load-bearing artifact: it proves the A2A
  // protocol hop authenticates with its OWN PingOne client_credentials token,
  // NOT the nested-act token Exchange #2 minted for MCP. Without it the two
  // layers look like one. Built even when SendMessage never ran — on a fresh
  // environment the bearer can fail (unprovisioned specialist app) while the
  // identity chain still completes, and that is a state worth showing.
  const bearer = bearerEv
    ? {
        status: bearerEv.status || null,
        clientId: bearerEv.clientId || bearerEv.claims?.client_id || null,
        aud: bearerEv.claims?.aud || null,
        scope: bearerEv.claims?.scope || null,
        publicCardUrl: bearerEv.publicCardUrl || null,
        error: bearerEv.error || null,
      }
    : null;

  const protocol = (protoEv || bearerEv)
    ? {
        status: protoEv?.status || null,
        agentName: protoEv?.agentName || null,
        mode: protoEv?.mode || null,
        bearer,
        request: protoEv?.protocolRequest || null,
        response: protoEv?.protocolResponse || (protoEv
          ? { replyText: protoEv.replyText || null, error: protoEv.error || null }
          : null),
      }
    : null;

  return {
    present: true,
    generalist,
    specialist,
    tool,
    vertical,
    diagramLines,
    hops,
    agentCard,
    protocol,
  };
}
