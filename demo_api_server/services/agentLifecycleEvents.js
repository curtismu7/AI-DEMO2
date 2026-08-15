'use strict';
/**
 * agentLifecycleEvents.js — SailPoint-style joiner/mover/leaver hub.
 *
 * Thin fan-out so the 4 call sites (demo-agent stop, demo-roster reset,
 * live-agent kill, live-agent re-enable) don't each duplicate store+forward
 * boilerplate. Deliberately does NOT touch appEventService — that hub stays
 * the UI activity-log/SSE feed; this is a separate, IGA-shaped export
 * concern for GET /api/control-plane/lifecycle-events and the optional
 * SailPoint webhook.
 */
const store = require('./lmdb/agentLifecycleEventStore.lmdb');
const forwarder = require('./sailpointForwarder');

const COMPLIANCE_TAGS = {
  joiner: ['NHI-Provisioning'],
  mover: ['NHI-Reactivation'],
  leaver: ['TRiSM', 'AI-Safety'],
};

/**
 * Record a joiner/mover/leaver event and forward it (fire-and-forget).
 * @param {object} params
 * @param {'joiner'|'mover'|'leaver'} params.eventType
 * @param {string} params.agentId
 * @param {string} [params.agentLabel]
 * @param {string|null} [params.source]
 * @param {'demo'|'live'} [params.kind]
 * @param {string|null} [params.reason]
 * @param {{userId:string, username:string}|null} [params.actor]
 * @param {string|null} [params.auditId]
 * @param {object} [params.metadata]
 * @returns {object} the stored event
 */
function emit({ eventType, agentId, agentLabel, source, kind, reason, actor, auditId, metadata }) {
  const stored = store.append({
    eventType,
    agentId,
    agentLabel: agentLabel || agentId,
    source: source || null,
    kind: kind || null,
    reason: reason || null,
    actor: actor || null,
    auditId: auditId || null,
    complianceTags: COMPLIANCE_TAGS[eventType] || [],
    metadata: metadata || {},
  });
  forwarder.forward(stored).catch(() => { /* forward is fire-and-forget */ });
  return stored;
}

module.exports = { emit, query: store.query, summary: store.summary };
