// demo_api_ui/src/components/AgentRunTimeline.jsx
//
// Read-only timeline for a single past agent run — projects the raw AG-UI
// events recorded by GET /api/agent/runs/:runId/events into the same
// TokenChainEventCard visual language used elsewhere in the app. This is
// deliberately NOT UnifiedTokenFlowInspector: that component's rich token
// chain / authorize-evaluation data comes from a separate, unpersisted SSE
// channel (openMcpFlowSse) that GET /runs/:runId/events never captured, so
// only the AG-UI conversation/tool-call events are available for replay here.
import React, { useEffect, useState } from 'react';
import apiClient from '../services/apiClient';
import TokenChainEventCard from './ProtocolPlayground/TokenChainEventCard';

/** Group raw AG-UI events into one card per logical step (run/message/tool-call). */
function projectEventsToCards(events) {
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

export default function AgentRunTimeline({ runId }) {
  const [state, setState] = useState({ loading: true, error: null, events: [] });

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    setState({ loading: true, error: null, events: [] });
    apiClient
      .get(`/api/agent/runs/${encodeURIComponent(runId)}/events`)
      .then((r) => {
        if (cancelled) return;
        setState({ loading: false, error: null, events: Array.isArray(r.data?.events) ? r.data.events : [] });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.response?.status === 404
          ? 'This run’s events have expired or are no longer available.'
          : 'Failed to load run events.';
        setState({ loading: false, error: message, events: [] });
      });
    return () => { cancelled = true; };
  }, [runId]);

  if (state.loading) {
    return <div className="agent-run-timeline-empty">Loading run…</div>;
  }
  if (state.error) {
    return <div className="agent-run-timeline-empty agent-run-timeline-error">{state.error}</div>;
  }

  const cards = projectEventsToCards(state.events);
  if (!cards.length) {
    return <div className="agent-run-timeline-empty">No events recorded for this run.</div>;
  }

  return (
    <div className="agent-run-timeline">
      {cards.map((card, idx) => (
        <TokenChainEventCard key={idx} event={card} />
      ))}
    </div>
  );
}
