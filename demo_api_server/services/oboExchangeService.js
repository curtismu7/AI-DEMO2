'use strict';
const { getOboConfig } = require('./oboConfig');
const { buildEvidence } = require('./oboEvidence');
const { verifyDownstream } = require('./oboDownstream');
const { getAgentCCToken } = require('./agentCCTokenService');
const oauthService = require('./oauthService');
const oauthEndpointResolver = require('./oauthEndpointResolver');
const trace = require('./oboTrace');

const defaultDeps = {
  verifyDownstream,
  // Actor = the AI Agent app's client-credentials token (the proven path), NOT the exchanger's own.
  getActorToken: async (req, cfg) => (await getAgentCCToken(req, {
    clientId: cfg.agent.id, clientSecret: cfg.agent.secret, scope: [cfg.actorScope], authMethod: 'post',
  })).access_token,
  // Exchanging app = Token Exchanger (proven), not the admin client used by performTokenExchangeWithActor.
  exchange: (subjectToken, actorToken, cfg) => oauthService.performTokenExchangeAs(
    subjectToken, actorToken, cfg.exchanger.id, cfg.exchanger.secret, cfg.audience, cfg.scope, 'post',
    { tokenEndpoint: oauthEndpointResolver.getPingOneTokenEndpoint() },
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
  const steps = [trace.signedInStep(subjectToken)];
  // A failed hop throws with the partial trace attached, so the page can show where it stopped.
  const fail = (id, started, err) => Object.assign(err, { trace: [...steps, trace.failureStep(id, Date.now() - started, err, [subjectToken]), ...trace.skipFrom(id + 1)] });

  let t = Date.now();
  let actorToken;
  try { actorToken = await d.getActorToken(req, cfg); } catch (err) { throw fail(2, t, err); }
  steps.push(trace.actorStep(actorToken, cfg, Date.now() - t));

  t = Date.now();
  let delegatedToken;
  try { delegatedToken = await d.exchange(subjectToken, actorToken, cfg); } catch (err) { throw fail(3, t, err); }
  steps.push(trace.exchangeStep(cfg, subjectToken, actorToken, Date.now() - t));

  const timed = async (token) => { const started = Date.now(); const r = await d.verifyDownstream(token); return { status: r.status, ms: Date.now() - started }; };
  const [accepted, refused] = await Promise.all([timed(delegatedToken), timed(subjectToken)]);
  const evidence = buildEvidence({
    source, subjectToken, delegatedToken, actorClientId: cfg.agent.id,
    downstream: { delegated: accepted.status, userToken: refused.status },
  });
  return { ...evidence, steps: [...steps, ...trace.resultSteps(evidence, accepted, refused)] };
}

module.exports = { runObo };
