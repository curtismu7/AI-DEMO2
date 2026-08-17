/**
 * useAgentState.js
 *
 * AG-UI Step 3 — Shared agent state manager.
 *
 * Maintains the full AgentRunState (mirrors server-side shape):
 *   tokenEvents[], mcpTraffic[], authorizeDecisions[], archTrace[],
 *   auditEvents[], activeRun, messages[], toolCalls[]
 *
 * State is updated by:
 *   - onStateSnapshot: full state replacement (on connect)
 *   - onStateDelta: JSON Patch operations (incremental updates)
 *   - onEvent: individual event processing for messages + toolCalls lists
 *
 * Returns:
 *   { state, handlers, reset }
 *
 * handlers is an object to spread into useAgentRun:
 *   { onEvent, onStateSnapshot, onStateDelta, onFinished, onError }
 */

import { useState, useCallback, useRef } from 'react';
import { applyJsonPatch } from './useAgentRun';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';

const INITIAL_STATE = {
  // Observability slices (driven by STATE_DELTA)
  tokenEvents: [],
  mcpTraffic: [],
  authorizeDecisions: [],
  archTrace: [],
  auditEvents: [],
  // Active run metadata
  activeRun: null,
  // Chat thread (built from AG-UI text + tool events)
  messages: [],
  toolCalls: [],
  // HITL
  hitlPending: null,
  // Run outcome
  lastOutcome: null,
  error: null,
  // Token usage emitted by the active agent runtime (null = not reported)
  lastTokenUsage: null,
  // Latest commitment-grounding correction (set by the CUSTOM
  // grounding_correction event; null = no correction this run).
  lastGroundingCorrection: null,
  // Reasoning visibility (driven by STATE_DELTA /reasoningState/*) — what the
  // agent is thinking: current phase, the tools it selected, and token usage.
  reasoningState: { phase: null, toolOptions: [], contextTokens: null },
};

