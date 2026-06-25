/**
 * requestEventEmitter.js — Per-request event tracking
 *
 * Provides a request-scoped event collector for tracking key checkpoints
 * during agent request processing. Events are structured and collected
 * for inclusion in API responses.
 */

const crypto = require('crypto');

/**
 * RequestEventEmitter - Collects events for a single request
 */
class RequestEventEmitter {
  constructor() {
    this.events = [];
    this.requestId = crypto.randomUUID();
  }

  /**
   * Emit an event at a checkpoint
   * @param {string} type - Event type: 'user_request'|'agent_thinking'|'tool_call'|'token_exchange'|'result'|'error'
   * @param {string} plainEnglish - User-friendly explanation
   * @param {object} technicalDetails - Technical details with optional rfc/section/details
   * @param {string} severity - 'info'|'warning'|'error'
   */
  emit(type, plainEnglish, technicalDetails = {}, severity = 'info') {
    const event = {
      type,
      plainEnglish,
      technicalDetails: {
        details: technicalDetails.details || '',
        ...(technicalDetails.rfc && { rfc: technicalDetails.rfc }),
        ...(technicalDetails.section && { section: technicalDetails.section }),
      },
      severity,
      requestId: this.requestId,
      timestamp: new Date().toISOString(),
    };

    this.events.push(event);
    return event;
  }

  /**
   * Get all collected events
   * @returns {array} Array of event objects
   */
  getAllEvents() {
    return this.events;
  }

  /**
   * Clear all events
   */
  clear() {
    this.events = [];
  }

  /**
   * Get event count
   */
  count() {
    return this.events.length;
  }
}

/**
 * Middleware to attach requestEventEmitter to each request
 */
function requestEventEmitterMiddleware(req, res, next) {
  req.eventEmitter = new RequestEventEmitter();
  next();
}

module.exports = {
  RequestEventEmitter,
  requestEventEmitterMiddleware,
};
