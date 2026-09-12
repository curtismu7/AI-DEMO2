'use strict';

/**
 * A2A Protocol client — the GENERALIST's half of the wire hop.
 *
 * The hop carries the Exchange #1 DELEGATED token (sub = the user, act = the
 * generalist). There is no separate client_credentials bearer: one would prove
 * no user, and the specialist needs the user's delegation to chain Exchange #2
 * off. The specialist performs Exchange #2 and the tool call itself, in its own
 * process, and answers with DATA only — no token crosses back.
 *
 * BOTH paths run the same PingOne gate (verifyA2aBearer): the live UC2 path uses
 * the in-process @a2a-js/sdk DefaultRequestHandler, and the HTTP endpoints under
 * /a2a/specialists remain for external clients / the inspector. In-process is
 * not a way around the gate.
 *
 * No soft-fail. A hop that did not happen returns { ok: false, error, code } so
 * the caller can report it, rather than reading as a hop that did.
 */

const crypto = require('crypto');
const { Role } = require('@a2a-js/sdk');
const { ServerCallContext } = require('@a2a-js/sdk/server');
const {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  createAuthenticatingFetchWithRetry,
} = require('@a2a-js/sdk/client');
const {
  buildA2aEvent,
  DEFAULT_EXCHANGE_TIMEOUT_MS,
  DEFAULT_EXCHANGE_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
} = require('./a2aDelegationService');
const { specialistRpcUrl, pushAgentCardEvent } = require('./a2aAgentCardService');
const { createSpecialistProtocolHandler } = require('./a2aProtocolServer');
const { getSignedCard, cardVerifier } = require('./a2aCardSigningService');
const { verifyA2aBearer } = require('../middleware/a2aPingOneBearer');

/**
 * TWO ceilings, because this function wraps two different kinds of work.
 *
 * The quick legs — bearer validation (one PingOne JWKS fetch, cached) and card
 * signing + verification (in-process Ed25519) — keep the original 5s bound. That
 * number was written for a stalled client_credentials mint, which is now gone,
 * but its rationale still holds for these legs: a stalled PingOne call must
 * never hang UC2.
 *
 * The SendMessage leg is different. It now contains the specialist's OWN
 * Exchange #2 and the tool call it makes afterwards, so its ceiling is DERIVED
 * from the budget a2aDelegationService gives that exchange — attempts ×
 * per-attempt timeout, plus the retry delay between attempts — plus one more
 * per-attempt budget as the margin for the tool call. That margin matters:
 * services/bffMcpToolExecutor.js sets no timeout of its own, so this is the only
 * ceiling above the tool call.
 *
 * At 5s a slow-but-succeeding specialist was cut off and reported as
 * a2a_exchange2_failed — a false failure on a working path, which reads as a
 * broken demo rather than a timeout. The bound stays finite either way: an
 * unbounded in-process hop can hang UC2 indefinitely.
 */
const GATE_TIMEOUT_MS = 5000;
const SPECIALIST_EXCHANGE_BUDGET_MS =
  DEFAULT_EXCHANGE_ATTEMPTS * DEFAULT_EXCHANGE_TIMEOUT_MS + DEFAULT_RETRY_DELAY_MS;
const DEFAULT_HANDOFF_TIMEOUT_MS = SPECIALIST_EXCHANGE_BUDGET_MS + DEFAULT_EXCHANGE_TIMEOUT_MS;

/**
 * Specialist failures that mean NO nested-act token was ever minted. The reply
 * is data either way, so the hop has to say which it was: these become
 * { ok: false } and the caller reports delegated:false — exactly what
 * Exchange #2 returning { error } did while it ran on this side of the wire.
 */
const CHAIN_FAILURES = {
  not_authorized_for_skill: 'a2a_unauthorized',
  a2a_no_subject_token: 'a2a_unauthorized',
  a2a_exchange_failed: 'a2a_exchange2_failed',
  a2a_specialist_error: 'a2a_exchange2_failed',
};

