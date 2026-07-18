'use strict';
/**
 * Identity invariants over one assembled transaction record.
 *
 * PURE — no I/O, no requires beyond this file. Every check is a
 * (hops) => Violation[] function so the whole engine is testable from fixtures
 * with nothing running. Task 12 appends INV-5..INV-8 to CHECKS.
 *
 * Severity:
 *   'error'      — the invariant was evaluated and violated  → FAIL
 *   'incomplete' — the record lacks the evidence to evaluate → INCOMPLETE
 * Absence of evidence is reported as absence, never as a violation.
 */

const DECISION_PHASES = new Set(['authz.decision', 'gateway.authorize']);

function _v(id, severity, hopSeq, detail) {
  return { id, severity, hopSeq, detail };
}

function _audList(aud) {
  if (!aud) return [];
  return Array.isArray(aud) ? aud.filter(Boolean).map(String) : [String(aud)];
}

/** INV-1 — once delegation starts, every exchanged token carries an act chain. */
function inv1ActorChain(hops) {
  const out = [];
  for (const h of hops) {
    if (h.identity?.tokenType !== 'exchanged_token') continue;
    const act = h.identity?.act;
    if (!Array.isArray(act) || act.length === 0) {
      out.push(_v('INV-1', 'error', h.seq,
        `${h.service} presented an exchanged token with no act (delegation) claim`));
    }
  }
  return out;
}

/** INV-2 — one transaction, one subject. A change mid-flight is a confused deputy. */
function inv2SubjectStability(hops) {
  const subs = [...new Set(hops.map((h) => h.identity?.sub).filter(Boolean).map(String))];
  if (subs.length <= 1) return [];
  const offender = hops.find((h) => h.identity?.sub && String(h.identity.sub) !== subs[0]);
  return [_v('INV-2', 'error', offender ? offender.seq : null,
    `transaction spans more than one subject: ${subs.join(', ')}`)];
}

/**
 * Trim surrounding whitespace off each scope and drop entries that are
 * empty after trimming. Deliberately does NOT lowercase — OAuth scope
 * tokens are case-sensitive (RFC 6749 §3.3), so `banking:Read` and
 * `banking:read` remain distinct scopes.
 */
function _normalizeScopes(scopes) {
  return scopes.map((s) => String(s).trim()).filter((s) => s.length > 0);
}

/** INV-3 — RFC 8693 downscoping is monotonic; a later hop must not gain scope. */
function inv3NoScopeEscalation(hops) {
  const out = [];
  let prev = null;
  for (const h of hops) {
    const rawScopes = h.identity?.scopes;
    if (!Array.isArray(rawScopes) || rawScopes.length === 0) continue;
    const scopes = _normalizeScopes(rawScopes);
    if (scopes.length === 0) continue;
    if (prev) {
      const gained = scopes.filter((s) => !prev.scopes.includes(s));
      if (gained.length) {
        out.push(_v('INV-3', 'error', h.seq,
          `${h.service} gained scope not held at ${prev.service}: ${gained.join(', ')}`));
      }
    }
    prev = { scopes, service: h.service };
  }
  return out;
}

/**
 * INV-4 — every audience presented must have been minted by an earlier
 * token.exchange hop in THIS transaction. Self-contained on purpose: an
 * external service→audience table would drift out of date and start lying.
 */
function inv4AudienceMinted(hops) {
  const exchanges = hops.filter((h) => h.phase === 'token.exchange');
  if (exchanges.length === 0) return []; // no evidence — INV-5 covers missing hops
  const out = [];
  const minted = new Set();
  for (const h of hops) {
    if (h.phase === 'token.exchange') {
      for (const a of _audList(h.identity?.aud)) minted.add(a);
      continue;
    }
    const presented = _audList(h.identity?.aud);
    if (presented.length === 0) continue;
    // Deliberate "any" quantifier: an array-valued aud passes if ANY entry
    // was minted here. This is weaker than "all" — a hop could smuggle an
    // unminted audience alongside a legitimate one and this check would not
    // catch it. Brief-mandated; do not change to "all" without a spec update.
    if (!presented.some((a) => minted.has(a))) {
      out.push(_v('INV-4', 'error', h.seq,
        `${h.service} presented audience "${presented.join(', ')}" which was never minted in this transaction`));
    }
  }
  return out;
}

/** Fields HITL binds a consent receipt to. Mirrors demo_mcp_gateway/src/hitlClient.ts. */
const CONSENT_BOUND_KEYS = [
  'to_account_id', 'from_account_id', 'account_id', 'toAccountId', 'fromAccountId',
];

