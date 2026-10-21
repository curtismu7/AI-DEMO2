import { openMcpFlowSse } from '../services/mcpFlowSseClient';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

/**
 * A live, traced agent run: gives the request an id, listens to that id's live event stream, and completes the trace.
 *
 * POST /api/agent/invoke publishes each step it takes (intent check, agent token, token exchange, gateway
 * introspection, PingOne Authorize, the tool server, the tool result) to a stream keyed by `flowTraceId`. A chat
 * that sends no id gets only the final list of token events in the reply: the movie reel then stops at whatever
 * step was last seen ("Authorize in flight") because nothing ever completes the trace, and the gateway, authorize
 * and tool-result steps never appear. The Studio's workload run (PersonalAgentStudioPage executeWorkload) does all of
 * this inline; this is the same sequence as one call any chat can use.
 *
 *   const run = startFlowTracedRun(prompt, { setTokenEvents });
 *   fetch('/api/agent/invoke', { body: JSON.stringify({ prompt, flowTraceId: run.flowTraceId, ... }) })
 *     .then((data) => { run.ingestResponse(data); run.settle(data.success !== false, data.reply); })
 *     .catch((e) => run.settle(false, e.message));
 *   // held for MFA/approval and about to retry? run.abandon()
 *
 * Every trace-store call is display-only and wrapped: a failure in the reel must never break the chat.
 */
const STREAM_LINGER_MS = 3000; // the stream lags the HTTP reply slightly: keep it open briefly so the tool result still lands

const newFlowTraceId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

const quiet = (fn) => { try { return fn(); } catch (_e) { return undefined; } };

/**
 * @param {string} prompt the user's message (shown on the reel)
 * @param {{ setTokenEvents?: (tool: string|null, events: object[]) => void }} [opts] the token-chain context's setter
 * @returns {{ flowTraceId: string, ingestResponse: (data: object|null) => void, settle: (ok: boolean, failure?: string|null) => void, abandon: () => void }}
 */
export function startFlowTracedRun(prompt, { setTokenEvents } = {}) {
  const flowTraceId = newFlowTraceId();
  let finished = false;

  quiet(() => tokenChainTraceStore.beginTrace({ prompt, flowTraceId }));
  quiet(() => setTokenEvents?.(null, []));

  const closeSse = openMcpFlowSse(flowTraceId, (event) => {
    if (event?.type === 'token-event') {
      const { type, ...tokenEvent } = event;
      quiet(() => tokenChainTraceStore.ingestTokenEvent({ ...tokenEvent, flowTraceId }));
    }
    if (event?.type === 'mcp-result') {
      quiet(() => window.dispatchEvent(new CustomEvent('mcp-tool-result-sse', { detail: { ...event, flowTraceId } })));
    }
  });

  return {
    flowTraceId,
    ingestResponse(data) {
      if (!data || typeof data !== 'object') return;
      if (Array.isArray(data.tokenEvents)) quiet(() => setTokenEvents?.(data.toolsCalled?.[0] || null, data.tokenEvents));
      if (data.mcpAuthorizeEvaluation) quiet(() => tokenChainTraceStore.ingestAuthorize(data.mcpAuthorizeEvaluation, flowTraceId));
      if (data.mcpAuthorizeEvaluations) quiet(() => tokenChainTraceStore.ingestAuthorizeEvaluations(data.mcpAuthorizeEvaluations));
    },
    settle(ok, failure = null) {
      if (finished) return;
      finished = true;
      quiet(() => tokenChainTraceStore.completeTrace(ok, flowTraceId, failure));
      setTimeout(closeSse, STREAM_LINGER_MS);
    },
    abandon() {
      if (finished) return;
      finished = true;
      closeSse();
    },
  };
}
