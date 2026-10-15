'use strict';
const { getOboConfig } = require('./oboConfig');
const { buildEvidence } = require('./oboEvidence');
const { verifyDownstream } = require('./oboDownstream');
const { getAgentCCToken } = require('./agentCCTokenService');
const oauthService = require('./oauthService');
const oauthEndpointResolver = require('./oauthEndpointResolver');
const trace = require('./oboTrace');
const { describeHop, tokenBlock, downstreamHop, withDetail } = require('./oboWire');

const defaultDeps = {
  verifyDownstream,
  // Actor = the AI Agent app's client-credentials token (the proven path), NOT the exchanger's own.
  getActorToken: async (req, cfg) => (await getAgentCCToken(req, {
    clientId: cfg.agent.id, clientSecret: cfg.agent.secret, scope: [cfg.actorScope], authMethod: 'post', onWire: cfg.onWire,
  })).access_token,
  // Exchanging app = Token Exchanger (proven), not the admin client used by performTokenExchangeWithActor.
  exchange: (subjectToken, actorToken, cfg) => oauthService.performTokenExchangeAs(
    subjectToken, actorToken, cfg.exchanger.id, cfg.exchanger.secret, cfg.audience, cfg.scope, 'post',
    { tokenEndpoint: oauthEndpointResolver.getPingOneTokenEndpoint(), onWire: cfg.onWire },
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

async function runObo({ req, subjectToken, source, capture = false }, deps = {}) {
  const cfg = getOboConfig();
  assertConfigured(cfg);
  const d = { ...defaultDeps, ...deps };
  // Real wire per hop, only when the page asks (capture). The Claude path never captures.
  const wires = {};
  const cfgFor = (id) => (capture ? { ...cfg, onWire: (info) => { wires[id] = describeHop(info); } } : cfg);
  const detail = (step, wire, tokens) => (capture ? withDetail(step, wire, tokens) : step);

  const steps = [detail(trace.signedInStep(subjectToken), null, [tokenBlock('user', 'Your access token (session)', subjectToken)])];
  // A failed hop throws with the partial trace attached, so the page can show where it stopped.
  const fail = (id, started, err) => Object.assign(err, { trace: [...steps, detail(trace.failureStep(id, Date.now() - started, err, [subjectToken]), wires[id], null), ...trace.skipFrom(id + 1)] });

  let t = Date.now();
  let actorToken;
  try { actorToken = await d.getActorToken(req, cfgFor(2)); } catch (err) { throw fail(2, t, err); }
  steps.push(detail(trace.actorStep(actorToken, cfg, Date.now() - t), wires[2], [tokenBlock('actor', 'Agent (actor) token', actorToken)]));

  t = Date.now();
  let delegatedToken;
  try { delegatedToken = await d.exchange(subjectToken, actorToken, cfgFor(3)); } catch (err) { throw fail(3, t, err); }
  steps.push(detail(trace.exchangeStep(cfg, subjectToken, actorToken, Date.now() - t), wires[3], [tokenBlock('delegated', 'Delegated token', delegatedToken)]));

  const timed = async (token) => { const started = Date.now(); const r = await d.verifyDownstream(token); return { status: r.status, ms: Date.now() - started, body: r }; };
  const [accepted, refused] = await Promise.all([timed(delegatedToken), timed(subjectToken)]);
  const evidence = buildEvidence({
    source, subjectToken, delegatedToken, actorClientId: cfg.agent.id,
    downstream: { delegated: accepted.status, userToken: refused.status },
  });
  const result = trace.resultSteps(evidence, accepted, refused);
  if (capture) {
    result[0] = withDetail(result[0], null, [tokenBlock('delegated', 'Delegated token', delegatedToken)]);
    result[1] = withDetail(result[1], downstreamHop(delegatedToken, accepted.body), null);
    result[2] = withDetail(result[2], downstreamHop(subjectToken, refused.body), null);
  }
  return { ...evidence, steps: [...steps, ...result] };
}

module.exports = { runObo };
