'use strict';
const { getOboConfig } = require('./oboConfig');
const { buildEvidence } = require('./oboEvidence');
const { verifyDownstream } = require('./oboDownstream');
const { getAgentCCToken } = require('./agentCCTokenService');
const oauthService = require('./oauthService');

const defaultDeps = {
  verifyDownstream,
  // Actor = the AI Agent app's client-credentials token (the proven path), NOT the exchanger's own.
  getActorToken: async (req, cfg) => (await getAgentCCToken(req, {
    clientId: cfg.agent.id, clientSecret: cfg.agent.secret, scope: [cfg.actorScope], authMethod: 'post',
  })).access_token,
  // Exchanging app = Token Exchanger (proven), not the admin client used by performTokenExchangeWithActor.
  exchange: (subjectToken, actorToken, cfg) => oauthService.performTokenExchangeAs(
    subjectToken, actorToken, cfg.exchanger.id, cfg.exchanger.secret, cfg.audience, cfg.scope, 'post',
  ),
};

function assertConfigured(cfg) {
  if (!cfg.exchanger?.id || !cfg.exchanger?.secret || !cfg.agent?.id || !cfg.agent?.secret) {
    const err = new Error('OBO demo not configured (Token Exchanger or AI Agent client missing)');
    err.code = 'obo_not_configured';
    err.httpStatus = 503;
    throw err;
  }
}

async function runObo({ req, subjectToken, source }, deps = {}) {
  const cfg = getOboConfig();
  assertConfigured(cfg);
  const d = { ...defaultDeps, ...deps };
  const actorToken = await d.getActorToken(req, cfg);
  const delegatedToken = await d.exchange(subjectToken, actorToken, cfg);
  const [accepted, refused] = await Promise.all([
    d.verifyDownstream(delegatedToken),
    d.verifyDownstream(subjectToken),
  ]);
  return buildEvidence({
    source, subjectToken, delegatedToken, actorClientId: cfg.agent.id,
    downstream: { delegated: accepted.status, userToken: refused.status },
  });
}

module.exports = { runObo };
