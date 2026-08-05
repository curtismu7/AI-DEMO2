import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TokenChainDisplay, { getTokenChainProgress } from '../TokenChainDisplay';

const EVENTS = [
  { id: 'a2a-agent1-actor', label: 'Main agent token', status: 'acquired', claims: { client_id: 'main-agent' } },
  { id: 'a2a-exchange1', label: 'Exchange #1', status: 'exchanged', claims: { aud: 'intermediate' } },
  {
    id: 'a2a-exchange2',
    label: 'Exchange #2',
    status: 'exchanged',
    specialist: 'Investment Advisor',
    claims: { aud: 'mcp-gateway', act: { sub: 'specialist', act: { sub: 'main-agent' } } },
  },
  { id: 'a2a-protocol-bearer', label: 'A2A bearer', status: 'acquired', claims: { aud: 'specialist' } },
  { id: 'a2a-agent-card', label: 'Agent Card', status: 'discovered', agentName: 'Investment Advisor' },
  {
    id: 'a2a-protocol-message',
    label: 'A2A SendMessage',
    status: 'completed',
    agentName: 'Investment Advisor',
    protocolRequest: { method: 'message/send' },
    protocolResponse: { replyText: 'ok' },
  },
];

vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({
    events: EVENTS,
    history: [],
    mcpToolCalls: [],
    mcpAuthMode: null,
    nlRoutingEvent: null,
    clearEvents: vi.fn(),
    clearMcpToolCalls: vi.fn(),
    resolvedIdentity: null,
  }),
}));

vi.mock('../../context/EducationUIContext', () => ({
  useEducationUIOptional: () => null,
}));

vi.mock('../../hooks/useDraggablePanel', () => ({
  useDraggablePanel: () => ({
    pos: { x: 0, y: 0 },
    size: { w: 720, h: 620 },
    handleDragStart: vi.fn(),
    createResizeHandler: () => vi.fn(),
  }),
}));

describe('Token Chain A2A progress controls', () => {
  it('reports completed, running, failed, and idle chain states', () => {
    expect(getTokenChainProgress(EVENTS, true).state).toBe('completed');
    expect(getTokenChainProgress(EVENTS.slice(0, 3), true).state).toBe('running');
    expect(getTokenChainProgress([{ id: 'exchange-failed', status: 'failed' }], true).state).toBe('failed');
    expect(getTokenChainProgress([], false).state).toBe('idle');
  });

  it('makes the second-agent call explicit and opens its details modal', () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<TokenChainDisplay />);

    expect(screen.getByText('Main agent called Investment Advisor')).toBeInTheDocument();
    fireEvent.click(screen.getByText('View handoff'));

    expect(screen.getByRole('dialog', { name: /A2A main-agent to specialist handoff/i })).toBeInTheDocument();
    expect(screen.getByText('Identity path')).toBeInTheDocument();
    expect(screen.getByText('Wire-protocol path')).toBeInTheDocument();
    expect(screen.getByText(/separate PingOne bearer authenticates/i)).toBeInTheDocument();
  });
});
