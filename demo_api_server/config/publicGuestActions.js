'use strict';

/**
 * Public catalog actions a signed-out visitor may run. UC24 ("What branches are
 * near me?") is the documented progressive-trust entry point: no Authorize, no
 * Gateway, no token exchange. Keep this list minimal — anything absent is
 * refused, which is what makes the gate in POST /api/agent/run fail closed.
 *
 * Lives here rather than inside routes/agentRun.js so `npm run verify:usecase-auth`
 * can read it without loading the route (which opens LMDB stores on require).
 * routes/agentRun.js is still the only enforcement point.
 */
const PUBLIC_GUEST_ACTIONS = new Set(['branch_hours']);

module.exports = { PUBLIC_GUEST_ACTIONS };
