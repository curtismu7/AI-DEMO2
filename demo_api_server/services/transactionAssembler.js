'use strict';
/**
 * Assemble the full chain of custody for one transaction.
 *
 * Emitted hops come from the ledger. token.exchange hops are DERIVED at read
 * time from tokenChainService rather than emitted, because the code that
 * performs RFC 8693 exchanges lives in REGRESSION_PLAN §1 protected files.
 * Derived hops are labelled source:'derived' so the UI and the reconciler can
 * tell a read-time reconstruction from a first-hand record.
 */
const ledger = require('./lmdb/transactionLedger.lmdb');
const tokenChainService = require('./tokenChainService');

/**
 * demo_api_server/data/token-chains/*.json are jest fixtures, not production
 * output: they use `type` (not `eventType`), a numeric epoch timestamp, and
 * `scope`. reloadFromDisk() validates only Array.isArray, so they load into the
 * in-memory map on boot. The `type` key is the reliable fixture marker.
 */
function _isFixtureRecord(evt) {
  return evt && typeof evt === 'object' && 'type' in evt;
}

function _actArray(tokenAct) {
  if (!tokenAct) return [];
  if (Array.isArray(tokenAct)) return tokenAct.map((a) => a?.client_id || a?.sub || String(a));
  return [tokenAct.client_id || tokenAct.sub || String(tokenAct)];
}

function _toDerivedHop(evt) {
  return {
    ts: evt.timestamp,
    service: 'demo-api-server',
    phase: 'token.exchange',
    op: evt.eventType,
    identity: {
      sub: evt.tokenSub || null,
      act: _actArray(evt.tokenAct),
      aud: evt.audience || null,
      scopes: Array.isArray(evt.scopes) ? evt.scopes : [],
      tokenType: evt.tokenType || null,
      jti: evt.id || null,
      exp: evt.expiry || null,
    },
    decision: { outcome: 'n/a', by: 'gateway', reason: null },
    status: 'ok',
    source: 'derived',
  };
}

async function _derivedTokenHops(correlationId, principal) {
  // No attributable principal on this record (no hop ever carried an
  // identity.sub) — do NOT fall back to the unscoped, all-users
  // getTokenChain() call. That fallback is the confidentiality leak this
  // scoping closes: it could surface a different principal's sub/act/scopes.
  if (!principal) return [];
  try {
    const events = await tokenChainService.getTokenChain(principal);
    return (Array.isArray(events) ? events : [])
      .filter((e) => !_isFixtureRecord(e))
      .filter((e) => e && e.correlationId === correlationId)
      .filter((e) => e.eventType === 'exchange' || e.eventType === 'refresh')
      .map(_toDerivedHop);
  } catch (err) {
    // A token-chain read failure must not blank the whole trace — the emitted
    // hops are still a valid, if narrower, chain.
    // eslint-disable-next-line no-console
    console.warn('[transactionAssembler] token chain read failed:', err?.message);
    return [];
  }
}

/**
 * @param {string} correlationId
 * @returns {Promise<object|null>} { correlationId, startedAt, endedAt, hops }
 */
async function assemble(correlationId) {
  const record = ledger.getRecord(correlationId);
  if (!record) return null;

  const principal = record.principal || null;
  const emitted = (record.hops || []).map((h) => ({ ...h, source: h.source || 'emit' }));
  const derived = await _derivedTokenHops(correlationId, principal);

  const hops = [...emitted, ...derived]
    .sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 : 0))
    .map((h, i) => ({ ...h, seq: i + 1 }));

  return {
    correlationId: record.correlationId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    principal,
    hops,
  };
}

module.exports = { assemble };
