// banking_api_server/services/mcpToolAuditStore.js
/**
 * In-memory audit store for local (in-process) MCP tool calls.
 * Populated by agentBuilder.js toolNode; read by tokenChainService.getMCPToolCalls().
 * Matches the event shape expected by getMCPToolCalls().
 *
 * IN-05 — KNOWN LIMITATION (not a bug): this is a 200-event ring buffer in
 * process memory ONLY. It survives exactly the current Node process and is
 * lost on every restart (on Vercel, every cold start). It is a live-debug /
 * Token Chain feed, NOT a durable compliance audit trail. For durable audit
 * see mcpTrafficLogger (NDJSON to .logs/). Building persistence here is
 * intentionally out of scope — do not add a DB/file here without a product
 * requirement for a real audit trail.
 */

const MAX_EVENTS = 200;
const _events = [];

let _chainIndex = 0;

/**
 * Record a tool call event.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.toolName
 * @param {boolean} opts.success
 * @param {number} opts.duration  ms
 * @param {any} [opts.resultJson]
 * @param {any} [opts.requestJson]  tool request arguments
 * @param {string} [opts.summary]
 * @param {object} [opts.userToken]  decoded token payload (sub, scope)
 * @param {boolean} [opts.isDelegated]
 * @param {string|null} [opts.decisionId]  authorize decision id for PERMIT calls (demo-track stamp)
 */
function recordToolCall({ userId, toolName, success, duration, resultJson, requestJson, summary, userToken, isDelegated, decisionId }) {
	const eventId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
	const event = {
		eventId,
		timestamp: new Date().toISOString(),
		userId,
		details: {
			toolName,
			chainIndex: _chainIndex++,
			request: requestJson ?? null,
			exchangedToken: isDelegated ? {} : null,
			userToken: userToken
				? { sub: userToken.sub || userId, scope: userToken.scope || [] }
				: { sub: userId, scope: [] },
			result: {
				success,
				duration,
				resultJson: resultJson ?? null,
				summary: summary || (success ? `${toolName} completed` : `${toolName} failed`),
			},
		},
	};
	_events.unshift(event);
	// Guided Demo Track — best-effort observation; must never affect the audit.
	try {
		// On a failure, surface the tool's own error code so the track can explain
		// the "why" (the pipeline's authorize blocks carry richer codes via
		// observeDecision; this covers tool-level failures the pipeline permitted).
		const errorCode = !success && resultJson && typeof resultJson === 'object'
			? (resultJson.error || resultJson.code || null)
			: null;
		require('./demoTrackService').observeToolCall({ toolName, success, timestamp: event.timestamp, decisionId: decisionId || null, errorCode });
	} catch { /* track observation is optional */ }
	if (_events.length > MAX_EVENTS) _events.length = MAX_EVENTS;
}

/**
 * Return all events, optionally filtered by userId.
 * @param {string} [userId]
 * @returns {object[]}
 */
function getToolCalls(userId) {
	if (!userId) return _events.slice();
	return _events.filter(
		(e) => e.userId === userId || e.details?.userToken?.sub === userId,
	);
}

function clearToolCalls() {
	_events.length = 0;
	_chainIndex = 0;
}

module.exports = { recordToolCall, getToolCalls, clearToolCalls };
