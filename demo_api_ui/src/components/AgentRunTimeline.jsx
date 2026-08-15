// demo_api_ui/src/components/AgentRunTimeline.jsx
//
// Read-only detail view for a single past agent run, given the run's
// reportStore record (from GET /api/agent-flow-history). Two render paths:
//
//   - AG-UI runs (run.agentPath === 'agui'): fetch the raw AG-UI events this
//     run's trace still holds (GET /api/agent/run/runs/:runId/events) and
//     project them into the same TokenChainEventCard visual language used
//     elsewhere in the app. This is deliberately NOT UnifiedTokenFlowInspector:
//     that component's rich token chain / authorize-evaluation data comes from
//     a separate, unpersisted SSE channel (openMcpFlowSse) never captured
//     here, so only the AG-UI conversation/tool-call events are available.
//   - Every other run (or an AG-UI run whose trace has expired — it's only
//     kept for 1 hour): render directly from the reportStore record itself
//     (prompt, toolsCalled, tokenEvents) — lighter, but real data, not an
//     empty state.
import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import TokenChainEventCard from './ProtocolPlayground/TokenChainEventCard';

/** Group raw AG-UI events into one card per logical step (run/message/tool-call). */
function projectAguiEventsToCards(events) {
  const cards = [];
  const messages = new Map(); // messageId -> accumulated text
  const toolCalls = new Map(); // toolCallId -> { name, args }
  let runFailed = false;

  for (const evt of events) {
    if (!evt || !evt.type) continue;
    switch (evt.type) {
      case 'RUN_STARTED':
        cards.push({
          label: 'Run started',
          status: 'success',
          explanation: evt.threadId ? `thread ${evt.threadId}` : null,
        });
        break;
      case 'TEXT_MESSAGE_START':
        messages.set(evt.messageId, '');
        break;
      case 'TEXT_MESSAGE_CONTENT':
        if (messages.has(evt.messageId)) {
          messages.set(evt.messageId, messages.get(evt.messageId) + (evt.delta || ''));
        }
        break;
      case 'TEXT_MESSAGE_END': {
        const text = messages.get(evt.messageId);
        if (text) {
          cards.push({
            label: 'Assistant message',
            status: 'success',
            explanation: text.length > 400 ? `${text.slice(0, 400)}…` : text,
          });
        }
        messages.delete(evt.messageId);
        break;
      }
      case 'TOOL_CALL_START':
        toolCalls.set(evt.toolCallId, { name: evt.toolCallName || evt.toolName || 'tool', args: '' });
        break;
      case 'TOOL_CALL_ARGS':
        if (toolCalls.has(evt.toolCallId)) {
          toolCalls.get(evt.toolCallId).args += evt.delta || '';
        }
        break;
      case 'TOOL_CALL_END': {
        const call = toolCalls.get(evt.toolCallId);
        cards.push({
          label: `Tool call: ${call?.name || evt.toolCallId || 'unknown'}`,
          status: 'success',
          claims: call?.args ? [{ key: 'args', value: call.args }] : [],
        });
        toolCalls.delete(evt.toolCallId);
        break;
      }
      case 'RUN_ERROR':
        runFailed = true;
        cards.push({
          label: 'Run error',
          status: 'error',
          explanation: evt.message || evt.code || 'Unknown error',
        });
        break;
      case 'RUN_FINISHED': {
        const isInterrupt = evt.outcome?.type === 'interrupt';
        cards.push({
          label: 'Run finished',
          status: runFailed ? 'error' : isInterrupt ? 'pending' : 'success',
          explanation: isInterrupt ? 'Suspended for human-in-the-loop approval' : null,
        });
        break;
      }
      case 'CUSTOM':
        cards.push({
          label: evt.name ? `Event: ${evt.name}` : 'Custom event',
          status: 'success',
        });
        break;
      default:
        break;
    }
  }

  return cards;
}

/** Project a reportStore run record directly into cards — no raw event trace available. */
function projectReportRecordToCards(run) {
  const cards = [];
  cards.push({
    label: 'Prompt',
    status: 'success',
    explanation: run.prompt || '(no prompt recorded)',
  });
  for (const tool of run.toolsCalled || []) {
    cards.push({ label: `Tool call: ${tool}`, status: 'success' });
  }
  for (const event of run.tokenEvents || []) {
    cards.push({
      label: event.label || event.eventType || event.id || 'Token event',
      status: event.status || 'success',
    });
  }
  cards.push({
    label: 'Run finished',
    status: run.success === false ? 'error' : 'success',
  });
  return cards;
}

export default function AgentRunTimeline({ run }) {
  const [state, setState] = useState({ loading: true, error: null, cards: [] });

  useEffect(() => {
    if (!run || !run.runId) {
      setState({ loading: false, error: null, cards: [] });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, error: null, cards: [] });

    if (run.agentPath !== 'agui') {
      setState({ loading: false, error: null, cards: projectReportRecordToCards(run) });
      return undefined;
    }

    apiClient
      .get(`/api/agent/run/runs/${encodeURIComponent(run.runId)}/events`)
      .then((r) => {
        if (cancelled) return;
        const events = Array.isArray(r.data?.events) ? r.data.events : [];
        setState({ loading: false, error: null, cards: projectAguiEventsToCards(events) });
      })
      .catch(() => {
        // The AG-UI trace expires after 1 hour — fall back to the durable
        // reportStore record rather than showing an error for an old run.
        if (cancelled) return;
        setState({ loading: false, error: null, cards: projectReportRecordToCards(run) });
      });
    return () => { cancelled = true; };
  }, [run]);

  if (state.loading) {
    return <div className="agent-run-timeline-empty">Loading run…</div>;
  }
  if (state.error) {
    return <div className="agent-run-timeline-empty agent-run-timeline-error">{state.error}</div>;
  }

  if (!state.cards.length) {
    return <div className="agent-run-timeline-empty">No events recorded for this run.</div>;
  }

  return (
    <div className="agent-run-timeline">
      {state.cards.map((card, idx) => (
        <TokenChainEventCard key={idx} event={card} />
      ))}
    </div>
  );
}
