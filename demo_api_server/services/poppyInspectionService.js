'use strict';

/**
 * Poppy protocol inspector (Company side) — the in-memory record of what the
 * Company received from Personal Agents and what it made of each request.
 * Mirrors the Cliffside protocol-inspector demo: a newest-first per-agent feed
 * with the verification narrative, and raw Received / Sent payloads.
 *
 * Nothing here is durable state: the feed is bounded, per-process, and holds
 * no credentials. Tokens are never stored — only short fingerprints — and
 * request bodies are capped.
 */

const crypto = require('node:crypto');

const MAX_ENTRIES = 200;
const MAX_TEXT = 8 * 1024;

const fingerprint = (value) =>
  (typeof value === 'string' && value.length > 12
    ? `${value.slice(0, 6)}…${crypto.createHash('sha256').update(value).digest('hex').slice(0, 8)}`
    : value == null ? null : '(short)');

const clip = (value) => {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…(truncated)` : text;
};

/**
 * The human-readable verification narrative for one request, in the order the
 * Company actually checked things. `outcome` comes from the Poppy API router:
 * either a verified session ({ ok, sub, sid, agentId, clientId, signedOut }) or
 * a refusal ({ ok: false, reason }).
 */
function narrate({ method, path, outcome, tokenClientId, scopes }) {
  const steps = [];
  if (!outcome.ok) {
    steps.push(`1. Refused: ${outcome.reason}.`);
    steps.push('2. Nothing about this request was accepted; the response is invalid_session (spec 4.1).');
    return steps;
  }
  const { clientId, agentId, sid, sub, signedOut } = outcome;
  steps.push(`1. Legit: the Poppy-Session delegation was signed by a key published at the agent's jwks_uri (client_id ${clientId}).`);
  steps.push('2. The Session JWT itself verified with the delegated key named in the delegation (kid = key thumbprint).');
  steps.push(`3. The Session names this method (${method}) and URL (${path}), and the audience is this Company's issuer.`);
  steps.push(`4. The one-time jti was unused, and Session ${sid} stayed bound to the User, agent and client it first named.`);
  if (signedOut) {
    steps.push('5. No access token was sent, so this is a signed-out Session: the Company sees the agent, no User data (spec 5.3).');
  } else {
    steps.push(`5. The bearer token verified against the issuer's JWKS, its client_id matches the Session iss, and its ath hash matches the token on this request.`);
    steps.push(`6. Scopes granted: ${(scopes || []).join(', ') || '(none)'}.`);
    steps.push(`7. The person the agent acts for: ${sub}.`);
  }
  if (agentId) steps.push(`8. The agent identified itself as ${agentId}.`);
  return steps;
}

function createPoppyInspectionService({ maxEntries = MAX_ENTRIES } = {}) {
  const entries = []; // newest last; the feed reverses for display

  return {
    /** Record one Poppy API call. Never throws; inspection must not break the API. */
    record(entry) {
      try {
        const at = entry.at ?? new Date().toISOString();
        const method = String(entry.method || 'GET').toUpperCase();
        const outcome = entry.outcome || { ok: false, reason: 'unknown' };
        const record = {
          id: `ins_${crypto.randomBytes(8).toString('hex')}`,
          at,
          method,
          path: String(entry.path || '/').slice(0, 300),
          status: entry.status ?? (outcome.ok ? 200 : 400),
          agentId: outcome.agentId ?? null,
          clientId: outcome.clientId ?? null,
          userId: outcome.ok && !outcome.signedOut ? outcome.sub ?? null : null,
          signedOut: Boolean(outcome.signedOut),
          sessionId: outcome.sid ?? null,
          reasoning: narrate({ method, path: entry.path, outcome, scopes: entry.scopes }),
          received: {
            method,
            url: entry.path ?? '/',
            poppy_session: entry.sessionJwt ? fingerprint(entry.sessionJwt) : null,
            authorization: entry.accessToken ? `Bearer ${fingerprint(entry.accessToken)}` : null,
            headers: clip(entry.receivedHeaders) ?? undefined,
            body: clip(entry.receivedBody) ?? undefined,
          },
          sent: {
            status: entry.status ?? (outcome.ok ? 200 : 400),
            body: clip(entry.sentBody) ?? undefined,
          },
        };
        entries.push(record);
        while (entries.length > maxEntries) entries.shift();
        return record.id;
      } catch {
        return null;
      }
    },

    /** Newest-first feed, optionally for one agent (client_id URL). */
    feed({ agent } = {}) {
      const list = entries.filter((e) => !agent || e.clientId === agent);
      return list.slice().reverse();
    },

    /** One entry by id, for the expandable detail view. */
    get(id) {
      return entries.find((e) => e.id === id) ?? null;
    },

    /** Distinct agents seen, for the picker. */
    agents() {
      return [...new Set(entries.map((e) => e.clientId).filter(Boolean))];
    },

    clear() {
      entries.length = 0;
    },

    size() {
      return entries.length;
    },
  };
}

// One process-wide instance: the Poppy API router records into it, the admin
// feed reads from it. Bounded memory, per-process, resets on restart.
const shared = createPoppyInspectionService();

module.exports = {
  createPoppyInspectionService,
  narrate,
  shared,
  MAX_ENTRIES,
};
