'use strict';

/**
 * DPoP key + proof service (RFC 9449) — zero external deps, Node built-in crypto only.
 *
 * The BFF acts as the DPoP-proofing client on behalf of the agent: it mints a
 * per-session ephemeral P-256 keypair, binds the delegated MCP token to that key
 * (cnf.jkt), and signs a fresh DPoP proof JWT for each hop. This makes a stolen
 * bearer useless to anyone who does not also hold the private key.
 *
 * Simulated mode (PingOne SaaS): the JWT itself is not re-signed, so the key
 * thumbprint (jkt) is carried to the gateway/MCP via the trusted TraT envelope.
 * Native mode (PingOne AIC / PingFederate): cnf.jkt is issued in the token claims.
 * The proof crypto below is identical in both modes — only where jkt lives differs.
 *
 * The explicit JWS construction is intentional: it doubles as a teaching artifact
 * for the demo (you can read exactly how a DPoP proof is built and verified).
 */

const crypto = require('node:crypto');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * RFC 7638 JWK thumbprint (SHA-256, base64url) over the canonical member set.
 * For EC keys the required members in lexicographic order are: crv, kty, x, y.
 */
function jwkThumbprint(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Generate an ephemeral P-256 keypair. The private key is exported as PKCS#8 PEM
 * so it survives express-session serialization (KeyObjects are not serializable).
 * Returns { privatePem, publicJwk, jkt }.
 */
function generateDpopKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicJwk,
    jkt: jwkThumbprint(publicJwk),
  };
}

/**
 * RFC 9449 §6 access-token hash: base64url(SHA-256(access_token)). Bound into the
 * proof as `ath` so a proof cannot be replayed with a different access token.
 */
function accessTokenHash(accessToken) {
  return crypto.createHash('sha256').update(accessToken).digest('base64url');
}

/**
 * Sign a DPoP proof JWT (RFC 9449 §4.2) for a single hop.
 * @param {object} p
 * @param {string} p.privatePem  PKCS#8 PEM private key from generateDpopKeypair()
 * @param {object} p.publicJwk   the matching public JWK (embedded in the header)
 * @param {string} p.htu         target URI (no query/fragment), e.g. gateway tool URL
 * @param {string} [p.htm]       HTTP method, default POST
 * @param {string} [p.ath]       access-token hash (accessTokenHash), optional
 * @returns {string} compact JWS
 */
