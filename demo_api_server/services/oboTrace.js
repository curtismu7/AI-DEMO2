'use strict';

// Step trace for the /obo-demo page: one entry per hop, with status, timing and facts the browser
// may see (claims, short hashes, statuses). Never a token. Steps 1..7 are fixed so the page can
// attach titles and explanations by id.
const { sha, claims, hasTokenLeak } = require('./oboEvidence');

const LAST_STEP = 7;
const safeClaims = (token) => { try { return claims(token); } catch { return {}; } };
const scopeFacts = (scope) => { const l = String(scope || '').split(' ').filter(Boolean); return { count: l.length, sample: l.slice(0, 4) }; };
const minutesLeft = (exp) => (exp ? Math.round((exp * 1000 - Date.now()) / 60000) : null);
const step = (id, status, ms, facts = {}) => ({ id, status, ms, facts });

const signedInStep = (subjectToken) => {
  const c = safeClaims(subjectToken);
  return step(1, 'pass', 0, { sub: c.sub, client_id: c.client_id, aud: c.aud, scope: scopeFacts(c.scope), expiresInMin: minutesLeft(c.exp), sha: sha(subjectToken) });
};

const actorStep = (actorToken, cfg, ms) => {
  const c = safeClaims(actorToken);
  return step(2, 'pass', ms, { client_id: cfg.agent.id, scope: cfg.actorScope, expiresInMin: minutesLeft(c.exp), sha: sha(actorToken) });
};

const exchangeStep = (cfg, subjectToken, actorToken, ms) => step(3, 'pass', ms, {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
  audience: cfg.audience, scope: cfg.scope, exchanger: cfg.exchanger.id,
  subjectSha: sha(subjectToken), actorSha: sha(actorToken),
});

// PingOne's reason, with any token-looking text withheld.
const failureStep = (id, ms, err, secrets = []) => {
  const text = String(err.pingoneErrorDescription || err.message || '');
  return step(id, 'fail', ms, {
    error: err.pingoneError || err.code || 'unknown',
    description: hasTokenLeak(text, secrets) ? 'withheld (contained a token)' : text,
    httpStatus: err.httpStatus,
  });
};

const skipFrom = (id) => Array.from({ length: LAST_STEP - id + 1 }, (_, i) => step(id + i, 'skip', 0));

// Steps 4-7, from the finished evidence and the two downstream calls.
function resultSteps(evidence, accepted, refused) {
  const byId = Object.fromEntries(evidence.checks.map((c) => [c.id, c.pass]));
  const claimsOk = byId['sub-preserved'] && byId['act-object'] && byId['aud-differs'];
  return [
    step(4, claimsOk ? 'pass' : 'fail', 0, {
      subSame: !!byId['sub-preserved'],
      inbound: { aud: evidence.inbound.aud, scope: scopeFacts(evidence.inbound.scope), sha: evidence.inbound.sha },
      delegated: { aud: evidence.delegated.aud, scope: evidence.delegated.scope, sub: evidence.delegated.sub, act: evidence.delegated.act, expiresInMin: minutesLeft(evidence.delegated.exp), sha: evidence.delegated.sha },
    }),
    step(5, accepted.status === 200 ? 'pass' : 'fail', accepted.ms, { status: accepted.status }),
    step(6, refused.status === 401 ? 'pass' : 'fail', refused.ms, { status: refused.status }),
    step(7, evidence.leak ? 'fail' : 'pass', 0, { leak: !!evidence.leak }),
  ];
}

module.exports = { signedInStep, actorStep, exchangeStep, failureStep, skipFrom, resultSteps };
