import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: 'healthcare', pageManifest: { dashboard: { chips10: [{ id: 'h1', label: 'My claims', message: 'Show my open claims' }] } } }) }));
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
import apiClient from '../../services/apiClient';
// The real modal runs PingOne's challenge; here it only needs to show up and report completion.
vi.mock('../../components/OtpStepUpModal', () => ({
  default: ({ show, daId, onP1MfaComplete }) => (show
    ? <div role="dialog" aria-label="MFA"><span data-testid="mfa-da">{daId}</span><button type="button" onClick={onP1MfaComplete}>Complete MFA</button></div>
    : null),
}));

// Stub window.location.search
Object.defineProperty(window, 'location', {
  writable: true,
  value: { search: '?skin=privilege&theme=dark' },
});

import PersonalAgentClientWindow from '../PersonalAgentClientWindow';

describe('PersonalAgentClientWindow', () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.search = '?skin=privilege&theme=dark';
    apiClient.get.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Delegated action complete.' }),
    }));
  });

  it('renders without nav shell', () => {
    const { container } = render(<PersonalAgentClientWindow />);
    // No AdminSideNav — check nav element absent
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders Privilege AI Agent title for skin=privilege', () => {
    render(<PersonalAgentClientWindow />);
    expect(screen.getByText('Privilege AI Agent')).toBeTruthy();
  });

  it('renders live badge', () => {
    render(<PersonalAgentClientWindow />);
    expect(screen.getByText(/Live/i)).toBeTruthy();
  });

  it('Dot opens with the active vertical\'s chips; clicking one sends its prompt with that vertical', async () => {
    window.location.search = '?skin=dot&theme=dark';
    render(<PersonalAgentClientWindow />);
    expect(screen.queryByRole('button', { name: 'Always book me an aisle seat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'My claims' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: expect.stringContaining('"vertical":"healthcare"'),
    })));
    expect(fetch.mock.calls.at(-1)[1].body).toContain('Show my open claims');
  });

  it('other skins show no suggested prompts', () => {
    render(<PersonalAgentClientWindow />);
    expect(screen.queryByRole('group', { name: /suggested prompts/i })).toBeNull();
  });

  it('sends the page\'s own Heuristics choice, remembered under the personal-agent key', async () => {
    render(<PersonalAgentClientWindow />);
    fireEvent.click(screen.getByRole('radio', { name: 'Heuristics' }));
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'check my miles' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'check my miles', vertical: 'airlines', agentMode: 'heuristics' }),
    })));
    expect(localStorage.getItem('agentMode:personal-agent')).toBe('heuristics');
    expect(localStorage.getItem('agentMode:demo-track')).toBeNull();
  });

  it('sends the Digital Assistant request through the real invoke route', async () => {
    render(<PersonalAgentClientWindow />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'check my miles' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        prompt: 'check my miles',
        vertical: 'airlines',
        agentMode: 'heuristics',
      }),
    })));
    expect(await screen.findByText('Delegated action complete.')).toBeTruthy();
  });

  it('uses the catalog prompt and selected context in a workload pop-out', async () => {
    window.location.search = '?skin=privilege&theme=dark&useCase=UC38&vertical=sporting-goods';
    apiClient.get.mockResolvedValue({ data: { useCase: {
      id: 'UC38', title: 'Workload Agent: MFA-gated protected action', useCaseId: 'personal-agent-concierge',
      primaryTool: 'extend_rental', runPrompt: 'extend my rental $600',
    } } });
    render(<PersonalAgentClientWindow />);
    fireEvent.click(await screen.findByRole('button', { name: /Run UC38 action/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'extend my rental $600', vertical: 'sporting-goods', useCaseId: 'personal-agent-concierge', agentMode: 'heuristics' }),
    })));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('428 consent required: starts PingOne MFA, then retries the same prompt once', async () => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (url === '/api/auth/mfa/challenge') return { ok: true, status: 200, json: async () => ({ daId: 'da-9', devices: [] }) };
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) return { ok: false, status: 428, json: async () => ({ requiresConsent: true, message: 'Needs approval.' }) };
      return { ok: true, status: 200, json: async () => ({ reply: 'Transfer complete.' }) };
    }));
    render(<PersonalAgentClientWindow />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'transfer miles' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText(/Needs approval\..*Verify with PingOne MFA/s)).toBeTruthy();
    expect(await screen.findByRole('dialog', { name: 'MFA' })).toBeTruthy();
    expect(screen.getByTestId('mfa-da').textContent).toBe('da-9');

    fireEvent.click(screen.getByText('Complete MFA'));

    expect(await screen.findByText('Transfer complete.')).toBeTruthy();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].prompt).toBe('transfer miles');
    expect(screen.queryByRole('dialog', { name: 'MFA' })).toBeNull();
    expect(screen.getAllByText('transfer miles')).toHaveLength(1);
  });
});