function signDpopProof({ privatePem, publicJwk, htu, htm = 'POST', ath }) {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
  };
  const payload = {
    htu,
    htm: String(htm).toUpperCase(),
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    ...(ath ? { ath } : {}),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // ES256 must be raw R||S (JOSE), not DER — dsaEncoding 'ieee-p1363' gives that.
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: crypto.createPrivateKey(privatePem),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${b64url(sig)}`;
}

// ---------------------------------------------------------------------------
// Per-session key store — in this process, keyed by session id, NOT on the session
// ---------------------------------------------------------------------------
//
// Held under req.session.dpopKey, minting this key MUTATED the session, so
// express-session wrote that request's whole start-of-request copy back when the
// request ended. The first token exchange of a session therefore undid anything
// saved while it ran — a mode change made during that exchange was reverted
// (reproduced live 2026-09-12 with a session whose first exchange was the
// spanning request). Same last-write-wins class as /api/agent/run and the
// agent-token cache before it; see REGRESSION_PLAN §4.
//
// The key must stay STABLE for a session: the delegated MCP token is bound to it
// (cnf.jkt), so a second key would sign proofs the gateway cannot match to the
// token it issued. Entries are swept after KEY_TTL_MS of disuse, which bounds the
// map against guest-session churn now that session.destroy() no longer drops it.
// In-process: the same single-BFF-process assumption mcpFlowSseHub,
// agentRunContext and agentTokenCache make — a restart mints a fresh key, which
// is what "ephemeral per session" already meant.
//
// ponytail: TTL sweep only, no size cap — an unused entry costs a keypair for
// KEY_TTL_MS; add a cap if session churn ever makes that matter.

/** @type {Map<string, {key: object, at: number}>} sessionId -> keypair + last use */
const _sessionKeys = new Map();

/** Generous next to any token lifetime the key is bound to (cnf.jkt). */
const KEY_TTL_MS = 12 * 60 * 60 * 1000;

const _sessionIdOf = (session) =>
  (session && typeof session.id === 'string' && session.id) || null;

function _sweepSessionKeys(now) {
  for (const [sid, entry] of _sessionKeys) {
    if (now - entry.at >= KEY_TTL_MS) _sessionKeys.delete(sid);
  }
}

/**
 * Get-or-create the per-session ephemeral DPoP keypair. Returns null when there
 * is no session, or none with an id to key it by (the caller then skips DPoP —
 * it is best-effort plumbing).
 */
function getSessionDpopKey(req) {
  const sessionId = _sessionIdOf(req && req.session);
  if (!sessionId) return null;
  const now = Date.now();
  _sweepSessionKeys(now);
  let entry = _sessionKeys.get(sessionId);
  if (!entry || !entry.key || !entry.key.jkt) {
    entry = { key: generateDpopKeypair(), at: now };
    _sessionKeys.set(sessionId, entry);
  } else {
    entry.at = now; // in use — keep it past the sweep
  }
  return entry.key;
}

/**
 * The session's existing DPoP keypair, or null — never mints one. The tool
 * pipeline signs a per-hop proof only when the token exchange already minted a
 * key ("never create one here"), so its read path must not create.
 */
function peekSessionDpopKey(session) {
  const sessionId = _sessionIdOf(session);
  if (!sessionId) return null;
  const entry = _sessionKeys.get(sessionId);
  return entry ? entry.key : null;
}

/** Drop a session's DPoP key (logout). */
function clearSessionDpopKey(session) {
  const sessionId = _sessionIdOf(session);
  if (sessionId) _sessionKeys.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Web Bot Auth (RFC 9421 HTTP Message Signatures, draft-meunier profile)
// ---------------------------------------------------------------------------
//
// Unlike the per-session DPoP key, the Web Bot Auth key is the AGENT's stable
// identity key: its public half is published as a JWKS at
// /.well-known/http-message-signatures-directory (served by this BFF) and
// referenced from outbound requests via the Signature-Agent header. One
// Ed25519 keypair per process; the directory and the signer share it.

let _wbaKey = null;

/**
 * Get-or-create the process-wide Ed25519 Web Bot Auth keypair.
 * Returns { privatePem, publicJwk, keyid } — keyid is the RFC 7638 JWK
 * thumbprint (canonical members crv,kty,x for OKP), as required by the
 * web-bot-auth profile. Note jwkThumbprint() handles OKP too: JSON.stringify
 * drops the undefined `y` member, leaving exactly {crv,kty,x}.
 */
function getWebBotAuthKey() {
  if (!_wbaKey) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicJwk = publicKey.export({ format: 'jwk' }); // { kty:'OKP', crv:'Ed25519', x }
    _wbaKey = {
      privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
      publicJwk,
      keyid: jwkThumbprint(publicJwk),
    };
  }
  return _wbaKey;
}

/**
 * Sign a Web Bot Auth request (RFC 9421, tag="web-bot-auth").
 * Covered components per the profile: `@authority` and `signature-agent`.
 * Params: created, expires, keyid (RFC 7638 thumbprint), nonce, tag.
 *
 * @param {object} p
 * @param {string} p.authority       host[:port] of the target URI (e.g. new URL(url).host)
 * @param {string} p.signatureAgent  the agent's key-directory origin (this BFF's base URL)
 * @param {string} [p.label]         signature label (default 'sig1')
 * @param {number} [p.lifetimeSecs]  created→expires window (default 300)
 * @returns {{ 'Signature-Agent': string, 'Signature-Input': string, 'Signature': string }}
 */
function signWebBotAuthHeaders({ authority, signatureAgent, label = 'sig1', lifetimeSecs = 300 }) {
  const key = getWebBotAuthKey();
  const created = Math.floor(Date.now() / 1000);
  const expires = created + lifetimeSecs;
  const nonce = crypto.randomBytes(32).toString('base64'); // base64 is sf-string-safe
  const agentValue = `"${signatureAgent}"`; // sf-string, as sent on the wire
  const params =
    `("@authority" "signature-agent");created=${created};expires=${expires}` +
    `;keyid="${key.keyid}";nonce="${nonce}";tag="web-bot-auth"`;
  // RFC 9421 §2.5 signature base: covered components in order, then the
  // @signature-params line carrying the exact Signature-Input member value.
  const base =
    `"@authority": ${String(authority).toLowerCase()}\n` +
    `"signature-agent": ${agentValue}\n` +
    `"@signature-params": ${params}`;
  // Ed25519 signs the raw base (no prehash) — crypto.sign(null, ...).
  const sig = crypto.sign(null, Buffer.from(base, 'utf-8'), crypto.createPrivateKey(key.privatePem));
  return {
    'Signature-Agent': agentValue,
    'Signature-Input': `${label}=${params}`,
    'Signature': `${label}=:${sig.toString('base64')}:`,
  };
}

module.exports = {
  jwkThumbprint,
  generateDpopKeypair,
  accessTokenHash,
  signDpopProof,
  getSessionDpopKey,
  peekSessionDpopKey,
  clearSessionDpopKey,
  getWebBotAuthKey,
  signWebBotAuthHeaders,
};
