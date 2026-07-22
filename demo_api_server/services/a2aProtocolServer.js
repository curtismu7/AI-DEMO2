'use strict';

/**
 * A2A Protocol specialist servers (@a2a-js/sdk) — one Agent Card + JSON-RPC
 * mount per vertical in a2aSpecialists. Gated by ff_a2a_delegation.
 */

const crypto = require('crypto');
const express = require('express');
const { Role } = require('@a2a-js/sdk');
const {
  DefaultRequestHandler,
  InMemoryTaskStore,
  AgentEvent,
} = require('@a2a-js/sdk/server');
const { agentCardHandler, jsonRpcHandler } = require('@a2a-js/sdk/server/express');
const { A2A_SPECIALISTS } = require('../config/a2aSpecialists');
const { isA2aEnabled } = require('./a2aDelegationService');
const { buildSpecialistAgentCard } = require('./a2aAgentCardService');
const {
  requireA2aPingOneBearer,
  pingOneA2aUserBuilder,
} = require('../middleware/a2aPingOneBearer');

function defaultConfigStore() {
  return require('./configStore');
}

/** AgentExecutor: acknowledge wire handoff (MCP still uses nested-act path). */
function makeSpecialistExecutor(specialist) {
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
            vertical: specialist.appKey,
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
  const specialist = A2A_SPECIALISTS[vertical];
  if (!specialist) return null;
  const card = buildSpecialistAgentCard(vertical, cfg);
  if (!card) return null;
  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    makeSpecialistExecutor(specialist),
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

  router.use((req, res, next) => {
    const cfg = typeof getCfg === 'function' ? getCfg() : getCfg;
    if (!isA2aEnabled(cfg)) {
      return res.status(404).json({
        error: 'a2a_disabled',
        message: 'A2A protocol endpoints require ff_a2a_delegation',
      });
    }
    return next();
  });

  for (const vertical of Object.keys(A2A_SPECIALISTS)) {
    const built = createSpecialistProtocolHandler(vertical, typeof getCfg === 'function' ? getCfg() : getCfg);
    if (!built) continue;
    const { handler } = built;
    const base = `/${encodeURIComponent(vertical)}`;

    router.use(
      `${base}/.well-known/agent-card.json`,
      agentCardHandler({ agentCardProvider: handler }),
    );

    router.use(
      base,
      requireA2aPingOneBearer,
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
