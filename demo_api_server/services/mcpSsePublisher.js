// demo_api_server/services/mcpSsePublisher.js
'use strict';

const mcpFlowSseHub = require('./mcpFlowSseHub');
const { buildSsePayload } = require('./sseCorrelation');

/**
 * Publish an MCP tool result to the SSE hub so the Token Chain MCP Results
 * tab updates in real-time without waiting for the 15-second poll cycle.
 * Shape matches the mcpToolCallsChain entries from getMCPToolCalls().
 *
 * @param {string} flowTraceId
 * @param {object} opts
 * @param {string}  opts.tool
 * @param {object}  opts.result     raw MCP result (content[], isError, _meta)
 * @param {number}  opts.durationMs
 * @param {boolean} opts.isDelegated
 * @param {object}  [opts.requestJson]  original tool params (pre-HITL-strip snapshot)
 * @param {object}  [opts.mcpAuthorizeEvaluation] singular authorize decision, when the
 *   gate ran on this call — same shape callMcpTool's response body already carries.
 * @param {object[]} [opts.mcpAuthorizeEvaluations] ordered [gate, secondary] pair, only
 *   present when a Transaction/Amount policy decision also fired (PR #1070).
 */
function publishMcpResultToSse(flowTraceId, {
  tool, result, durationMs, isDelegated, requestJson, denied,
  mcpAuthorizeEvaluation, mcpAuthorizeEvaluations,
}) {
  if (!flowTraceId) return;
  const success = !denied && result && !result.isError && !result.error;
  const toolResultJson = result?.content
    ? result.content.slice(0, 10)          // cap size for SSE payload
    : result != null ? result : null;
  mcpFlowSseHub.publish(flowTraceId, buildSsePayload('mcp-result', {
    toolName: tool,
    tool,
    status: success ? 'success' : 'failure',
    duration: durationMs ?? 0,
    isDelegated: !!isDelegated,
    denied: !!denied,
    resultSummary: success ? `${tool} completed` : `${tool} failed`,
    resultJson: toolResultJson,
    result: toolResultJson,
    requestJson: requestJson ?? null,
    timestamp: new Date().toISOString(),
    ...(mcpAuthorizeEvaluation ? { mcpAuthorizeEvaluation } : {}),
    ...(mcpAuthorizeEvaluations ? { mcpAuthorizeEvaluations } : {}),
  }));
}

module.exports = { publishMcpResultToSse };
