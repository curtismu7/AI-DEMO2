import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PersonalAgentStudioPage from '../PersonalAgentStudioPage';
import { TokenChainProvider } from '../../context/TokenChainContext';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';

// consentGate is optional and only guards the visible "Run <id> action" button: the run-nonce effect, the MFA
// return and the HITL re-run are continuations of a run someone already agreed to and must not ask again.
const scenario = {
  id: 'UC38',
  title: 'MFA-gated protected action',
  useCaseId: 'personal-agent-concierge',
  primaryTool: 'pay_tuition_balance',
  runPrompt: 'pay $600 tuition',
};

function renderStudio(props = {}) {
  render(<MemoryRouter>
    <TokenChainProvider activePath="/digital-worker">
      <PersonalAgentStudioPage scenario={scenario} vertical="banking" {...props} />
    </TokenChainProvider>
  </MemoryRouter>);
}

const invokeCalls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => url === '/api/agent/invoke');

let fetchMock;
beforeEach(() => {
  localStorage.clear();
  tokenChainTraceStore.reset();
  fetchMock = vi.fn((url) => Promise.resolve(url === '/api/agent/invoke'
    ? { ok: true, status: 200, json: async () => ({ success: true, reply: 'Paid.' }) }
    : { ok: false, status: 401, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('PersonalAgentStudioPage consentGate', () => {
  it('runs straight away when no gate is passed (every other page)', async () => {
    renderStudio();
    fireEvent.click(screen.getByRole('button', { name: 'Run tuition payment' }));
    expect(await screen.findByText('Paid.')).toBeTruthy();
    expect(invokeCalls(fetchMock)).toHaveLength(1);
  });

  it('asks the gate with the scenario and runs once it says yes', async () => {
    const consentGate = vi.fn().mockResolvedValue(true);
    renderStudio({ consentGate });
    fireEvent.click(screen.getByRole('button', { name: 'Run tuition payment' }));
    expect(await screen.findByText('Paid.')).toBeTruthy();
    expect(consentGate).toHaveBeenCalledTimes(1);
    expect(consentGate).toHaveBeenCalledWith(expect.objectContaining({ id: 'UC38', runPrompt: 'pay $600 tuition' }));
    expect(invokeCalls(fetchMock)).toHaveLength(1);
  });

  it('does not run when the gate says no', async () => {
    const consentGate = vi.fn().mockResolvedValue(false);
    renderStudio({ consentGate });
    fireEvent.click(screen.getByRole('button', { name: 'Run tuition payment' }));
    await waitFor(() => expect(consentGate).toHaveBeenCalledTimes(1));
    await Promise.resolve(); // let the awaited gate settle before asserting the absence of a run
    expect(invokeCalls(fetchMock)).toHaveLength(0);
    expect(screen.queryByText('Paid.')).toBeNull();
  });

  it('does not ask again for a run-nonce continuation', async () => {
    const consentGate = vi.fn().mockResolvedValue(false);
    renderStudio({ consentGate, runNonce: 1 });
    expect(await screen.findByText('Paid.')).toBeTruthy();
    expect(consentGate).not.toHaveBeenCalled();
  });
});