function withTimeout(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out (${timeoutMs}ms)`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Loopback base (trailing slash) when forcing HTTP client mode. HTTPS: the BFF is HTTPS-only. */
function loopbackSpecialistBase(vertical) {
  const port = process.env.PORT || '3001';
  const host = process.env.A2A_PROTOCOL_LOOPBACK_HOST || '127.0.0.1';
  return `https://${host}:${port}/a2a/specialists/${encodeURIComponent(vertical)}/`;
}

/** The A2A message both paths send. `tool` is what the specialist authorizes against. */
function buildWireMessage({ subtask, vertical, tool, toolArgs }) {
  return {
    messageId: crypto.randomUUID(),
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: 'text', value: String(subtask) },
        metadata: undefined,
        filename: '',
        mediaType: 'text/plain',
      },
    ],
    contextId: '',
    taskId: '',
    metadata: { vertical, demoLayer: 'a2a-protocol-wire', tool: tool || null, args: toolArgs || {} },
    extensions: [],
    referenceTaskIds: [],
  };
}

/**
 * The reply is ONE text part carrying { result, toolError }, with the chain
 * facts in the message metadata (a2aProtocolServer.js#publishReply).
 */
function readReply(sent) {
  // The request handler returns the Message itself; an AgentEvent-shaped reply
  // carries it under .data. Tolerate both rather than silently reading undefined.
  const msg = sent?.data || sent || {};
  const replyText = (msg.parts || [])
    .map((p) => (p?.content?.$case === 'text' ? p.content.value : ''))
    .filter(Boolean)
    .join(' ') || null;
  let payload = null;
  try {
    payload = replyText ? JSON.parse(replyText) : null;
  } catch (_) {
    payload = null; // a non-JSON reply is reported as no result, never as a raw dump
  }
  return { payload, metadata: msg.metadata || {} };
}

/**
 * Normalize one completed SendMessage into the hop's return value, and emit the
 * a2a-protocol-message event.
 *
 * The explanation and replyText are always SENTENCES: a machine code
 * ("not_authorized_for_skill") or a raw JSON payload must never reach them —
 * both are rendered in the UI.
 */
function finishHop({ sent, tokenEvents, vertical, card, mode, protocolRequest }) {
  const { payload, metadata } = readReply(sent);
  const toolError = payload?.toolError || metadata.toolError || null;
  const chainFailure = toolError ? CHAIN_FAILURES[toolError] || null : null;
  const agentName = card?.name || vertical;
  const actChainDepth = metadata.actChainDepth ?? null;
  const scopes = metadata.scopes || [];

  let explanation;
  if (chainFailure) {
    explanation = `${agentName} refused the handoff (${toolError}) — no nested act chain was minted, so nothing ran.`;
  } else if (toolError) {
    explanation = `${agentName} accepted the handoff and minted its nested act chain, but the tool call did not succeed (${toolError}).`;
  } else {
    explanation = `${agentName} ran the delegated skill under its OWN Exchange #2 nested-act token (act depth ${actChainDepth ?? 'n/a'}) and returned data only — no token crossed the wire.`;
  }

  tokenEvents.push(
    buildA2aEvent(
      'a2a-protocol-message',
      `A2A Protocol — SendMessage → ${agentName}`,
      chainFailure || toolError ? 'failed' : 'completed',
      null,
      explanation,
      {
        a2aRole: 'protocol-message',
        vertical,
        agentName: card?.name || null,
        replyText: explanation,
        mode,
        protocolRequest,
        // Facts, not the payload: the specialist's data is rendered by the
        // caller's result card, and the token chain is not the place for it.
        protocolResponse: { ok: !toolError, toolError, actChainDepth, scopes },
      },
    ),
  );

  if (chainFailure) {
    return { ok: false, tokenEvents, error: toolError, code: chainFailure };
  }
  return {
    ok: true,
    tokenEvents,
    result: payload ? payload.result ?? null : null,
    toolError,
    actChainDepth,
    scopes,
    specialist: metadata.specialist || null,
    specialistAppKey: metadata.specialistAppKey || null,
    agentName: card?.name || null,
  };
}

/**
 * Run the A2A wire handoff with the user's delegated token.
 *
 * @param {object} opts { vertical, subtask, tool, toolArgs, subjectToken,
 *   tokenEvents, cfg, req, sessionId, baseUrl, timeoutMs }
 * @returns {Promise<{ ok: boolean, tokenEvents: object[], result?: any,
 *   toolError?: string|null, actChainDepth?: number|null, scopes?: string[],
 *   specialist?: string|null, error?: string, code?: string }>}
 */
