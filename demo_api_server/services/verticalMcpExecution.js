// demo_api_server/services/verticalMcpExecution.js
/**
 * Always-on MCP execution for vertical plugin action tools (all verticals + admin overlay).
 * No ff_vertical_tools_via_mcp bypass — the demo path is RFC 8693 → gateway → MCP → vertical-tool.
 */
'use strict';

const configStore = require('./configStore');
const verticalDispatch = require('./verticalDispatch');
const { executeBffTool } = require('./bffMcpToolExecutor');
const { classifyMcpToolResult } = require('./mcpToolOutcome');

/**
 * Parse executeBffTool JSON/string into { result, render } for dispatchVerticalIntent.
 */
function parseMcpToolPayload(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    parsed = null;
  }
  // Shared classifier so vertical + banking agent paths never drift on which
  // HITL/step-up code shapes they recognise (mcp_-prefixed gate vs bare gateway).
  const c = classifyMcpToolResult(parsed);
  if (c.kind === 'hitl' || c.kind === 'step_up') {
    return {
      kind: 'hitl',
      hitlEnvelope: {
        ...parsed,
        error: c.error,
        hitl: c.hitl,
        hitlChallengeId: c.hitlChallengeId,
        message: c.message,
        step_up_method: c.step_up_method,
        step_up_acr: c.step_up_acr,
      },
    };
  }
  if (c.kind === 'error') {
    // c.message is the human-readable reason (error_description / deny_reason)
    // so a deny renders as a sentence rather than a bare code.
    return { kind: 'out', out: { result: { error: c.message }, render: 'text' } };
  }
  return {
    kind: 'out',
    out: {
      result: parsed?.data ?? parsed ?? {},
      render: parsed?.render || 'text',
    },
  };
}

/**
 * Run a plugin tool through the full MCP pipeline (always).
 * @returns {Promise<{ out?: { result: object, render: string }, hitlEnvelope?: object }>}
 */
async function executePluginToolViaMcp({ name, args, userId, userToken, req, tokenEvents, sessionId, hitlChallengeId = null }) {
  if (req) req.agentPath = 'mcp_vertical';
  // On a HITL-approval retry, echo the approved challenge id back to the gateway
  // as the reserved `_hitl_challenge_id` tool arg. The gateway verifies the
  // receipt and PERMITs; it strips the field before forwarding to the backend.
  const toolArgs = hitlChallengeId
    ? { ...(args || {}), _hitl_challenge_id: hitlChallengeId }
    : (args || {});
  let raw;
  try {
    raw = await executeBffTool({
      name,
      args: toolArgs,
      userId,
      userToken,
      req,
      tokenEvents,
      sessionId,
    });
  } catch (err) {
    // Session/token expiry must propagate for 401 + need_auth on the route.
    if (err && (err.code === 'TOKEN_INACTIVE' || err.login_required)) throw err;
    const msg = (err && err.message) || 'MCP tool execution failed';
    return { out: { result: { error: msg }, render: 'text' } };
  }
  const parsed = parseMcpToolPayload(raw);
  if (parsed.kind === 'hitl') return { hitlEnvelope: parsed.hitlEnvelope };
  return { out: parsed.out };
}

/**
 * BFF-local authz gate for write tools when PingAuthorize is simulated (dev default).
 * Gateway owns authz when live PingOne Authorize is active.
 */
function shouldRunLocalAuthzGate() {
  const p1azLive = configStore.getEffective('ff_authorize_simulated') !== 'true';
  return !p1azLive;
}

/**
 * Optional step-up / consent gate before MCP execute (simulated-AS configs only).
 */
function checkLocalAuthzGate(vertical, action, isAdmin, consentGiven = false) {
  if (!shouldRunLocalAuthzGate()) return null;
  const authz = (verticalDispatch.authzFor(vertical, { isAdmin }, () => ({}))[action]) || {};
  const hitlEnabled = configStore.getEffective('ff_hitl_enabled') !== 'false';
  if (hitlEnabled && authz.stepUp && !consentGiven) {
    return {
      error: 'hitl_required',
      hitl: { type: 'consent' },
      reply: 'This action requires identity verification and your approval.',
      success: false,
      action,
      requiresConsent: true,
      requiresStepUp: true,
    };
  }
  if (hitlEnabled && authz.consent && !consentGiven) {
    return {
      error: 'hitl_required',
      hitl: { type: 'consent' },
      reply: 'This action requires your approval.',
      success: false,
      action,
      requiresConsent: true,
    };
  }
  return null;
}

module.exports = {
  executePluginToolViaMcp,
  parseMcpToolPayload,
  checkLocalAuthzGate,
  shouldRunLocalAuthzGate,
};
