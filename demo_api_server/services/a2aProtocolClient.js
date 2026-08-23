'use strict';

/**
 * A2A Protocol client — PingOne Bearer + Agent Card + SendMessage.
 *
 * Live UC2 path uses in-process @a2a-js/sdk DefaultRequestHandler (BFF is HTTPS;
 * loopback HTTP would fail). HTTP endpoints under /a2a/specialists remain for
 * external clients / inspector. Soft-fails so nested-act MCP still succeeds.
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
const { buildA2aEvent } = require('./a2aDelegationService');
const {
  specialistRpcUrl,
  buildSpecialistAgentCard,
  pushAgentCardEvent,
} = require('./a2aAgentCardService');
const { createSpecialistProtocolHandler } = require('./a2aProtocolServer');
const { decodeJwt } = require('../utils/tokenUtils');

function defaultOauthService() {
  return require('./oauthService');
}

const DEFAULT_HANDOFF_TIMEOUT_MS = 5000;

function withTimeout(operation, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out (${timeoutMs}ms)`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Loopback base (trailing slash) when forcing HTTP client mode. */
function loopbackSpecialistBase(vertical) {
  const port = process.env.PORT || '3001';
  const host = process.env.A2A_PROTOCOL_LOOPBACK_HOST || '127.0.0.1';
  return `http://${host}:${port}/a2a/specialists/${encodeURIComponent(vertical)}/`;
}

/**
 * Run A2A wire handoff.
 * @returns {Promise<{ ok: boolean, tokenEvents: object[], replyText?: string, error?: string }>}
 */
async function sendA2aProtocolHandoff(opts = {}) {
  const tokenEvents = opts.tokenEvents || [];
  const vertical = opts.vertical;
  const subtask = opts.subtask || 'A2A specialist handoff';
  const oauth = opts.deps?.oauthService || defaultOauthService();
  const useHttp = Boolean(opts.baseUrl || process.env.A2A_PROTOCOL_HTTP === '1');
  const timeoutMs = opts.timeoutMs || DEFAULT_HANDOFF_TIMEOUT_MS;

  let bearer;
  try {
    bearer = await withTimeout(
      () => oauth.getAiAgentClientCredentialsToken(),
      timeoutMs,
      'A2A protocol bearer mint',
    );
  } catch (err) {
    tokenEvents.push(
      buildA2aEvent(
        'a2a-protocol-bearer',
        'A2A Protocol — PingOne wire bearer (failed)',
        'failed',
        null,
        `Could not mint PingOne client_credentials for A2A hop: ${err.message}`,
        { a2aRole: 'protocol-bearer', vertical, error: err.message },
      ),
    );
    return { ok: false, tokenEvents, error: err.message };
  }

  const bearerClaims = decodeJwt(bearer)?.claims || null;
  tokenEvents.push(
    buildA2aEvent(
      'a2a-protocol-bearer',
      'A2A Protocol — PingOne wire bearer · client_credentials',
      'acquired',
      bearer,
      'Separate from nested-act MCP tokens. Pattern: Magic 8 Ball security sample (bearer to A2A server) with PingOne as IdP.',
      {
        a2aRole: 'protocol-bearer',
        vertical,
        publicCardUrl: `${specialistRpcUrl(vertical, opts.cfg)}/.well-known/agent-card.json`,
        clientId: bearerClaims?.client_id || bearerClaims?.sub || null,
      },
    ),
  );

  try {
    if (useHttp) {
      return await withTimeout(() => sendViaHttp({
        bearer,
        vertical,
        subtask,
        tokenEvents,
        baseUrl: opts.baseUrl || loopbackSpecialistBase(vertical),
      }), timeoutMs, 'A2A protocol HTTP handoff');
    }
    return await withTimeout(() => sendInProcess({
      bearer,
      bearerClaims,
      vertical,
      subtask,
      tokenEvents,
      cfg: opts.cfg,
    }), timeoutMs, 'A2A protocol in-process handoff');
  } catch (err) {
    tokenEvents.push(
      buildA2aEvent(
        'a2a-protocol-message',
        'A2A Protocol — SendMessage failed',
        'failed',
        null,
        `Wire hop failed (nested-act MCP path unchanged): ${err.message}`,
        { a2aRole: 'protocol-message', vertical, error: err.message },
      ),
    );
    return { ok: false, tokenEvents, error: err.message };
  }
}

