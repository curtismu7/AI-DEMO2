'use strict';

/**
 * In-memory HITL challenge store.
 *
 * Keyed by challengeId (UUID). Each entry:
 *   { id, tool, userId, agentId, context, status, createdAt, expiresAt, resolvedAt, decision }
 *
 * Status lifecycle:  pending → approved | denied | expired
 *
 * For production: swap _store for Redis or a DB — interface stays the same.
 */

const { v4: uuidv4 } = require('uuid');

const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CHALLENGES = 1000;

const _store = new Map();

function _pruneExpired() {
  const now = Date.now();
  for (const [id, ch] of _store.entries()) {
    if (ch.expiresAt < now && ch.status === 'pending') {
      ch.status = 'expired';
      ch.resolvedAt = now;
    }
    // Clean out resolved/expired entries older than 1 hour
    if (ch.status !== 'pending' && (now - ch.createdAt) > 3_600_000) {
      _store.delete(id);
    }
  }
}

function create({ tool, userId, agentId, context }) {
  _pruneExpired();
  if (_store.size >= MAX_CHALLENGES) {
    throw new Error('Challenge store at capacity');
  }
  const id = uuidv4();
  const now = Date.now();
  const challenge = {
    id,
    tool,
    userId: userId || null,
    agentId: agentId || null,
    context: context || {},
    status: 'pending',
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    resolvedAt: null,
    decision: null,
  };
  _store.set(id, challenge);
  return { ...challenge };
}

function get(id) {
  _pruneExpired();
  const ch = _store.get(id);
  if (!ch) return null;
  return { ...ch };
}

function resolve(id, decision) {
  const ch = _store.get(id);
  if (!ch) return null;
  if (ch.status !== 'pending') {
    throw new Error(`Challenge ${id} is not pending (status: ${ch.status})`);
  }
  if (ch.expiresAt < Date.now()) {
    ch.status = 'expired';
    ch.resolvedAt = Date.now();
    throw new Error(`Challenge ${id} is expired`);
  }
  if (decision !== 'approved' && decision !== 'denied') {
    throw new Error(`Invalid decision: ${decision} — must be 'approved' or 'denied'`);
  }
  ch.status = decision;
  ch.resolvedAt = Date.now();
  ch.decision = decision;
  return { ...ch };
}

function list({ userId, status, limit = 20 } = {}) {
  _pruneExpired();
  let entries = [..._store.values()];
  if (userId) entries = entries.filter((c) => c.userId === userId);
  if (status) entries = entries.filter((c) => c.status === status);
  return entries
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((c) => ({ ...c }));
}

module.exports = { create, get, resolve, list };
