import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PersonalAgentStudioPage from '../PersonalAgentStudioPage';
import { TokenChainProvider, useTokenChain } from '../../context/TokenChainContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

const scenario = {
  id: 'UC44',
  title: 'OBO customer-data read',
  useCaseId: 'workload-digital-assistant-obo',
  primaryTool: 'list_gear',
  runPrompt: 'my gear',
};

function EvidenceProbe() {
  const tokenChain = useTokenChain();
  return <>
    <button type="button" onClick={() => tokenChain.setTokenEvents('old-tool', [{ id: 'old-run', status: 'success' }])}>Seed old evidence</button>
    <output data-testid="live-token-events">{tokenChain.events.map((event) => event.id).join(',')}</output>
  </>;
}

function renderWorkload() {
  render(<MemoryRouter>
    <TokenChainProvider activePath="/workload-agents">
      <EvidenceProbe />
      <PersonalAgentStudioPage scenario={scenario} vertical="sporting-goods" />
    </TokenChainProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  tokenChainTraceStore.reset();
});

afterEach(() => vi.unstubAllGlobals());

describe('PersonalAgentStudioPage workload evidence', () => {
  it('clears the prior live chain and filmstrip trace when a workload run starts', async () => {
    let resolveInvoke;
    vi.stubGlobal('fetch', vi.fn((url) => url === '/api/agent/invoke'
      ? new Promise((resolve) => { resolveInvoke = resolve; })
      : Promise.resolve({ ok: false, status: 401, json: async () => ({}) })));
    renderWorkload();
    fireEvent.click(screen.getByRole('button', { name: 'Seed old evidence' }));
    expect(screen.getByTestId('live-token-events')).toHaveTextContent('old-run');
    expect(tokenChainTraceStore.getState().trace.tokenEvents.map((event) => event.id)).toContain('old-run');

    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    expect(await screen.findByText('Running the selected action…')).toBeTruthy();
    expect(screen.getByTestId('live-token-events')).toHaveTextContent(/^$/);
    expect(tokenChainTraceStore.getState().trace.tokenEvents.map((event) => event.id)).not.toContain('old-run');

    resolveInvoke({ ok: true, json: async () => ({ reply: 'Read complete.' }) });
    expect(await screen.findByText('Read complete.')).toBeTruthy();
  });

  it('puts a successful workload response token chain into context', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/agent/invoke'
      ? { ok: true, json: async () => ({ reply: 'Read complete.', tokenEvents: [{ id: 'mcp-exchange', status: 'success' }] }) }
      : { ok: false, status: 401, json: async () => ({}) })));
    renderWorkload();
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    await waitFor(() => expect(screen.getByTestId('live-token-events')).toHaveTextContent('mcp-exchange'));
    expect(tokenChainTraceStore.getState().trace.tokenEvents.map((event) => event.id)).toContain('mcp-exchange');
  });

  it('keeps token evidence from a structured HTTP error response', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/agent/invoke'
      ? { ok: false, status: 428, json: async () => ({ error: 'step_up_required', message: 'Complete MFA.', tokenEvents: [{ id: 'mfa', status: 'required' }] }) }
      : { ok: false, status: 401, json: async () => ({}) })));
    renderWorkload();
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    expect(await screen.findByText('Complete MFA.')).toBeTruthy();
    expect(screen.getByTestId('live-token-events')).toHaveTextContent('mfa');
    expect(tokenChainTraceStore.getState().trace.tokenEvents.map((event) => event.id)).toContain('mfa');
  });
});
