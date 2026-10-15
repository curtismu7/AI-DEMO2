import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../context/TokenChainContext', () => ({ useTokenChainOptional: () => ({ events: [] }) }));
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
// The real modal runs PingOne's challenge; here it only needs to show up and report completion.
vi.mock('../../components/OtpStepUpModal', () => ({
  default: ({ show, daId, contextLine, onP1MfaComplete, onCancel }) => (show
    ? <div role="dialog" aria-label="MFA">
      <span data-testid="mfa-da">{daId}</span><span data-testid="mfa-context">{contextLine}</span>
      <button type="button" onClick={onP1MfaComplete}>Complete MFA</button>
      <button type="button" onClick={onCancel}>Cancel MFA</button>
    </div>
    : null),
}));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';

const sendFreeform = (text) => {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('PersonalAgentStudioPage: 428 consent required starts PingOne MFA, then asks again', () => {
  beforeEach(() => { localStorage.clear(); });

  it('shows the consent message, opens the MFA challenge, and retries the same prompt once MFA completes', async () => {
    const invokeBodies = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (url === '/api/auth/mfa/challenge') return { ok: true, status: 200, json: async () => ({ daId: 'da-1', devices: [] }) };
      invokeBodies.push(JSON.parse(init.body));
      if (invokeBodies.length === 1) {
        return { ok: false, status: 428, json: async () => ({ requiresConsent: true, stepUp: 'p1mfa', message: "Intent 'transfer' requires HITL consent (policy rule)" }) };
      }
      return { ok: true, status: 200, json: async () => ({ reply: 'Transfer complete.' }) };
    }));
    render(<MemoryRouter><PersonalAgentStudioPage /></MemoryRouter>);

    sendFreeform('Transfer 20000 of my miles to my brother');

    expect(await screen.findByText(/requires HITL consent.*Verify with PingOne MFA to continue/s)).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'MFA' })).toBeTruthy();
    expect(screen.getByTestId('mfa-da').textContent).toBe('da-1');
    expect(screen.getByTestId('mfa-context').textContent).toBe('Transfer 20000 of my miles to my brother');
    expect(invokeBodies).toHaveLength(1);

    fireEvent.click(screen.getByText('Complete MFA'));

    expect(await screen.findByText('Transfer complete.')).toBeTruthy();
    expect(invokeBodies).toHaveLength(2);
    expect(invokeBodies[1].prompt).toBe('Transfer 20000 of my miles to my brother');
    expect(screen.queryByRole('dialog', { name: 'MFA' })).toBeNull();
    // the user's question appears once, not again for the retry
    expect(screen.getAllByText('Transfer 20000 of my miles to my brother')).toHaveLength(1);
  });

  it('cancelling MFA closes it, keeps the consent message, and does not ask again', async () => {
    const invokes = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (url === '/api/auth/mfa/challenge') return { ok: true, status: 200, json: async () => ({ daId: 'da-2', devices: [] }) };
      if (url === '/api/agent/invoke') invokes.push(JSON.parse(init.body));
      return { ok: false, status: 428, json: async () => ({ requiresConsent: true, message: 'Needs approval' }) };
    }));
    render(<MemoryRouter><PersonalAgentStudioPage /></MemoryRouter>);
    sendFreeform('Transfer 20000 of my miles');
    await screen.findByRole('dialog', { name: 'MFA' });

    fireEvent.click(screen.getByText('Cancel MFA'));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'MFA' })).toBeNull());
    expect(screen.getByText(/Needs approval.*Verify with PingOne MFA/s)).toBeTruthy();
    expect(invokes).toHaveLength(1);
  });

  it('if the MFA challenge cannot be started, says so instead of hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/auth/mfa/challenge') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: false, status: 428, json: async () => ({ requiresConsent: true, message: 'Needs approval' }) };
    }));
    render(<MemoryRouter><PersonalAgentStudioPage /></MemoryRouter>);
    sendFreeform('Transfer 20000 of my miles');
    expect(await screen.findByText(/MFA could not be started/)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'MFA' })).toBeNull();
  });
});
