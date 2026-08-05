import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TokenTopologyPanel, { buildA2aTopology } from '../TokenTopologyPanel';

vi.mock('../DraggableModal', () => ({
  default: ({ isOpen, children }) => isOpen ? <div>{children}</div> : null,
}));

describe('buildA2aTopology', () => {
  it('shows token exchanges separately from the A2A wire handoff', () => {
    const topology = buildA2aTopology([
      { id: 'a2a-agent1-actor', claims: { client_id: 'main-agent' } },
      { id: 'a2a-exchange1', status: 'exchanged', claims: { aud: 'intermediate' } },
      {
        id: 'a2a-exchange2',
        status: 'exchanged',
        specialist: 'Investment Advisor',
        claims: { aud: 'mcp-gateway', act: { sub: 'specialist', act: { sub: 'main-agent' } } },
      },
      { id: 'a2a-protocol-bearer', status: 'acquired', claims: { aud: 'a2a-specialist' } },
      { id: 'a2a-agent-card', status: 'discovered', agentName: 'Investment Advisor' },
      { id: 'a2a-protocol-message', status: 'completed', agentName: 'Investment Advisor' },
    ]);

    expect(topology.identity.map((node) => node.name)).toEqual([
      'Main agent',
      'Exchange #1',
      'Exchange #2',
      'Investment Advisor',
    ]);
    expect(topology.wire.map((node) => node.name)).toEqual([
      'Main agent',
      'PingOne wire bearer',
      'Agent Card',
      'A2A SendMessage',
      'Investment Advisor',
    ]);
    expect(topology.identity[2].desc).toContain('nested act');
    expect(topology.wire[1].desc).toContain('Separate client-credentials token');
  });

  it('does not add an A2A lane to ordinary runs', () => {
    expect(buildA2aTopology([{ id: 'exchange', status: 'exchanged' }])).toBeNull();
  });

  it('keeps every standard topology step visible before a run starts', () => {
    render(<TokenTopologyPanel isOpen onClose={() => {}} />);

    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('PingOne AS')).toBeInTheDocument();
    expect(screen.getByText('Agent Service')).toBeInTheDocument();
    expect(screen.getByText('BFF Token Exchange')).toBeInTheDocument();
    expect(screen.getByText('PingOne Authorize')).toBeInTheDocument();
    expect(screen.getByText('Agent Gateway')).toBeInTheDocument();
    expect(screen.getByText('MCP Server')).toBeInTheDocument();
  });
});