async function sendA2aProtocolHandoff(opts = {}) {
  const tokenEvents = opts.tokenEvents || [];
  const vertical = opts.vertical;
  const subtask = opts.subtask || 'A2A specialist handoff';
  const cfg = opts.cfg;
  const subjectToken = opts.subjectToken || null;
  const tool = opts.tool || null;
  const toolArgs = opts.toolArgs || {};
  const useHttp = Boolean(opts.baseUrl || process.env.A2A_PROTOCOL_HTTP === '1');
  const timeoutMs = opts.timeoutMs || DEFAULT_HANDOFF_TIMEOUT_MS;

  // ── The gate. Both paths, no exception ──────────────────────────────────────
  // Five checks live in verifyA2aBearer: signature/issuer/expiry, the
  // specialist's own audience (RFC 8707), the agent:invoke scope, an act chain
  // exactly one level deep, and the actor being the registered generalist.
  let claims;
  try {
    if (!subjectToken) throw new Error('no delegated token supplied for the A2A hop');
    claims = await withTimeout(
      () => verifyA2aBearer(subjectToken, { vertical, cfg }),
      GATE_TIMEOUT_MS,
      'A2A bearer validation',
    );
  } catch (err) {
    tokenEvents.push(
      buildA2aEvent(
        'a2a-protocol-bearer',
        'A2A Protocol — wire bearer · delegated token (rejected)',
        'failed',
        null,
        `The A2A hop was refused before anything ran: ${err.message}`,
        { a2aRole: 'protocol-bearer', vertical, error: err.message },
      ),
    );
    return { ok: false, tokenEvents, error: err.message, code: 'a2a_unauthorized' };
  }

  tokenEvents.push(
    buildA2aEvent(
      'a2a-protocol-bearer',
      'A2A Protocol — wire bearer · Exchange #1 delegated token',
      'acquired',
      subjectToken,
      'The wire hop carries the user’s own delegated token (sub: the user, act: the generalist) — ' +
        'not a client_credentials token, which would prove no user was behind the call. The same PingOne ' +
        'gate the HTTP route applies validated it here too.',
      {
        a2aRole: 'protocol-bearer',
        vertical,
        publicCardUrl: `${specialistRpcUrl(vertical, cfg)}/.well-known/agent-card.json`,
        clientId: claims?.act?.client_id || claims?.act?.sub || null,
        userSub: claims?.sub || null,
      },
    ),
  );

  // ── Agent Card, signature verified against our OWN jku ─────────────────────
  let card;
  try {
    card = await withTimeout(
      async () => {
        const signed = await getSignedCard(vertical, cfg);
        if (!signed) throw new Error(`no Agent Card published for vertical "${vertical}"`);
        await cardVerifier(cfg)(signed);
        return signed;
      },
      GATE_TIMEOUT_MS,
      'A2A Agent Card verification',
    );
  } catch (err) {
    tokenEvents.push(
      buildA2aEvent(
        'a2a-agent-card',
        `A2A Protocol — Agent Card signature rejected · ${vertical}`,
        'failed',
        null,
        `The specialist's Agent Card did not verify, so the handoff stopped: ${err.message}`,
        { a2aRole: 'agent-card', vertical, error: err.message },
      ),
    );
    return { ok: false, tokenEvents, error: err.message, code: 'a2a_card_signature' };
  }
  pushAgentCardEvent(buildA2aEvent, tokenEvents, card, vertical, cfg, useHttp ? 'http' : 'in-process');

  // ── SendMessage ────────────────────────────────────────────────────────────
  const send = useHttp
    ? () => sendViaHttp({
      subjectToken,
      vertical,
      subtask,
      tool,
      toolArgs,
      tokenEvents,
      card,
      baseUrl: opts.baseUrl || loopbackSpecialistBase(vertical),
    })
    : () => sendInProcess({
      subjectToken,
      claims,
      vertical,
      subtask,
      tool,
      toolArgs,
      tokenEvents,
      card,
      cfg,
      req: opts.req,
      sessionId: opts.sessionId,
    });

  try {
    return await withTimeout(
      send,
      timeoutMs,
      useHttp ? 'A2A protocol HTTP handoff' : 'A2A protocol in-process handoff',
    );
  } catch (err) {
    tokenEvents.push(
      buildA2aEvent(
        'a2a-protocol-message',
        'A2A Protocol — SendMessage failed',
        'failed',
        null,
        `The wire hop failed, so the specialist never ran: ${err.message}`,
        { a2aRole: 'protocol-message', vertical, error: err.message },
      ),
    );
    return { ok: false, tokenEvents, error: err.message, code: 'a2a_exchange2_failed' };
  }
}

