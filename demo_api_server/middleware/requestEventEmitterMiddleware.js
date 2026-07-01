/**
 * requestEventEmitterMiddleware.js
 *
 * Express middleware that attaches a fresh RequestEventEmitter to each request
 * as `req.eventEmitter`. The implementation lives in services/requestEventEmitter.js
 * (alongside the RequestEventEmitter class); the agent route modules import it from
 * this ../middleware/ path, so expose it here as the module's default export.
 */
const { requestEventEmitterMiddleware } = require('../services/requestEventEmitter');

module.exports = requestEventEmitterMiddleware;
