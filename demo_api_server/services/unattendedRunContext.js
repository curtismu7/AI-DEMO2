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
     * there is deliberately no `act` claim and no user-token event, because
     * nobody delegated this. deriveAgentClass() reads exactly that and renders
     * "Autonomous".
     *
     * `sub` shows ONLY what is really in the token, falling back to the OAuth
     * client that obtained it — never to the agent's display name. A PingOne
     * client_credentials token often carries no `sub` at all, and substituting
     * a friendly name there made the rail display an identity the token did not
     * contain: the trace asserting "Fraud Watch Agent acted" while the token
     * had been issued to a shared client. On a demo whose whole claim is that
     * the token proves who acted, that is the one direction it must not fail.
     *
     * @param {object} token   result of getAgentCCToken (carries claims + clientId)
     * @param {object} opts    ownIdentity: false when the agent had to borrow a
     *                         shared client because its own is unprovisioned
     */
    recordAgentToken(token, { ownIdentity = true } = {}) {
      const claims = (token && token.claims) || {};
      const actingClientId = (token && token.clientId) || null;
      tokenEvents.push({
        id: AGENT_TOKEN_EVENT_ID,
        label: `Agent Token (unattended) — ${agent || 'agent'}`,
        timestamp: new Date().toISOString(),
        // Surfaced alongside the claims, never inside them: this is what the
        // demo INTENDED, and the claims are what actually happened.
        declaredAgent: agent || null,
        ownIdentity,
        claims: {
          sub: claims.sub || actingClientId || null,
          aud: claims.aud || null,
          scope: claims.scope || (token && token.scope) || null,
          iss: claims.iss || null,
          client_id: actingClientId,
        },
      });
    },
  };

  return ctx;
}

module.exports = { createUnattendedContext, AGENT_TOKEN_EVENT_ID };