function _normAmount(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function _normField(v) {
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

/**
 * INV-5 — no tool executes without a prior authorization decision.
 *
 * Two distinct outcomes: no decision hop anywhere means the evidence is
 * missing (incomplete); decisions that exist but all land AFTER the tool call
 * is a real ordering violation (error).
 */
function inv5DecisionCoverage(hops) {
  const decisions = hops.filter((h) => DECISION_PHASES.has(h.phase));
  const out = [];
  for (const tool of hops.filter((h) => h.phase === 'mcp.tool')) {
    const preceding = decisions.filter((d) => (d.seq || 0) < (tool.seq || 0));
    if (preceding.length > 0) continue;
    out.push(decisions.length === 0
      ? _v('INV-5', 'incomplete', tool.seq,
        `no authorization decision recorded anywhere for "${tool.op}" — cannot evaluate coverage`)
      : _v('INV-5', 'error', tool.seq,
        `"${tool.op}" executed before any authorization decision in this transaction`));
  }
  return out;
}

/** INV-6 — a denied operation must not then run. */
function inv6DenyHonored(hops) {
  const out = [];
  for (const tool of hops.filter((h) => h.phase === 'mcp.tool')) {
    const blocking = hops.find((d) =>
      DECISION_PHASES.has(d.phase) &&
      (d.seq || 0) < (tool.seq || 0) &&
      d.decision?.outcome === 'deny' &&
      // A deny with no op recorded is unattributable, so it blocks everything
      // after it. Treating it as "not my tool" would be a free pass.
      (!d.op || d.op === tool.op));
    if (blocking) {
      out.push(_v('INV-6', 'error', tool.seq,
        `"${tool.op}" executed after a deny at hop ${blocking.seq} (${blocking.decision.reason || 'no reason recorded'})`));
    }
  }
  return out;
}

/**
 * INV-7 — a consented operation must execute with the consented parameters.
 *
 * Mirrors verifyHitlReceipt in demo_mcp_gateway/src/hitlClient.ts: the intent
 * token carries permitted_tools and prompt_hash but NO parameters, so the HITL
 * challenge context is the only parameter-level binding that exists.
 */
function inv7ConsentBinding(hops) {
  const out = [];
  for (const tool of hops.filter((h) => h.phase === 'mcp.tool')) {
    const consents = hops.filter((c) =>
      c.phase === 'hitl.consent' && c.op === tool.op && (c.seq || 0) < (tool.seq || 0));

    if (consents.length === 0) {
      if (tool.consentRequired === true) {
        out.push(_v('INV-7', 'error', tool.seq,
          `"${tool.op}" requires consent but no consent was recorded before it`));
      }
      continue;
    }

    const consent = consents[consents.length - 1];
    if (consent.decision?.outcome !== 'permit') {
      out.push(_v('INV-7', 'error', tool.seq,
        `"${tool.op}" executed after consent was ${consent.decision?.outcome || 'not granted'}`));
      continue;
    }

    const consented = consent.params || {};
    const executed = tool.params || {};

    const cAmt = _normAmount(consented.amount);
    const eAmt = _normAmount(executed.amount);
    if ((cAmt !== null || eAmt !== null) && cAmt !== eAmt) {
      out.push(_v('INV-7', 'error', tool.seq,
        `"${tool.op}" consented amount ${cAmt} but executed amount ${eAmt}`));
      continue;
    }

    for (const key of CONSENT_BOUND_KEYS) {
      const cVal = _normField(consented[key]);
      const eVal = _normField(executed[key]);
      if (cVal === null && eVal === null) continue;
      if (cVal !== eVal) {
        out.push(_v('INV-7', 'error', tool.seq,
          `"${tool.op}" consented ${key}=${cVal} but executed ${key}=${eVal}`));
        break;
      }
    }
  }
  return out;
}

/** INV-8 — hops advance in time, and no hop uses a token past its expiry. */
function inv8TemporalSanity(hops) {
  const out = [];
  let prev = null;
  for (const h of hops) {
    const t = Date.parse(h.ts);
    if (Number.isFinite(t)) {
      if (prev && t < prev.t) {
        out.push(_v('INV-8', 'error', h.seq,
          `hop ${h.seq} is out of order — timestamp precedes hop ${prev.seq}`));
      }
      const exp = Date.parse(h.identity?.exp);
      if (Number.isFinite(exp) && t > exp) {
        out.push(_v('INV-8', 'error', h.seq,
          `${h.service} used a token that expired at ${h.identity.exp}`));
      }
      prev = { t, seq: h.seq };
    }
  }
  return out;
}

const CHECKS = [
  inv1ActorChain,
  inv2SubjectStability,
  inv3NoScopeEscalation,
  inv4AudienceMinted,
  inv5DecisionCoverage,
  inv6DenyHonored,
  inv7ConsentBinding,
  inv8TemporalSanity,
];

/**
 * @param {object} record  assembled transaction ({ correlationId, hops })
 * @returns {{status: 'PASS'|'FAIL'|'INCOMPLETE', violations: object[]}}
 */
function evaluate(record) {
  const hops = [...((record && record.hops) || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const violations = CHECKS.flatMap((check) => check(hops));
  const status = violations.some((v) => v.severity === 'error')
    ? 'FAIL'
    : violations.some((v) => v.severity === 'incomplete')
      ? 'INCOMPLETE'
      : 'PASS';
  return { status, violations };
}

module.exports = {
  evaluate,
  inv1ActorChain,
  inv2SubjectStability,
  inv3NoScopeEscalation,
  inv4AudienceMinted,
  inv5DecisionCoverage,
  inv6DenyHonored,
  inv7ConsentBinding,
  inv8TemporalSanity,
  CONSENT_BOUND_KEYS,
  DECISION_PHASES,
  CHECKS,
};
