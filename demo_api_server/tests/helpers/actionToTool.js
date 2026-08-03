'use strict';

/**
 * Heuristic ACTION -> dispatched TOOL.
 *
 * This file is a RE-EXPORT, not a copy. The map lives in
 * services/stepVerificationExpectations.js, which is production code and needs the
 * same resolution at runtime.
 *
 * It used to be two independent objects joined only by a "keep in sync" comment,
 * and they had already drifted: the service copy was missing `wire_transfer` and
 * `sensitive_account_details`, so normalizeParsedIntent() returned the ACTION name
 * where callers expected a tool name. Nothing could detect that, because each copy
 * was internally consistent. One object cannot drift from itself.
 *
 * Consumers: useCases.primaryTool.test.js (toolForAction) and
 * genIntentTopology.test.js (ACTION_TO_TOOL).
 */
const { ACTION_TO_TOOL, toolForAction } = require('../../services/stepVerificationExpectations');

module.exports = { ACTION_TO_TOOL, toolForAction };
