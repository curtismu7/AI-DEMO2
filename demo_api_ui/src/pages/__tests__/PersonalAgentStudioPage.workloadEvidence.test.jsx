import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const firstScenario = {
  id: 'UC38',
  title: 'MFA-gated protected action',
  useCaseId: 'personal-agent-concierge',
  primaryTool: 'extend_rental',
  runPrompt: 'extend my rental $600',
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

function SwitchingWorkload({ keyed }) {
  const [selected, setSelected] = useState('A');
  const first = selected === 'A';
  return <>
    <button type="button" onClick={() => setSelected('B')}>Switch scenario</button>
    <PersonalAgentStudioPage
      key={keyed ? selected : 'shared'}
      scenario={first ? firstScenario : scenario}
      vertical={first ? 'sporting-goods' : 'banking'}
    />
  </>;
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

  it('opens the in-app MFA challenge when the BFF answers 200 with step_up_required', async () => {
    const fetchMock = vi.fn((url) => Promise.resolve(url === '/api/agent/invoke'
      ? { ok: true, status: 200, json: async () => ({ success: false, step_up_required: true, reply: 'Please complete multi-factor authentication.' }) }
      : url === '/api/auth/mfa/challenge'
        ? { ok: true, status: 200, json: async () => ({ daId: 'da-1', devices: [] }) }
        : { ok: false, status: 401, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    renderWorkload();
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    // The prompt is a modal so it cannot be missed; "Not now" leaves the inline button.
    expect(await screen.findByText('MFA required')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('MFA required')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Verify with MFA and run again' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/mfa/challenge', expect.objectContaining({ method: 'POST' })));
  });

  it('falls back to the hosted step-up when the in-app challenge cannot start', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/agent/invoke'
      ? { ok: true, status: 200, json: async () => ({ success: false, step_up_required: true, reply: 'Please complete multi-factor authentication.' }) }
      : { ok: false, status: 500, json: async () => ({}) })));
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderWorkload();
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Verify with MFA' }));
    // An absolute same-origin URL: the BFF drops the query from a bare path and falls back to /dashboard.
    await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/auth\/oauth\/user\/stepup\?return_to=http/)));
  });

  it('moves the security gates on the status words the BFF really sends', async () => {
    const run = (authorize) => vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(url === '/api/agent/invoke'
      ? { ok: true, status: 200, json: async () => ({ success: true, reply: 'Done.', tokenEvents: [
        { id: 'personal-agent-lookup', status: 'active' },
        { id: 'gw-introspection', status: 'valid' },
        { id: 'gw-authorize', status: authorize },
      ] }) }
      : { ok: false, status: 401, json: async () => ({}) })));
    run('permit');
    renderWorkload();
    expect(screen.getAllByText('WAITING')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    await waitFor(() => expect(screen.getAllByText('PERMIT')).toHaveLength(3));
    // A held call (human approval, step-up) is neither permit nor deny.
    run('indeterminate');
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    await waitFor(() => expect(screen.getAllByText('PERMIT')).toHaveLength(2));
    expect(screen.getByText('CHECKING…')).toBeTruthy();
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

  it.each([
    ['unmounted error', true, false],
    ['retained error', false, false],
    ['retained success', false, true],
  ])('ignores a late %s after switching scenarios', async (_label, keyed, lateSuccess) => {
    const pending = {};
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      if (url !== '/api/agent/invoke') return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
      const { useCaseId } = JSON.parse(options.body);
      return new Promise((resolve) => { pending[useCaseId] = resolve; });
    }));
    render(<MemoryRouter>
      <TokenChainProvider activePath="/workload-agents">
        <EvidenceProbe />
        <SwitchingWorkload keyed={keyed} />
      </TokenChainProvider>
    </MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Run UC38 action' }));
    expect(pending['personal-agent-concierge']).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: 'Switch scenario' }));
    expect(screen.getByRole('button', { name: 'Run UC44 action' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    await act(async () => {
      pending['workload-digital-assistant-obo']({ ok: true, json: async () => ({ reply: 'B reply', tokenEvents: [{ id: 'b-event', status: 'success' }] }) });
    });
    expect(await screen.findByText('B reply')).toBeTruthy();
    expect(screen.getByTestId('live-token-events')).toHaveTextContent('b-event');

    // The mock deliberately resolves A even if production aborts its fetch.
    await act(async () => {
      pending['personal-agent-concierge'](lateSuccess
        ? { ok: true, json: async () => ({ reply: 'A late reply', tokenEvents: [{ id: 'a-event', status: 'success' }] }) }
        : { ok: false, status: 428, json: async () => ({ message: 'A late error', tokenEvents: [{ id: 'a-event', status: 'required' }] }) });
    });
    expect(screen.getByTestId('live-token-events')).not.toHaveTextContent('a-event');
    expect(tokenChainTraceStore.getState().trace.tokenEvents.map((event) => event.id)).toContain('b-event');
    expect(tokenChainTraceStore.getState().trace.tokenEvents.map((event) => event.id)).not.toContain('a-event');
    expect(screen.getByText('B reply')).toBeTruthy();
    expect(screen.queryByText('A late error')).toBeNull();
    expect(screen.queryByText('A late reply')).toBeNull();
  });
});
