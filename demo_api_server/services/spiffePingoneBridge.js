'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const configStoreDefault = require('./configStore');
const spiffeTrustDomainDefault = require('./spiffeTrustDomain');

const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

function readMap(configStore) {
  const raw = configStore.getEffective('spiffe_pingone_client_map');
  if (!raw) throw new Error('SPIFFE bridge: no SPIFFE-to-PingOne client map configured');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('SPIFFE bridge: client map must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('SPIFFE bridge: client map must be an object');
  return parsed;
}

function buildClientAssertion({ svid, audience, expectedClientId, configStore = configStoreDefault, verifier = spiffeTrustDomainDefault } = {}) {
  if (!svid) throw new Error('SPIFFE bridge: SVID is required');
  if (!audience) throw new Error('SPIFFE bridge: PingOne token endpoint is required');
  const verification = verifier.verifySvid(svid);
  if (!verification.valid) throw new Error(`SPIFFE bridge: SVID rejected (${verification.reason})`);
  const clientId = readMap(configStore)[verification.claims.sub];
  if (!clientId) throw new Error(`SPIFFE bridge: no PingOne client is mapped for ${verification.claims.sub}`);
  if (expectedClientId && expectedClientId !== clientId) throw new Error('SPIFFE bridge: mapped client does not match requested client');
  const privateKey = (configStore.getEffective('spiffe_bridge_private_key') || '').trim();
  if (!privateKey) throw new Error('SPIFFE bridge: bridge private key is not configured');
  const kid = (configStore.getEffective('spiffe_bridge_kid') || '').trim() || undefined;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (kid) header.kid = kid;
  return {
    clientId,
    spiffeId: verification.claims.sub,
    assertionType: CLIENT_ASSERTION_TYPE,
    assertion: jwt.sign({ iss: clientId, sub: clientId, aud: audience, jti: crypto.randomUUID(), iat: now, exp: now + 60 }, privateKey, { algorithm: 'RS256', header }),
  };
}

function getPublicJwk(configStore = configStoreDefault) {
  const pem = (configStore.getEffective('spiffe_bridge_private_key') || '').trim();
  if (!pem) return null;
  const jwk = crypto.createPublicKey(pem).export({ format: 'jwk' });
  const kid = (configStore.getEffective('spiffe_bridge_kid') || '').trim();
  return { ...jwk, use: 'sig', alg: 'RS256', ...(kid ? { kid } : {}) };
}

module.exports = { CLIENT_ASSERTION_TYPE, buildClientAssertion, getPublicJwk, readMap };