/** In-process SDK handler (default for UC2 on HTTPS BFF). */
async function sendInProcess({ bearer, bearerClaims, vertical, subtask, tokenEvents, cfg }) {
  void bearer; // validated by mint + decode above; HTTP path enforces Authorization header
  const built = createSpecialistProtocolHandler(vertical, cfg);
  if (!built) {
    throw new Error(`No A2A protocol handler for vertical "${vertical}"`);
  }

  const card = built.card || buildSpecialistAgentCard(vertical, cfg);
  pushAgentCardEvent(buildA2aEvent, tokenEvents, card, vertical, cfg, 'in-process');
  const clientId = bearerClaims?.client_id || bearerClaims?.sub || 'a2a-client';
  const user = {
    get isAuthenticated() {
      return true;
    },
    get userName() {
      return String(clientId);
    },
  };

  const result = await built.handler.sendMessage(
    {
      tenant: '',
      message: {
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
        metadata: { vertical, demoLayer: 'a2a-protocol-wire' },
        extensions: [],
        referenceTaskIds: [],
      },
      configuration: undefined,
      metadata: undefined,
    },
    new ServerCallContext({ user, requestedVersion: '1.0' }),
  );

  const replyText = extractText(result);
  const protocolRequest = {
    method: 'message/send',
    mode: 'in-process',
    message: {
      role: 'user',
      text: String(subtask),
      metadata: { vertical, demoLayer: 'a2a-protocol-wire' },
    },
  };
  tokenEvents.push(
    buildA2aEvent(
      'a2a-protocol-message',
      `A2A Protocol — SendMessage → ${card?.name || vertical}`,
      'completed',
      null,
      replyText ||
        'In-process Agent Card + SendMessage completed (A2A wire hop; HTTP card still published).',
      {
        a2aRole: 'protocol-message',
        vertical,
        agentName: card?.name || null,
        replyText,
        mode: 'in-process',
        protocolRequest,
        protocolResponse: { replyText, ok: true },
      },
    ),
  );
  return { ok: true, tokenEvents, replyText, agentName: card?.name || null };
}

/** Optional HTTP client (A2A_PROTOCOL_HTTP=1 or opts.baseUrl). */
async function sendViaHttp({ bearer, vertical, subtask, tokenEvents, baseUrl }) {
  const authFetch = createAuthenticatingFetchWithRetry(globalThis.fetch.bind(globalThis), {
    headers: async () => ({
      Authorization: `Bearer ${bearer}`,
      'A2A-Version': '1.0',
    }),
    shouldRetryWithHeaders: async () => undefined,
  });

  const factory = new ClientFactory({
    agentCardResolver: new DefaultAgentCardResolver({ fetchImpl: authFetch }),
    transports: [new JsonRpcTransportFactory({ fetchImpl: authFetch })],
  });

  const client = await factory.createFromUrl(baseUrl);
  const card = await client.getAgentCard();
  pushAgentCardEvent(buildA2aEvent, tokenEvents, card, vertical, null, 'http');
  const result = await client.sendMessage({
    message: {
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
      metadata: { vertical, demoLayer: 'a2a-protocol-wire' },
      extensions: [],
      referenceTaskIds: [],
    },
  });

  const replyText = extractText(result);
  const protocolRequest = {
    method: 'message/send',
    mode: 'http',
    message: {
      role: 'user',
      text: String(subtask),
      metadata: { vertical, demoLayer: 'a2a-protocol-wire' },
    },
  };
  tokenEvents.push(
    buildA2aEvent(
      'a2a-protocol-message',
      `A2A Protocol — SendMessage → ${card?.name || vertical}`,
      'completed',
      null,
      replyText || 'HTTP Agent Card + JSON-RPC SendMessage completed.',
      {
        a2aRole: 'protocol-message',
        vertical,
        agentName: card?.name || null,
        replyText,
        mode: 'http',
        protocolRequest,
        protocolResponse: { replyText, ok: true },
      },
    ),
  );
  return { ok: true, tokenEvents, replyText, agentName: card?.name || null };
}

function extractText(result) {
  return (
    result?.parts
      ?.map((p) => (p?.content?.$case === 'text' ? p.content.value : ''))
      .filter(Boolean)
      .join(' ') || null
  );
}

module.exports = {
  sendA2aProtocolHandoff,
  loopbackSpecialistBase,
};
