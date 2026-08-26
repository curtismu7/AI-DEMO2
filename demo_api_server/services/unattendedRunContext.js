'use strict';
/**
 * unattendedRunContext.js — the stand-in for `req` when nobody made a request.
 *
 * Every token service in the BFF takes an Express request as its first argument
 * and uses it for one thing: req.recordTokenEvent(). Both call sites in
 * agentCCTokenService optional-chain it, so passing null works — and silently
 * produces a run with no token events, which is a run with no trace. This gives
 * a scheduled job the same two members the request carried, and nothing else.
 *
 * It is deliberately NOT a fake session. There is no user, no cookies, no
 * agentContext: an unattended run has nobody to delegate from, and code that
 * reaches for those should fail loudly here rather than quietly act as somebody.
 */

/** Token-event ids the Token Chain rail already knows how to render. */
const AGENT_TOKEN_EVENT_ID = 'agent-actor-token';

/**
 * @param {object} opts
 *   - agent {string} the agent identity this run authenticates as
 * @returns {{
 *   tokenEvents: Array,
 *   recordTokenEvent: function,
 *   recordAgentToken: function,
 * }}
 */
function createUnattendedContext({ agent } = {}) {
  const tokenEvents = [];

  const ctx = {
    tokenEvents,

    // Same shape agentSessionMiddleware attaches, so the token services cannot
    // tell the difference.
    recordTokenEvent(type, data) {
      tokenEvents.push({ type, timestamp: new Date().toISOString(), ...data });
    },

    /**
     * Add the rail-shaped event for the agent's own token.
     *
     * The claims here are what make the run classify correctly downstream:
     * `sub` is the agent, and there is deliberately no `act` claim and no
     * user-token event, because nobody delegated this. deriveAgentClass() in
     * the UI reads exactly that and renders "Autonomous".
     */
    recordAgentToken(token) {
      const claims = (token && token.claims) || {};
      tokenEvents.push({
        id: AGENT_TOKEN_EVENT_ID,
        label: 'Agent Token (unattended)',
        timestamp: new Date().toISOString(),
        claims: {
          sub: claims.sub || agent || null,
          aud: claims.aud || null,
          scope: claims.scope || (token && token.scope) || null,
          iss: claims.iss || null,
        },
      });
    },
  };

  return ctx;
}

module.exports = { createUnattendedContext, AGENT_TOKEN_EVENT_ID };
