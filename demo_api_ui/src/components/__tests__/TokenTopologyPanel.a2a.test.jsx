import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TokenTopologyPanel, { buildA2aTopology, buildObservedTopology } from '../TokenTopologyPanel';
import { ThemeProvider } from '../../context/ThemeContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

vi.mock('../DraggableModal', () => ({
  default: ({ isOpen, children, className }) => isOpen ? <div className={className}>{children}</div> : null,
}));

beforeEach(() => {
  tokenChainTraceStore.reset();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

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

  it('builds topology nodes only from steps observed in the run', () => {
    const topology = buildObservedTopology([
      { id: 'website', title: 'Website — browser', lane: 'BROWSER', status: 'done' },
      { id: 'signin', title: 'Sign-in — user token', lane: 'PINGONE', status: 'pending' },
      { id: 'stepup', title: 'Step-up required — MFA', lane: 'AUTHZ', status: 'active' },
      { id: 'api-key-swap', title: 'API-key path — credential swap', lane: 'GATEWAY', status: 'notinpath' },
      { id: 'authorize:2', baseId: 'authorize', title: 'PingOne Authorize — policy decision', lane: 'AUTHZ', status: 'error' },
    ]);

    expect(topology.map((node) => node.id)).toEqual(['website', 'stepup', 'authorize:2']);
    expect(topology.map((node) => node.name)).toEqual(['Website', 'Step-up required', 'PingOne Authorize']);
    expect(topology[2].icon).toBe('AZ');
  });

  it('starts empty and draws observed boxes and arrows as evidence arrives', () => {
    const { container } = render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText('Run an agent flow to build the topology.')).toBeInTheDocument();
    expect(screen.queryByText('Website')).not.toBeInTheDocument();

    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' });
    });

    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('Chatbot')).toBeInTheDocument();
    expect(screen.queryByText('Sign-in')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent service receives request')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.ttp-conn')).toHaveLength(1);

    act(() => {
      tokenChainTraceStore.ingestRoutingMode('heuristic');
    });

    expect(screen.getByText('Agent service receives request')).toBeInTheDocument();
    expect(screen.getByText('Heuristics')).toBeInTheDocument();
    expect(screen.queryByText('Token exchange')).not.toBeInTheDocument();
    expect([...container.querySelectorAll('.ttp-name')].map((node) => node.textContent)).toEqual([
      'Website',
      'Chatbot',
      'Agent service receives request',
      'Heuristics',
    ]);
    expect(container.querySelectorAll('.ttp-conn')).toHaveLength(3);
  });

  it('enriches an already drawn node when detailed evidence arrives', async () => {
    const user = userEvent.setup();
    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' });
      tokenChainTraceStore.ingestTokenEvent({ id: 'exchanged-token', status: 'waiting' });
    });
    render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    await user.click(screen.getByText('Token exchange'));
    expect(screen.queryByRole('button', { name: 'Request' })).not.toBeInTheDocument();

    act(() => {
      tokenChainTraceStore.ingestTokenEvent({
        id: 'exchanged-token',
        status: 'exchanged',
        claims: { aud: 'mcp-gateway', scope: 'banking:read' },
      });
    });

    expect(screen.getByRole('button', { name: 'Request' })).toBeInTheDocument();
  });

  it('clears the rendered topology back to an empty state', async () => {
    const user = userEvent.setup();
    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' });
      tokenChainTraceStore.ingestRoutingMode('heuristic');
    });
    render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    expect(screen.getByText('Website')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear/i }));

    expect(screen.queryByText('Website')).not.toBeInTheDocument();
    expect(screen.getByText('Run an agent flow to build the topology.')).toBeInTheDocument();
    expect(tokenChainTraceStore.getState().trace.runId).toBeNull();
  });

  it('closes the inspector when another surface resets the trace', async () => {
    const user = userEvent.setup();
    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' });
    });
    render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    await user.click(screen.getByText('Website'));
    expect(screen.getByText('Website — browser / UI app')).toBeInTheDocument();

    act(() => {
      tokenChainTraceStore.reset();
    });

    expect(screen.queryByText('Website — browser / UI app')).not.toBeInTheDocument();
    expect(screen.getByText('Run an agent flow to build the topology.')).toBeInTheDocument();
  });

  it('provides a visible switch for light and dark topology themes', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    const toggle = screen.getByRole('switch', { name: 'Dark mode' });
    const topology = container.querySelector('.ttp-root');

    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(topology).toHaveAttribute('data-theme', 'light');
    expect(container.querySelector('.ttp-modal')).toHaveClass('ttp-modal--light');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(topology).toHaveAttribute('data-theme', 'dark');
    expect(container.querySelector('.ttp-modal')).toHaveClass('ttp-modal--dark');
    expect(localStorage.getItem('ba_dark_mode')).toBe('true');
  });
});
