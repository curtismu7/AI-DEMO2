import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Stub window.location.search
Object.defineProperty(window, 'location', {
  writable: true,
  value: { search: '?skin=privilege&theme=dark' },
});

import PersonalAgentClientWindow from '../PersonalAgentClientWindow';

describe('PersonalAgentClientWindow', () => {
  beforeEach(() => {
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
        useCaseId: 'workload-digital-assistant-obo',
      }),
    })));
  });
});
