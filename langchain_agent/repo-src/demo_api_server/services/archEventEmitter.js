'use strict';

/**
 * Singleton EventEmitter for architecture diagram live trace events.
 *
 * Usage in any route handler:
 *   const archEmit = require('../services/archEventEmitter');
 *   archEmit({ nodeId: 'n-bff', edgeId: 'e-browser-bff', label: 'OAuth callback received' });
 *
 * The SSE route (routes/archEvents.js) subscribes to 'arch-node' events
 * and streams them to connected browser clients.
 *
 * If no clients are connected, emit() is a no-op (the EventEmitter just has no listeners).
 */

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(50); // up to 50 concurrent SSE clients

/**
 * Emit an arch event. Silently no-ops if there are no SSE subscribers.
 * @param {object} payload
 * @param {string}  payload.nodeId   - e.g. 'n-bff'
 * @param {string} [payload.edgeId]  - e.g. 'e-browser-bff' (optional)
 * @param {string} [payload.label]   - human-readable description (optional)
 */
function archEmit({ nodeId, edgeId, label } = {}) {
  if (!nodeId) return;
  emitter.emit('arch-node', { nodeId, edgeId, label });
}

archEmit.emitter = emitter; // expose raw emitter for the SSE route to subscribe
module.exports = archEmit;
