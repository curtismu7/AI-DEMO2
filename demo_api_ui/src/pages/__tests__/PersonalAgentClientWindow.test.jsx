import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
import apiClient from '../../services/apiClient';

// Stub window.location.search
Object.defineProperty(window, 'location', {
  writable: true,
  value: { search: '?skin=privilege&theme=dark' },
});

import PersonalAgentClientWindow from '../PersonalAgentClientWindow';

describe('PersonalAgentClientWindow', () => {
  beforeEach(() => {
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
      body: JSON.stringify({ prompt: 'extend my rental $600', vertical: 'sporting-goods', useCaseId: 'personal-agent-concierge' }),
    })));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
