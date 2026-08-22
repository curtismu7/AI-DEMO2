/**
 * useAgentRun.js
 *
 * AG-UI Step 3 — React hook for POST /api/agent/run SSE stream.
 *
 * AG-UI uses HTTP POST + text/event-stream, which EventSource does not support.
 * This hook uses fetch() + ReadableStream to parse the SSE protocol manually.
 *
 * Returns:
 *   { run, abort, isRunning, error }
 *
 * run({ threadId, runId, messages, resume? }): starts a new run.
 *   Calls onEvent(event) for each parsed AG-UI event.
 *   Calls onStateSnapshot(snapshot) when STATE_SNAPSHOT is received.
 *   Calls onStateDelta(delta) for each STATE_DELTA (caller applies JSON Patch).
 *   Calls onFinished(outcome) when RUN_FINISHED is received.
 *   Calls onError(message) when RUN_ERROR or a network error occurs.
 *
 * abort(): cancels the current in-flight run.
 */

import { useRef, useState, useCallback } from 'react';
import { openMcpFlowSse } from '../services/mcpFlowSseClient';
import { agentFlowDiagram } from '../services/agentFlowDiagramService';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

const ENDPOINT = '/api/agent/run';

/**
 * Parse a raw SSE chunk into an array of AG-UI event objects.
 * SSE format: each event is "data: {JSON}\n\n"
 * The ReadableStream may deliver multiple events per chunk or split mid-event.
 */
function parseSseChunk(buffer, newChunk) {
  const combined = buffer + newChunk;
  const events = [];
  // Events are separated by double newlines
  const parts = combined.split('\n\n');
  // The last part may be an incomplete event — carry it forward
  const remaining = parts.pop() || '';
  for (const part of parts) {
    const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
    if (!dataLine) continue;
    const raw = dataLine.slice(6); // strip "data: "
    try {
      events.push(JSON.parse(raw));
    } catch (_) {
      // Malformed chunk — skip
    }
  }
  return { events, remaining };
}

/**
 * Apply JSON Patch (RFC 6902) operations to a state object.
 * Supports: add, replace, remove (the subset AG-UI STATE_DELTA uses) at
 * arbitrary path depth. Walks `parts` to the leaf's parent container — cloning
 * each node along the way so shared state is never mutated — then applies the
 * leaf op. Depth-3+ ops (e.g. /authorizeDecisions/0/decision) and array-index
 * inserts (e.g. add /tokenEvents/2) are handled, not just length 1/2.
 */
// A path segment addresses an array when it is the append token or numeric.
function isArrayIndexSegment(seg) {
  return seg === '-' || (/^\d+$/).test(seg);
}

