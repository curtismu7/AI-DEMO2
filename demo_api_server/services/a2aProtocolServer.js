'use strict';

/**
 * A2A Protocol specialist servers (@a2a-js/sdk) — one Agent Card + JSON-RPC
 * mount per vertical in a2aSpecialists. Always on: the a2aDelegated tools are
 * reachable ONLY through the two-hop chain, so these endpoints are a required
 * subsystem, not a feature.
 */

const crypto = require('node:crypto');
const express = require('express');
const { Role } = require('@a2a-js/sdk');
const {
  DefaultRequestHandler,
  InMemoryTaskStore,
  AgentEvent,
} = require('@a2a-js/sdk/server');
const { jsonRpcHandler } = require('@a2a-js/sdk/server/express');
const {
  specialistForVertical,
  verticalsWithSpecialist,
} = require('../config/a2aSpecialists');
const { buildSpecialistAgentCard } = require('./a2aAgentCardService');
const {
  requireA2aPingOneBearer,
  pingOneA2aUserBuilder,
} = require('../middleware/a2aPingOneBearer');
const { getSignedCard, publicJwks } = require('./a2aCardSigningService');

function defaultConfigStore() {
  return require('./configStore');
}

/** AgentExecutor: acknowledge wire handoff (MCP still uses nested-act path). */
function makeSpecialistExecutor(specialist, vertical = specialist.appKey) {
  return {
    async execute(requestContext, eventBus) {
      const userText =
        requestContext.userMessage?.parts
          ?.map((p) => (p?.content?.$case === 'text' ? p.content.value : ''))
          .filter(Boolean)
          .join(' ') || '';
      const reply =
        `A2A handoff received by ${specialist.specialistName}. ` +
        `Wire auth: PingOne Bearer. MCP tools still require nested-act delegation. ` +
        (userText ? `Task: ${userText.slice(0, 240)}` : '');
      eventBus.publish(
        AgentEvent.message({
          messageId: crypto.randomUUID(),
          contextId: requestContext.contextId || '',
          taskId: requestContext.taskId || '',
          role: Role.ROLE_AGENT,
          parts: [
            {
              content: { $case: 'text', value: reply },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            },
          ],
          metadata: {
            vertical,
            specialistAppKey: specialist.appKey,
            specialist: specialist.specialistName,
            demoLayer: 'a2a-protocol-wire',
          },
          extensions: [],
          referenceTaskIds: [],
        }),
      );
    },
    async cancelTask() {},
  };
}

/**
 * Build request handler + card for one vertical.
 * @param {string} vertical
 * @param {object} [cfg]
 */
function createSpecialistProtocolHandler(vertical, cfg) {
  const specialist = specialistForVertical(vertical);
  if (!specialist) return null;
  const card = buildSpecialistAgentCard(vertical, cfg);
  if (!card) return null;
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    makeSpecialistExecutor(specialist, vertical),
  );
  return { handler, card, specialist };
}

/**
 * Express router: /:vertical/.well-known/agent-card.json + /:vertical JSON-RPC.
 * Mount at `/a2a/specialists` without session authenticateToken.
 */
function createA2aProtocolRouter(opts = {}) {
  const getCfg = opts.configStore || defaultConfigStore;
  const router = express.Router();

  // Verification key for the Agent Card signatures (A2A v1.0 §8.4). Public, like the cards.
  router.get('/.well-known/jwks.json', (_req, res) => res.json(publicJwks()));

  for (const vertical of verticalsWithSpecialist()) {
    const built = createSpecialistProtocolHandler(vertical, typeof getCfg === 'function' ? getCfg() : getCfg);
    if (!built) continue;
    const { handler } = built;
    const base = `/${encodeURIComponent(vertical)}`;

    router.get(`${base}/.well-known/agent-card.json`, async (_req, res) => {
      const cfg = typeof getCfg === 'function' ? getCfg() : getCfg;
      const card = await getSignedCard(vertical, cfg);
      if (!card) return res.status(404).json({ error: 'no_specialist' });
      return res.json(card);
    });

    router.use(
      base,
      requireA2aPingOneBearer(vertical),
      jsonRpcHandler({
        requestHandler: handler,
        userBuilder: pingOneA2aUserBuilder,
      }),
    );
  }

  return router;
}

module.exports = {
  createA2aProtocolRouter,
  createSpecialistProtocolHandler,
  makeSpecialistExecutor,
};
