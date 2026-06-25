'use strict';

const { EventEmitter } = require('events');
const { createClient } = require('redis');
const { resolveRedisWireUrl } = require('./redisWireUrl');

/**
 * FallbackStore — in-process, uses a Map for state and EventEmitter for pub/sub.
 * Used when AGUI_STORE_FALLBACK === 'true' or Redis init fails.
 */
class FallbackStore {
  constructor() {
    this._state = new Map();
    this._emitter = new EventEmitter();
  }

  async setRunState(runId, value) {
    this._state.set(runId, value);
  }

  async getRunState(runId) {
    return this._state.get(runId) || null;
  }

  async deleteRunState(runId) {
    this._state.delete(runId);
  }

  async publishConsent(runId, payload) {
    this._emitter.emit(`consent:${runId}`, payload);
  }

  async subscribeConsent(runId, handler) {
    const channel = `consent:${runId}`;
    this._emitter.on(channel, handler);
    // Return unsubscribe function
    return () => {
      this._emitter.off(channel, handler);
    };
  }
}

/**
 * RedisStore — uses node-redis v5 for cloud-safe storage and pub/sub.
 */
class RedisStore {
  constructor(redisUrl) {
    this._redisUrl = redisUrl;
    this._pub = null;
    this._sub = null;
    this._subscriptions = new Map();
    this._ready = this._init();
  }

  async _init() {
    try {
      this._pub = createClient({ url: this._redisUrl });
      await this._pub.connect();

      // Create separate client for subscriptions
      this._sub = this._pub.duplicate();
      await this._sub.connect();
    } catch (error) {
      console.error('[agentRunStore] Redis connection failed:', error.message);
      throw error;
    }
  }

  async setRunState(runId, value) {
    await this._ready;
    const key = `agui:run:${runId}`;
    const ttlSeconds = 300; // 5 minutes
    await this._pub.set(key, JSON.stringify(value), { EX: ttlSeconds });
  }

  async getRunState(runId) {
    await this._ready;
    const key = `agui:run:${runId}`;
    const raw = await this._pub.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async deleteRunState(runId) {
    await this._ready;
    const key = `agui:run:${runId}`;
    await this._pub.del(key);
  }

  async publishConsent(runId, payload) {
    await this._ready;
    const channel = `agui:consent:${runId}`;
    const message = JSON.stringify(payload);
    await this._pub.publish(channel, message);
  }

  async subscribeConsent(runId, handler) {
    await this._ready;
    const channel = `agui:consent:${runId}`;
    const subClient = this._sub;

    // Capture wrapper so we can pass it to unsubscribe — without this, unsubscribe(channel)
    // would drop ALL listeners for the channel, breaking concurrent runs on the same channel.
    const listener = (message) => {
      try {
        const payload = JSON.parse(message);
        handler(payload);
      } catch {
        // Ignore parse errors
      }
    };

    // Subscribe to the channel (node-redis v5 callback signature: (message, channel))
    await subClient.subscribe(channel, listener);

    // Store subscription info for cleanup
    if (!this._subscriptions.has(runId)) {
      this._subscriptions.set(runId, []);
    }
    this._subscriptions.get(runId).push({ channel, handler });

    // Return unsubscribe function — pass the specific listener so only this subscription is removed
    return async () => {
      await subClient.unsubscribe(channel, listener);
      const subs = this._subscriptions.get(runId);
      if (subs) {
        const idx = subs.findIndex((s) => s.channel === channel && s.handler === handler);
        if (idx >= 0) subs.splice(idx, 1);
      }
    };
  }
}

/**
 * Factory: create and return a store instance based on environment.
 */
function createAgentRunStore() {
  // 1. Check fallback flag
  if (process.env.AGUI_STORE_FALLBACK === 'true') {
    return new FallbackStore();
  }

  // 2. Try to resolve Redis URL
  const { url } = resolveRedisWireUrl(process.env);
  if (!url) {
    console.warn(
      '[agentRunStore] No Redis URL — using in-process fallback. HITL will not work across instances.'
    );
    return new FallbackStore();
  }

  // 3. Build async-init RedisStore (connects lazily)
  return new RedisStore(url);
}

// Create singleton instance
const agentRunStore = createAgentRunStore();

module.exports = { agentRunStore, createAgentRunStore };
