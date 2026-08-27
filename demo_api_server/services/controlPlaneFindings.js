'use strict';

/**
 * controlPlaneFindings — what is actually wrong, computed from the assembled
 * control-plane context.
 *
 * Every rule is a pure function of its argument. No I/O, no module state, and
 * no clock read: `now` arrives in the context, which is the only reason the two
 * time-based rules can be tested deterministically.
 *
 * Rules return an array because one rule may produce many findings (one per
 * offending identity) or exactly one summarising many rows.
 */

const WINDOW_DAYS = 30;
const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(now, iso) {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

/**
 * An identity revoked more than once recently. Windowed on purpose: history is
 * immutable, so an all-time rule could never clear — it would sit in the queue
 * forever and train the reader to ignore the queue. The signal is "repeatedly,
 * recently".
 */
function repeatRevocation({ now, events }) {
  const cutoff = now.getTime() - WINDOW_DAYS * DAY_MS;
  const byAgent = new Map();
  for (const ev of events || []) {
    if (ev.eventType !== 'leaver' || !ev.agentId) continue;
    if (new Date(ev.timestamp).getTime() < cutoff) continue;
    if (!byAgent.has(ev.agentId)) byAgent.set(ev.agentId, []);
    byAgent.get(ev.agentId).push(ev);
  }
  const out = [];
  for (const [agentId, list] of byAgent) {
    if (list.length < 2) continue;
    const stamps = list.map((e) => e.timestamp).sort();
    out.push({
      id: `repeat-revocation:${agentId}`,
      rule: 'repeat-revocation',
      severity: 'critical',
      domain: 'governance',
      title: `${agentId} was revoked ${list.length} times in the last ${WINDOW_DAYS} days`,
      detail: 'A repeat revocation is the strongest governance signal this environment produces. '
        + 'Check whether it is currently active.',
      evidence: { agentId, count: list.length, first: stamps[0], last: stamps[stamps.length - 1] },
    });
  }
  return out;
}

/**
 * Rows whose scope expectation is empty, so drift was never evaluated.
 * One finding summarising the set — the reader acts on the group, not on each.
 */
function unverifiedScopes({ rows }) {
  const affected = (rows || []).filter((r) => r.scopeStatus === 'unverified');
  if (affected.length === 0) return [];
  return [{
    id: 'unverified-scopes',
    rule: 'unverified-scopes',
    severity: 'advisory',
    domain: 'registry',
    title: `${affected.length} identities have no scope expectation to check against`,
    detail: 'These rows were never compared, which is not the same as being clean. '
      + 'A real drift here would look identical until the identity is declared in scope-topology.',
    evidence: { count: affected.length, ids: affected.slice(0, 20).map((r) => r.id) },
  }];
}

/**
 * The ledger has gone quiet. An EMPTY ledger is deliberately not stale — never
 * recorded is a different condition from went quiet, and treating them alike
 * would fire on a fresh install forever.
 */
function staleLedger({ now, events }) {
  if (!events || events.length === 0) return [];
  const newest = events.reduce((a, e) => (a && a > e.timestamp ? a : e.timestamp), null);
  const days = daysBetween(now, newest);
  if (days < STALE_DAYS) return [];
  return [{
    id: 'stale-ledger',
    rule: 'stale-ledger',
    severity: 'advisory',
    domain: 'governance',
    title: `Lifecycle ledger has recorded nothing for ${days} days`,
    detail: 'Only the kill switch and the control-plane roster write to the ledger, '
      + 'so ordinary provisioning leaves no trace.',
    evidence: { days, newest },
  }];
}

/**
 * A source we asked that failed. Explicitly NOT fired by `not-wired` or
 * `structural`: a stub is not an outage, and collapsing those states would
 * light this rule up permanently.
 */
function sourceDown({ sources }) {
  return Object.entries(sources || {})
    .filter(([, s]) => s && s.state === 'down')
    .map(([name, s]) => ({
      id: `source-down:${name}`,
      rule: 'source-down',
      severity: 'critical',
      domain: 'registry',
      title: `Source "${name}" is not answering`,
      detail: s.error || 'No reason reported.',
      evidence: { source: name, error: s.error || null },
    }));
}

const RULES = [repeatRevocation, unverifiedScopes, staleLedger, sourceDown];

/**
 * Facts about how the deployment is configured, not live signals — a rule
 * evaluating these would return the same answer forever. Declared, counted
 * separately from "needs attention", because nothing the reader does today
 * can action them.
 */
const DECLARED = [
  {
    id: 'discovery-has-no-source',
    rule: 'declared',
    severity: 'structural',
    domain: 'discovery',
    title: 'Discovery has no source, and will not get one here',
    detail: 'Browsers, endpoints and workloads are unmonitored. This is a CASB/EDR capability '
      + 'rather than an IAM one, so it stays listed and stays empty.',
    evidence: { surfaces: 0, of: 3 },
  },
  {
    id: 'no-alert-receiver',
    rule: 'declared',
    severity: 'structural',
    domain: 'observability',
    title: 'Alert rules evaluate but route nowhere',
    detail: 'Prometheus rules are live with no Alertmanager, so nothing here can be raised to '
      + 'someone who is not already looking at it.',
    evidence: { receiver: null },
  },
];

/** @param {{now: Date, rows: object[], events: object[], sources: object}} context */
function evaluate(context) {
  return RULES.flatMap((rule) => rule(context) || []);
}

module.exports = { evaluate, DECLARED, WINDOW_DAYS, STALE_DAYS };