export function applyJsonPatch(state, operations) {
  const next = { ...state };
  for (const op of operations) {
    const { op: verb, path, value } = op;
    const parts = path.replace(/^\//, '').split('/');
    // Descend to the leaf's parent, cloning each container so we never mutate
    // the original state's nested objects/arrays.
    let parent = next;
    for (let d = 0; d < parts.length - 1; d++) {
      const seg = parts[d];
      const existing = parent[seg];
      let clone;
      if (Array.isArray(existing)) {
        clone = [...existing];
      } else if (existing && typeof existing === 'object') {
        clone = { ...existing };
      } else {
        // Missing container — its type is implied by the NEXT segment.
        clone = isArrayIndexSegment(parts[d + 1]) ? [] : {};
      }
      if (Array.isArray(parent)) {
        parent[parseInt(seg, 10)] = clone;
      } else {
        parent[seg] = clone;
      }
      parent = clone;
    }
    const leaf = parts[parts.length - 1];
    if (Array.isArray(parent)) {
      if (verb === 'add') {
        if (leaf === '-') {
          parent.push(value);
        } else {
          // RFC 6902 array add inserts at the index (shifting the tail).
          parent.splice(parseInt(leaf, 10), 0, value);
        }
      } else if (verb === 'replace') {
        parent[parseInt(leaf, 10)] = value;
      } else if (verb === 'remove') {
        parent.splice(parseInt(leaf, 10), 1);
      }
    } else if (verb === 'add' || verb === 'replace') {
      parent[leaf] = value;
    } else if (verb === 'remove') {
      delete parent[leaf];
    }
  }
  return next;
}

export function useAgentRun({
  onEvent,
  onStateSnapshot,
  onStateDelta,
  onFinished,
  onError,
} = {}) {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  // Keep callback refs current each render so `run` (stable identity) always
  // invokes the latest callbacks without needing them in its dep array.
  const callbacksRef = useRef({});
  callbacksRef.current = { onEvent, onStateSnapshot, onStateDelta, onFinished, onError };

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      // Flip the trace to a terminal outcome so any progress spinners (rail,
      // flow-detail modal, use-case Run chip) can render "aborted" instead of
      // staying at "in progress" forever after the SSE stream is cut. Only
      // when a run was actually in flight — this cleanup also fires on every
      // unmount (including React StrictMode's mount/unmount/remount probe),
      // and completeTrace(false) unconditionally painted a fresh trace as
      // "RUN ERROR" before the user had done anything.
      try { tokenChainTraceStore.completeTrace(false); } catch (_) { /* display-only */ }
    }
    setIsRunning(false);
  }, []);

  const run = useCallback(async ({ threadId, runId, messages, resume, provider, mode, useCaseId } = {}) => {
    // Abort any in-flight run
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setIsRunning(true);
    setError(null);

    // flowTraceId binds this AG-UI run to the live MCP flow SSE stream so the
    // compliance checklist lights up the full pipeline (token exchange, gateway,
    // execution) — not just the client-marked steps. The BFF threads it through
    // executeBffTool → runMcpToolPipeline, which publishes phase + token events
    // to the hub keyed by this id; openMcpFlowSse feeds them to the flow diagram.
    const flowTraceId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    // sendAsNlInner began the trace before this run existed; bind this run's id
    // now so a prior run's late SSE evidence is dropped instead of repainting it.
    try { tokenChainTraceStore.bindFlowTrace(flowTraceId); } catch (_) { /* display-only */ }
    const closeSse = openMcpFlowSse(flowTraceId, (data) => {
      // Token events from the BFF pipeline (exchange, gateway, authorize, MCP).
      // Without this the AG-UI path drops pipeline evidence and the Token Flow
      // Detail modal stays on "waiting…" with no exchange/gateway/MCP steps.
      if (data && data.type === 'token-event') {
        try {
          const tokenEvent = { ...data, flowTraceId };
          delete tokenEvent.type;
          tokenChainTraceStore.ingestTokenEvent(tokenEvent);
        } catch (_) { /* display-only */ }
      }
      // MCP tool result — same event demoAgentService dispatches on the chip
      // path; tokenChainTraceStore listens for it to fill the MCP/API steps.
      if (data && data.type === 'mcp-result') {
        try {
          window.dispatchEvent(new CustomEvent('mcp-tool-result-sse', { detail: { ...data, flowTraceId } }));
        } catch (_) { /* display-only */ }
      }
      try {
        agentFlowDiagram.applyServerEvent(data);
      } catch (_) {
        /* never let a flow-diagram update break the agent run */
      }
    });

    const body = { threadId, runId, messages, flowTraceId };
    if (resume) body.resume = resume;
    // Forward the caller's selected LLM provider (e.g. the agent-mode picker's
    // "llama.cpp only" → 'llamacpp') so the AG-UI run honors it instead of the BFF's
    // 'anthropic' default. Omitted when null so the BFF's session/config fallback
    // still applies.
    if (provider) body.provider = provider;
    // Always send the MODE, even when the provider is null (heuristics). The BFF
    // otherwise falls back to server-wide config, where an AGENT_MODE pod env
    // outranks the user's picker — so "Heuristics only" could still resolve to
    // an LLM. The mode is what the user actually chose; make it authoritative.
    if (mode) body.mode = mode;
    // Forward the explicitly-clicked use case so the server stamps token events
    // with the right slug (agentRun.js → agentTool.js → resolveChipUseCaseId).
    // Omitted when absent so typed messages still derive organically.
    if (useCaseId) body.useCaseId = useCaseId;

    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      closeSse();
      if (err.name === 'AbortError') {
        setIsRunning(false);
        return;
      }
      const msg = 'Cannot reach agent service: ' + err.message;
      setError(msg);
      setIsRunning(false);
      callbacksRef.current.onError && callbacksRef.current.onError(msg);
      return;
    }

    if (!response.ok) {
      closeSse();
      let msg = 'Agent run failed: HTTP ' + response.status;
      try {
        const data = await response.json();
        msg = data.error || msg;
      } catch (_) {}
      setError(msg);
      setIsRunning(false);
      callbacksRef.current.onError && callbacksRef.current.onError(msg);
      return;
    }

    // Stream the response body
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const { events, remaining } = parseSseChunk(buffer, chunk);
        buffer = remaining;

        for (const event of events) {
          // Dispatch to type-specific callbacks first, then generic onEvent
          if (event.type === 'STATE_SNAPSHOT') {
            callbacksRef.current.onStateSnapshot && callbacksRef.current.onStateSnapshot(event.snapshot);
          } else if (event.type === 'STATE_DELTA') {
            callbacksRef.current.onStateDelta && callbacksRef.current.onStateDelta(event.delta);
          } else if (event.type === 'RUN_FINISHED') {
            callbacksRef.current.onFinished && callbacksRef.current.onFinished(event.outcome);
          } else if (event.type === 'RUN_ERROR') {
            setError(event.message || 'Agent error');
            callbacksRef.current.onError && callbacksRef.current.onError(event.message || 'Agent error');
          }
          // Always emit the raw event for panels that want full visibility
          callbacksRef.current.onEvent && callbacksRef.current.onEvent(event);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        const msg = 'Stream interrupted: ' + err.message;
        setError(msg);
        callbacksRef.current.onError && callbacksRef.current.onError(msg);
      }
    } finally {
      closeSse();
      reader.releaseLock();
      // Only clear the shared ref / flip running state if it still belongs to
      // THIS invocation. If a newer run() call has since superseded this one
      // (aborting it and installing its own controller), that newer run's
      // controller and running state must not be clobbered by this run's
      // late cleanup.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsRunning(false);
      }
    }
  }, []);

  return { run, abort, isRunning, error };
}
