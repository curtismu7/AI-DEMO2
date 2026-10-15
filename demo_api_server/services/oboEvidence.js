'use strict';
const crypto = require('crypto');

const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]*/;

const sha = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
const claims = (token) => JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));

function hasTokenLeak(value, secrets = []) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return JWT_RE.test(text) || secrets.some((s) => s && text.includes(s));
}

const sameAud = (a, b) => JSON.stringify([].concat(a || []).sort()) === JSON.stringify([].concat(b || []).sort());

function buildEvidence({ source, subjectToken, delegatedToken, actorClientId, downstream }) {
  const inC = claims(subjectToken);
  const dC = claims(delegatedToken);
  const evidence = {
    ts: new Date().toISOString(),
    source,
    sub: inC.sub,
    inbound: { aud: inC.aud, scope: inC.scope, client_id: inC.client_id, sha: sha(subjectToken) },
    delegated: { aud: dC.aud, scope: dC.scope, sub: dC.sub, act: dC.act, exp: dC.exp, sha: sha(delegatedToken) },
    downstream,
  };
  const leak = hasTokenLeak(evidence, [subjectToken, delegatedToken]);
  const act = dC.act;
  const checks = [
    { id: 'sub-preserved', label: 'Delegated token is for the same user (sub preserved)', pass: dC.sub === inC.sub },
    { id: 'act-object', label: 'Delegated token carries an act object naming the agent (delegation, not impersonation)',
      pass: !!act && typeof act === 'object' && act.client_id === actorClientId },
    { id: 'different-token', label: 'Delegated token is a different token from the user token',
      pass: evidence.delegated.sha !== evidence.inbound.sha },
    { id: 'aud-differs', label: 'Delegated token audience differs from the one the client held', pass: !sameAud(dC.aud, inC.aud) },
    { id: 'downstream-accepts-delegated', label: 'Downstream accepted the delegated token', pass: downstream.delegated === 200 },
    { id: 'downstream-refuses-user', label: 'Downstream refused the user token (the agent could not have used it)', pass: downstream.userToken === 401 },
    { id: 'no-token-leak', label: 'Nothing returned to the model or the live event contained a token', pass: !leak },
  ];
  return { ...evidence, checks, leak };
}

module.exports = { sha, claims, hasTokenLeak, buildEvidence };
