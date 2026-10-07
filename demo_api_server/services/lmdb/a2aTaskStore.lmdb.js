'use strict';

const crypto = require('node:crypto');
const { getDb } = require('./openEnv');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled', 'rejected']);
const TOKEN_KEYS = /token|secret|authorization|password|clientsecret|privatekey/i;

function isTerminalState(state) {
  return TERMINAL_STATES.has(String(state || '').toLowerCase());
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !TOKEN_KEYS.test(key))
    .map(([key, child]) => [key, scrub(child)]));
}

function keyFor(taskId) {
  return `task:${taskId}`;
}

function createA2aTaskStore({ db = getDb('a2aTasks'), now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  function visible(record) {
    return record ? scrub({ ...record }) : null;
  }

  function owned(record, owner) {
    return record && owner && record.tenantId === owner.tenantId && record.userSub === owner.userSub;
  }

  function ownerFromContext(context) {
    return {
      tenantId: context?.tenantId || context?.user?.tenantId || null,
      userSub: context?.userSub || context?.user?.userName || null,
    };
  }

  return {
    createTask(input = {}) {
      const createdAt = input.createdAt || now();
      const taskId = input.taskId || crypto.randomUUID();
      const task = scrub({
        taskId,
        contextId: input.contextId || crypto.randomUUID(),
        tenantId: input.tenantId,
        userSub: input.userSub,
        vertical: input.vertical || null,
        specialist: input.specialist || null,
        state: input.state || 'working',
        message: input.message || null,
        artifacts: input.artifacts || [],
        createdAt,
        updatedAt: input.updatedAt || createdAt,
        expiresAt: input.expiresAt || createdAt + ttlMs,
      });
      db.put(keyFor(taskId), task);
      return visible(task);
    },

    getTask(taskId, owner) {
      const task = db.get(keyFor(taskId));
      return owned(task, owner) ? visible(task) : null;
    },

    listContext(contextId, owner) {
      const rows = [];
      for (const { value } of db.getRange({ start: 'task:', end: 'task;' })) {
        if (value?.contextId === contextId && owned(value, owner)) rows.push(visible(value));
      }
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },

    updateTask(taskId, patch = {}, owner) {
      const current = db.get(keyFor(taskId));
      if (!owned(current, owner)) return null;
      const safePatch = scrub(patch);
      const nextState = safePatch.state || current.state;
      if (isTerminalState(current.state)) return visible(current);
      const next = scrub({ ...current, ...safePatch, taskId, tenantId: current.tenantId, userSub: current.userSub, updatedAt: now(), state: nextState });
      db.put(keyFor(taskId), next);
      return visible(next);
    },

    expireTasks(timestamp = now()) {
      let expired = 0;
      for (const { key, value } of db.getRange({ start: 'task:', end: 'task;' })) {
        if (value?.expiresAt <= timestamp) {
          db.remove(key);
          expired += 1;
        }
      }
      return expired;
    },

    // @a2a-js/sdk TaskStore adapter. The SDK calls these methods with the
    // authenticated user context; tenant/user ownership is checked before a
    // task crosses the protocol boundary.
    async load(taskId, context) {
      const record = db.get(keyFor(taskId));
      return owned(record, ownerFromContext(context)) ? scrub(record.payload) : undefined;
    },

    async save(task, context) {
      const owner = ownerFromContext(context);
      if (!owner.tenantId || !owner.userSub) return;
      const current = db.get(keyFor(task.id));
      if (current && !owned(current, owner)) return;
      if (current && isTerminalState(current.payload?.status?.state)) return;
      const timestamp = now();
      // Awaited: lmdb commits a put asynchronously, and the SDK saves then
      // immediately loads the same task, which would otherwise read nothing.
      await db.put(keyFor(task.id), {
        taskId: task.id,
        tenantId: owner.tenantId,
        userSub: owner.userSub,
        contextId: task.contextId || null,
        state: task.status?.state || 'working',
        createdAt: current?.createdAt || timestamp,
        updatedAt: timestamp,
        expiresAt: current?.expiresAt || timestamp + ttlMs,
        payload: scrub(task),
      });
    },

    async list(params = {}, context) {
      const owner = ownerFromContext(context);
      const tasks = [];
      for (const { value } of db.getRange({ start: 'task:', end: 'task;' })) {
        if (!owned(value, owner)) continue;
        const task = scrub(value.payload);
        if (params.contextId && task.contextId !== params.contextId) continue;
        if (params.status && task.status?.state !== params.status) continue;
        tasks.push(task);
      }
      tasks.sort((a, b) => String(b.status?.timestamp || '').localeCompare(String(a.status?.timestamp || '')));
      return { tasks: tasks.slice(0, params.pageSize || 50), nextPageToken: '', pageSize: params.pageSize || 50, totalSize: tasks.length };
    },
  };
}

module.exports = { DEFAULT_TTL_MS, isTerminalState, createA2aTaskStore };