export function useAgentState() {
  const [state, setState] = useState(INITIAL_STATE);

  // Accumulate text content for streaming messages
  const streamingMessageRef = useRef(null);
  const streamingToolCallRef = useRef(null);
  // Raw TOOL_CALL_ARGS fragments accumulated across deltas for the active tool
  // call; parsed once at TOOL_CALL_END. Reset per tool call.
  const streamingToolArgsRef = useRef('');

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    streamingMessageRef.current = null;
    streamingToolCallRef.current = null;
    streamingToolArgsRef.current = '';
  }, []);

  const onStateSnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setState((prev) => ({
      ...prev,
      tokenEvents: snapshot.tokenEvents || [],
      mcpTraffic: snapshot.mcpTraffic || [],
      authorizeDecisions: snapshot.authorizeDecisions || [],
      archTrace: snapshot.archTrace || [],
      auditEvents: snapshot.auditEvents || [],
      activeRun: snapshot.activeRun || null,
      reasoningState: snapshot.reasoningState || { phase: null, toolOptions: [], contextTokens: null },
    }));
  }, []);

  const onStateDelta = useCallback((operations) => {
    if (!Array.isArray(operations)) return;
    setState((prev) => {
      // Only apply delta to the observability slices + activeRun — not messages/toolCalls
      const slicePrev = {
        tokenEvents: prev.tokenEvents,
        mcpTraffic: prev.mcpTraffic,
        authorizeDecisions: prev.authorizeDecisions,
        archTrace: prev.archTrace,
        auditEvents: prev.auditEvents,
        activeRun: prev.activeRun,
        // Included so /reasoningState/* delta ops persist across reasoning steps
        // (applyJsonPatch's nested-object branch merges onto the prior value).
        reasoningState: prev.reasoningState,
      };
      const sliceNext = applyJsonPatch(slicePrev, operations);
      // Defensively exclude messages/toolCalls to prevent delta from contaminating event-driven state
      const { messages: _, toolCalls: __, ...safeSliceNext } = sliceNext;
      return { ...prev, ...safeSliceNext };
    });
  }, []);

  const onEvent = useCallback((event) => {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'RUN_STARTED':
        setState((prev) => ({ ...prev, lastOutcome: null, error: null, hitlPending: null, lastTokenUsage: null, lastGroundingCorrection: null }));
        break;

      case 'TEXT_MESSAGE_START': {
        // Capture the new message locally: the setState updater runs lazily, and a
        // following TEXT_MESSAGE_END may null streamingMessageRef before it executes —
        // reading the ref inside the updater would then push null into messages[].
        const startedMessage = {
          id: event.messageId,
          role: event.role || 'assistant',
          content: '',
          streaming: true,
        };
        streamingMessageRef.current = startedMessage;
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, startedMessage],
        }));
        break;
      }

      case 'TEXT_MESSAGE_CONTENT':
        if (streamingMessageRef.current && event.messageId === streamingMessageRef.current.id) {
          // Capture the updated message locally — same reasoning as
          // TEXT_MESSAGE_START. When events arrive back-to-back with no real
          // delay (e.g. a non-streaming provider whose full reply is emitted
          // as a single START/CONTENT/END burst), a following event's ref
          // mutation can run before React executes this updater; reading the
          // ref inside the updater would then push a stale or null value.
          const updatedMessage = {
            ...streamingMessageRef.current,
            content: streamingMessageRef.current.content + (event.delta || ''),
          };
          streamingMessageRef.current = updatedMessage;
          setState((prev) => {
            const msgs = [...prev.messages];
            const idx = msgs.findIndex((m) => m && m.id === event.messageId);
            if (idx !== -1) {
              msgs[idx] = updatedMessage;
            }
            return { ...prev, messages: msgs };
          });
        }
        break;

      case 'TEXT_MESSAGE_END':
        if (streamingMessageRef.current && event.messageId === streamingMessageRef.current.id) {
          // Same local-capture reasoning as TEXT_MESSAGE_START/CONTENT.
          const finishedMessage = {
            ...streamingMessageRef.current,
            streaming: false,
            // UC24 public catalog rides the terminating event: agentRun.js answers
            // branch_hours deterministically and attaches the locations here, so the
            // AG-UI path can render the same cards the heuristic path already does.
            // Absent on every other reply, which leaves the message shape unchanged.
            ...(Array.isArray(event.locationCards) ? { locationCards: event.locationCards } : {}),
          };
          tokenChainTraceStore.ingestLlmReply(finishedMessage.content);
          setState((prev) => {
            const msgs = [...prev.messages];
            const idx = msgs.findIndex((m) => m && m.id === event.messageId);
            if (idx !== -1) {
              msgs[idx] = finishedMessage;
            }
            return { ...prev, messages: msgs };
          });
          streamingMessageRef.current = null;
        }
        break;

      case 'TOOL_CALL_START': {
        // Capture locally for the same reason as TEXT_MESSAGE_START — a following
        // TOOL_CALL_END can null the ref before this lazy updater runs.
        const startedToolCall = {
          id: event.toolCallId,
          name: event.toolCallName,
          args: null,
          result: null,
          status: 'running',
        };
        streamingToolCallRef.current = startedToolCall;
        streamingToolArgsRef.current = '';
        setState((prev) => ({
          ...prev,
          toolCalls: [...prev.toolCalls, startedToolCall],
        }));
        break;
      }

      case 'TOOL_CALL_ARGS':
        if (streamingToolCallRef.current && event.toolCallId === streamingToolCallRef.current.id) {
          // AG-UI streams args as partial JSON fragments; parsing each in
          // isolation throws on every partial and loses the args. Accumulate the
          // raw string and parse once at TOOL_CALL_END.
          streamingToolArgsRef.current += (event.delta || '');
        }
        break;

      case 'TOOL_CALL_END':
        if (streamingToolCallRef.current && event.toolCallId === streamingToolCallRef.current.id) {
          let args = null;
          try {
            args = streamingToolArgsRef.current ? JSON.parse(streamingToolArgsRef.current) : null;
          } catch (_) {}
          // Capture locally — the setState updater runs lazily, and the ref is
          // nulled below before it executes; reading the ref inside the updater
          // would push {} into toolCalls (same reasoning as TEXT_MESSAGE_END).
          const finishedToolCall = { ...streamingToolCallRef.current, args, status: 'done' };
          streamingToolCallRef.current = finishedToolCall;
          setState((prev) => {
            const calls = [...prev.toolCalls];
            const idx = calls.findIndex((c) => c && c.id === event.toolCallId);
            if (idx !== -1) calls[idx] = finishedToolCall;
            return { ...prev, toolCalls: calls };
          });
          streamingToolCallRef.current = null;
          streamingToolArgsRef.current = '';
        }
        break;

      case 'TOOL_CALL_RESULT':
        setState((prev) => {
          const calls = [...prev.toolCalls];
          const idx = calls.findIndex((c) => c && c.id === event.toolCallId);
          if (idx !== -1) {
            let result = event.result;
            try { result = JSON.parse(event.result); } catch (_) {}
            calls[idx] = { ...calls[idx], result, status: 'done' };
          }
          return { ...prev, toolCalls: calls };
        });
        break;

      case 'RUN_FINISHED': {
        const outcome = event.outcome || {};
        if (outcome.type === 'interrupt' && outcome.interrupts?.length > 0) {
          setState((prev) => ({
            ...prev,
            hitlPending: outcome.interrupts[0],
            lastOutcome: outcome,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            hitlPending: null,
            lastOutcome: outcome,
          }));
        }
        break;
      }

      case 'RUN_ERROR':
        setState((prev) => ({ ...prev, error: event.message || 'Agent error' }));
        break;

      case 'CUSTOM':
        if (event.name === 'token_usage' && event.value) {
          setState((prev) => ({
            ...prev,
            lastTokenUsage: {
              inputTokens: event.value.inputTokens ?? 0,
              outputTokens: event.value.outputTokens ?? 0,
            },
          }));
        }
        if (event.name === 'llm_detail' && event.value) {
          tokenChainTraceStore.ingestLlmDetail(event.value);
        }
        if (event.name === 'grounding_correction' && event.value) {
          setState((prev) => ({
            ...prev,
            lastGroundingCorrection: {
              original: event.value.original,
              corrected: event.value.corrected,
              correctionNote: event.value.correctionNote,
            },
          }));
        }
        break;

      default:
        break;
    }
  }, []);

  const onFinished = useCallback((outcome) => {
    // Already handled in onEvent RUN_FINISHED; no additional work needed
    void outcome;
  }, []);

  const onError = useCallback((msg) => {
    setState((prev) => ({ ...prev, error: msg }));
  }, []);

  const handlers = { onEvent, onStateSnapshot, onStateDelta, onFinished, onError };

  return { state, handlers, reset };
}
