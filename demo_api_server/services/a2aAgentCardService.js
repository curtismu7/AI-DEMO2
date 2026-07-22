'use strict';

/**
 * Build A2A Protocol v1.0 Agent Cards for every specialist in a2aSpecialists.js.
 * Cards advertise JSON-RPC + PingOne Bearer (httpAuthSecurityScheme).
 */

const { A2A_SPECIALISTS, specialistForVertical } = require('../config/a2aSpecialists');

/** Public BFF origin used in Agent Card interface URLs. */
function publicApiBase(cfg) {
  const fromCfg = cfg && typeof cfg.getEffective === 'function'
    ? cfg.getEffective('PUBLIC_APP_URL')
    : null;
  return String(
    fromCfg ||
      process.env.PUBLIC_APP_URL ||
      process.env.A2A_PROTOCOL_PUBLIC_BASE ||
      'https://api.ping.demo:3001',
  ).replace(/\/$/, '');
}

/**
 * Absolute JSON-RPC URL for a vertical specialist (no trailing slash).
 * @param {string} vertical
 * @param {object} [cfg]
 */
function specialistRpcUrl(vertical, cfg) {
  return `${publicApiBase(cfg)}/a2a/specialists/${encodeURIComponent(vertical)}`;
}

/**
 * Build one Agent Card for a vertical's specialist.
 * @param {string} vertical
 * @param {object} [cfg] configStore-like
 * @returns {object|null} AgentCard-shaped object for @a2a-js/sdk
 */
function buildSpecialistAgentCard(vertical, cfg) {
  const specialist = specialistForVertical(vertical);
  if (!specialist) return null;

  const rpcUrl = specialistRpcUrl(vertical, cfg);
  const skills = (specialist.tools || []).map((tool) => ({
    id: tool,
    name: tool.replace(/_/g, ' '),
    description: `${specialist.specialistName} skill: ${tool}`,
    tags: [vertical, 'a2a', specialist.appKey],
    examples: [specialist.subtaskHint].filter(Boolean),
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
    securityRequirements: [],
  }));

  return {
    name: specialist.specialistName,
    description:
      `${specialist.appName} — A2A specialist for vertical "${vertical}". ` +
      `Wire auth is PingOne Bearer; MCP tools still require nested-act delegation.`,
    version: '1.0.0',
    documentationUrl: 'https://a2a-protocol.org/dev/tutorials/',
    provider: {
      organization: 'Ping Identity Demo',
      url: 'https://a2a-protocol.org',
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {
      pingoneBearer: {
        scheme: {
          $case: 'httpAuthSecurityScheme',
          value: {
            description: 'PingOne access token (client_credentials) for the A2A hop',
            scheme: 'Bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    securityRequirements: [{ schemes: { pingoneBearer: { list: [] } } }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills,
    signatures: [],
    supportedInterfaces: [
      {
        url: rpcUrl,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: '1.0',
      },
    ],
  };
}

/** Agent cards for every registered specialist vertical. */
function buildAllSpecialistAgentCards(cfg) {
  const out = {};
  for (const vertical of Object.keys(A2A_SPECIALISTS)) {
    out[vertical] = buildSpecialistAgentCard(vertical, cfg);
  }
  return out;
}

/**
 * Token-chain row for a discovered Agent Card (teaching surface).
 * Kept here (not a2aProtocolClient) so unit tests avoid loading @a2a-js/sdk.
 * @param {Function} buildA2aEvent from a2aDelegationService
 * @param {object[]} tokenEvents
 * @param {object|null} card
 * @param {string} vertical
 * @param {object} [cfg]
 * @param {'in-process'|'http'} mode
 */
function pushAgentCardEvent(buildA2aEvent, tokenEvents, card, vertical, cfg, mode) {
  const cardUrl = `${specialistRpcUrl(vertical, cfg)}/.well-known/agent-card.json`;
  const skills = (card?.skills || []).map((s) => s.id || s.name).filter(Boolean);
  const iface = card?.supportedInterfaces?.[0] || null;
  tokenEvents.push(
    buildA2aEvent(
      'a2a-agent-card',
      `A2A Protocol — Agent Card · ${card?.name || vertical}`,
      'discovered',
      null,
      'Specialist Agent Card (A2A discovery). Skills and PingOne Bearer security advertised before SendMessage.',
      {
        a2aRole: 'agent-card',
        vertical,
        agentName: card?.name || null,
        cardUrl,
        skills,
        protocolVersion: iface?.protocolVersion || card?.version || '1.0',
        protocolBinding: iface?.protocolBinding || 'JSONRPC',
        securitySchemes: card?.securitySchemes ? Object.keys(card.securitySchemes) : [],
        mode,
      },
    ),
  );
}

module.exports = {
  publicApiBase,
  specialistRpcUrl,
  buildSpecialistAgentCard,
  buildAllSpecialistAgentCards,
  pushAgentCardEvent,
};
