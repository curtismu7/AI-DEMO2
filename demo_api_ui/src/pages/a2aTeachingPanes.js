// demo_api_ui/src/pages/a2aTeachingPanes.js
'use strict';

/**
 * Turn a buildA2aChainDetail() result into renderable teaching panes.
 *
 * Pure on purpose: the honesty contract below is the whole point of this file,
 * and a contract asserted in a unit test is worth more than one written in a
 * comment. Every pane MUST carry a `provenance` — a test enforces it.
 *
 * PROVENANCE — what each pane actually is:
 *
 *   'reconstructed'  A parameter summary the BFF rebuilt for display. NOT a
 *                    captured HTTP body. `exchangeRequest` deliberately omits
 *                    the subject_token / actor_token values and says
 *                    `has_actor_token: true` instead. The client_credentials
 *                    request panes are synthesised from the resulting claims by
 *                    a2aChainDetail's actorHop() — that request never existed in
 *                    that shape on any wire.
 *   'decoded-claims' The decoded payload of the token that came back. Raw tokens
 *                    never leave the BFF (buildA2aEvent decodes and drops them),
 *                    so this is the only honest "response" we can show.
 *   'live-http'      A real HTTP request the browser just made. Only the Agent
 *                    Card fetch and the no-bearer probe qualify.
 *   'in-process'     The wire hop ran through @a2a-js/sdk IN PROCESS — no HTTP
 *                    crossed the wire. Set A2A_PROTOCOL_HTTP=1 to force the HTTP
 *                    client. The event's own `mode` field decides this.
 *
 * Saying "request/response" without this distinction would be the page lying
 * about its own evidence, which is exactly what a teaching page must not do.
 */

export const PROVENANCE = {
  RECONSTRUCTED: 'reconstructed',
  DECODED: 'decoded-claims',
  LIVE: 'live-http',
  IN_PROCESS: 'in-process',
};

const CAPTION = {
  [PROVENANCE.RECONSTRUCTED]:
    'Reconstructed parameter summary — not a captured HTTP body. Token values are omitted by design.',
  [PROVENANCE.DECODED]:
    'Decoded claims from the token that came back. The raw token never leaves the BFF.',
  [PROVENANCE.LIVE]:
    'A real HTTP request, made from your browser just now.',
  [PROVENANCE.IN_PROCESS]:
    'Handled in-process by @a2a-js/sdk — no HTTP request crossed the wire. A2A_PROTOCOL_HTTP=1 forces the HTTP client.',
};

/** Layer 1 = RFC 8693 identity chain. Layer 2 = Linux Foundation wire protocol. */
export const LAYER = { IDENTITY: 'identity', WIRE: 'wire' };

function pane(key, layer, title, provenance, body, extra = {}) {
  return { key, layer, title, provenance, caption: CAPTION[provenance], body, ...extra };
}

/**
 * @param {object|null} detail - buildA2aChainDetail(tokenEvents) output
 * @returns {Array<object>} panes, in teaching order
 */
export function buildA2aTeachingPanes(detail) {
  if (!detail || !detail.present) return [];
  const panes = [];

  // ── Layer 1: the identity chain ────────────────────────────────────────────
  for (const hop of detail.hops || []) {
    if (hop.request) {
      panes.push(pane(`${hop.id}:req`, LAYER.IDENTITY, `${hop.title} — request`,
        PROVENANCE.RECONSTRUCTED, hop.request));
    }
    if (hop.response) {
      panes.push(pane(`${hop.id}:res`, LAYER.IDENTITY, `${hop.title} — response`,
        PROVENANCE.DECODED, hop.response));
    }
  }

  // ── Layer 2: the wire protocol ─────────────────────────────────────────────
  const proto = detail.protocol;
  if (proto?.bearer) {
    panes.push(pane('wire:bearer', LAYER.WIRE,
      'Wire bearer · PingOne client_credentials',
      PROVENANCE.DECODED, proto.bearer, {
        // The single most important sentence on the page.
        note: 'A SEPARATE token from the nested-act one. The wire hop authenticates as the agent; '
          + 'MCP tools still require the Exchange #2 nested-act token.',
        failed: proto.bearer.status === 'failed',
      }));
  }
  if (detail.agentCard) {
    panes.push(pane('wire:card', LAYER.WIRE, 'Agent Card · discovery',
      PROVENANCE.LIVE, detail.agentCard.card || detail.agentCard, {
        cardUrl: detail.agentCard.cardUrl || null,
      }));
  }
  if (proto?.request) {
    panes.push(pane('wire:req', LAYER.WIRE, 'JSON-RPC message/send — request',
      proto.mode === 'http' ? PROVENANCE.LIVE : PROVENANCE.IN_PROCESS, proto.request,
      { mode: proto.mode || null }));
  }
  if (proto?.response) {
    panes.push(pane('wire:res', LAYER.WIRE, 'JSON-RPC message/send — response',
      proto.mode === 'http' ? PROVENANCE.LIVE : PROVENANCE.IN_PROCESS, proto.response,
      { mode: proto.mode || null }));
  }

  return panes;
}

/** Pull the teaching-relevant bits out of a raw Agent Card. */
export function summarizeAgentCard(card) {
  if (!card || typeof card !== 'object') return null;
  const iface = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces[0] : null;
  return {
    name: card.name || null,
    version: card.version || null,
    skills: (Array.isArray(card.skills) ? card.skills : []).map((s) => s.id || s.name).filter(Boolean),
    securitySchemes: Object.keys(card.securitySchemes || {}),
    protocolBinding: iface?.protocolBinding || null,
    protocolVersion: iface?.protocolVersion || null,
    url: iface?.url || null,
  };
}

/**
 * The act chain as PingOne Authorize receives it. `depth` is what the policy's
 * ActChainDepth sees: 2 means "specialist acting for generalist acting for user",
 * which is the only shape the A2A rules permit.
 */
export function summarizeActChain(detail) {
  if (!detail?.present) return null;
  const ex2 = (detail.hops || []).find((h) => h.id === 'a2a-exchange2');
  const act = ex2?.response?.act || null;
  // Prefer the value the event actually carried; fall back to reading the
  // nesting. Authorize sees this as ActChainDepth.
  const carried = ex2?.response?.actChainDepth;
  return {
    depth: carried != null ? Number(carried) : (act?.act ? 2 : act ? 1 : 0),
    specialist: act?.sub || null,
    generalist: act?.act?.sub || null,
    scope: ex2?.response?.scope || null,
    tool: detail.tool || null,
  };
}