/** In-process SDK handler (default for UC2 — the BFF is HTTPS and loopback HTTP would fail). */
async function sendInProcess({
  subjectToken, claims, vertical, subtask, tool, toolArgs, tokenEvents, card, cfg, req, sessionId,
}) {
  // Built with this call's context: the executor needs the bearer (its
  // Exchange #2 subject), the shared tokenEvents (so its a2a-agent2-actor /
  // a2a-exchange2 / tool-dispatched rows land on the chain the UI renders), the
  // session and the tool args.
  const built = createSpecialistProtocolHandler(vertical, cfg, {
    req: req || null,
    tokenEvents,
    sessionId: sessionId || req?.sessionID || '',
    claims,
    toolArgs,
    subjectToken,
  });
  if (!built) {
    throw new Error(`No A2A protocol handler for vertical "${vertical}"`);
  }

  // The A2A user is the USER the token is for, with the generalist as actor —
  // the same shape pingOneA2aUserBuilder gives the HTTP path.
  const userName = String(claims?.sub || 'a2a-user');
  const actor = claims?.act?.client_id || claims?.act?.sub || null;
  const user = {
    get isAuthenticated() {
      return true;
    },
    get userName() {
      return userName;
    },
    get actor() {
      return actor;
    },
  };

  const sent = await built.handler.sendMessage(
    {
      tenant: '',
      message: buildWireMessage({ subtask, vertical, tool, toolArgs }),
      configuration: undefined,
      metadata: undefined,
    },
    new ServerCallContext({ user, requestedVersion: '1.0' }),
  );

  return finishHop({
    sent,
    tokenEvents,
    vertical,
    card,
    mode: 'in-process',
    protocolRequest: {
      method: 'message/send',
      mode: 'in-process',
      bearerKind: 'rfc8693-delegated',
      message: {
        role: 'user',
        text: String(subtask),
        metadata: { vertical, demoLayer: 'a2a-protocol-wire', tool: tool || null },
      },
    },
  });
}

/** Optional HTTP client (A2A_PROTOCOL_HTTP=1 or opts.baseUrl). Same delegated bearer. */
async function sendViaHttp({
  subjectToken, vertical, subtask, tool, toolArgs, tokenEvents, card, baseUrl,
}) {
  const authFetch = createAuthenticatingFetchWithRetry(globalThis.fetch.bind(globalThis), {
    headers: async () => ({
      Authorization: `Bearer ${subjectToken}`,
      'A2A-Version': '1.0',
    }),
    shouldRetryWithHeaders: async () => undefined,
  });

  const factory = new ClientFactory({
    agentCardResolver: new DefaultAgentCardResolver({ fetchImpl: authFetch }),
    transports: [new JsonRpcTransportFactory({ fetchImpl: authFetch })],
  });

  const client = await factory.createFromUrl(baseUrl);
  const sent = await client.sendMessage({
    message: buildWireMessage({ subtask, vertical, tool, toolArgs }),
  });

  return finishHop({
    sent,
    tokenEvents,
    vertical,
    card,
    mode: 'http',
    protocolRequest: {
      method: 'message/send',
      mode: 'http',
      bearerKind: 'rfc8693-delegated',
      message: {
        role: 'user',
        text: String(subtask),
        metadata: { vertical, demoLayer: 'a2a-protocol-wire', tool: tool || null },
      },
    },
  });
}

module.exports = {
  sendA2aProtocolHandoff,
  loopbackSpecialistBase,
};
