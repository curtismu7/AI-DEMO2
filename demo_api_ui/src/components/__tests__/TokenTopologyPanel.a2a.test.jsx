import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TokenTopologyPanel, { buildA2aTopology, buildObservedTopology, isUnfired } from '../TokenTopologyPanel';
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

  // The topology deliberately keeps hops that never fired: an available-but-unused
  // control is part of what the diagram reports. They render dimmed (see isUnfired).
  it('builds topology nodes from every step in the chain, fired or not', () => {
    const topology = buildObservedTopology([
      { id: 'website', title: 'Website — browser', lane: 'BROWSER', status: 'done' },
      { id: 'signin', title: 'Sign-in — user token', lane: 'PINGONE', status: 'pending' },
      { id: 'stepup', title: 'Step-up required — MFA', lane: 'AUTHZ', status: 'active' },
      { id: 'api-key-swap', title: 'API-key path — credential swap', lane: 'GATEWAY', status: 'notinpath' },
      { id: 'authorize:2', baseId: 'authorize', title: 'PingOne Authorize — policy decision', lane: 'AUTHZ', status: 'error' },
    ]);

    expect(topology.map((node) => node.id))
      .toEqual(['website', 'signin', 'stepup', 'api-key-swap', 'authorize:2']);
    expect(topology.map((node) => node.name))
      .toEqual(['Website', 'Sign-in', 'Step-up required', 'API-key path', 'PingOne Authorize']);
    expect(topology[4].icon).toBe('AZ');
  });

  it('marks the unfired hops so they can be drawn dimmed', () => {
    expect(isUnfired({ status: 'pending' })).toBe(true);
    expect(isUnfired({ status: 'notinpath' })).toBe(true);
    expect(isUnfired({ status: 'active' })).toBe(false);
    expect(isUnfired({ status: 'done' })).toBe(false);
    expect(isUnfired({ status: 'error' })).toBe(false);
  });

  it('starts empty, then draws the whole chain and un-dims hops as evidence arrives', () => {
    const nameOf = (node) => node.querySelector('.ttp-name')?.textContent;
    const firedNames = (container) => [...container.querySelectorAll('.ttp-node:not(.ghost)')].map(nameOf);

    const { container } = render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    // Nothing at all until a run starts.
    expect(screen.getByText('Run an agent flow to build the topology.')).toBeInTheDocument();
    expect(screen.queryByText('Website')).not.toBeInTheDocument();

    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' });
    });

    // The full chain is now drawn, including hops with no evidence yet — those
    // render dimmed rather than being withheld, so the diagram can show where a
    // control sits even before (or without) it firing.
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('Chatbot')).toBeInTheDocument();
    expect(screen.getByText('Sign-in')).toBeInTheDocument();
    expect(screen.getByText('Agent service receives request')).toBeInTheDocument();
    expect(firedNames(container)).toEqual(['Website', 'Chatbot']);

    act(() => {
      tokenChainTraceStore.ingestRoutingMode('heuristic');
    });

    // Heuristic routing lights up the agent and the (LLM-less) reasoning hop.
    expect(screen.getByText('Heuristics')).toBeInTheDocument();
    expect(firedNames(container))
      .toEqual(['Website', 'Chatbot', 'Agent service receives request', 'Heuristics']);
    // Sign-in still has no token evidence, so it stays dimmed.
    expect(firedNames(container)).not.toContain('Sign-in');
  });

  it('drops the tool-call hops onto a branch below the spine', () => {
    const { container } = render(
      <ThemeProvider>
        <TokenTopologyPanel isOpen onClose={() => {}} />
      </ThemeProvider>,
    );

    act(() => {
      tokenChainTraceStore.beginTrace({ prompt: 'Show my accounts' });
    });

    const branchNames = [...container.querySelectorAll('.ttp-branch .ttp-name')].map((n) => n.textContent);
    // The tool call is two requests: the refused one and the authorized one.
    // Both hang off the branch, in the order they went out.
    expect(branchNames).toEqual(['Agent Gateway', 'API-key path', 'tools/call 401', 'initialize', 'notifications/initialized', 'MCP server', 'Resource server', 'Database']);
    // tools/list is discovery, not the tool call — it belongs on the spine.
    expect(branchNames).not.toContain('tools/list');
    expect([...container.querySelectorAll('.ttp-spine .ttp-name')].map((n) => n.textContent))
      .toContain('tools/list');
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
