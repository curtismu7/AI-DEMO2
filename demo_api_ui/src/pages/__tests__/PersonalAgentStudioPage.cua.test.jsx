// Computer Use Agent (CUA) — simulated scripted run (coverage plan row — MOCK):
// a "Computer Use" skin on the personal-agent studio whose scripted session walks
// the demo UI as a computer-use agent would — observe → act, each step labeled —
// through the SAME /api/agent/invoke path, so the token chain fires on the rail.
// Labeled "simulated" everywhere: nothing drives a real browser.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ events: [] }),
}));
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';

const renderStudio = () => render(
  <MemoryRouter>
    <PersonalAgentStudioPage />
  </MemoryRouter>,
);

describe('PersonalAgentStudioPage — CUA (simulated)', () => {
  it('offers a Computer Use skin', () => {
    renderStudio();
    expect(screen.getByText('Computer Use')).toBeTruthy();
  });

  it('switching to the CUA skin shows the scripted-session control', () => {
    renderStudio();
    fireEvent.click(screen.getByText('Computer Use'));
    expect(screen.getByText(/Run scripted session/i)).toBeTruthy();
    // The simulated marker is on the driver bar AND the skin hint — the session
    // must never read as a real browser-driving agent.
    expect(screen.getAllByText(/Simulated/i).length).toBeGreaterThanOrEqual(1);
  });

  it('running the scripted session sends CUA-labeled steps through the agent invoke', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Balance is $1,240.50.' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderStudio();
    fireEvent.click(screen.getByText('Computer Use'));
    fireEvent.click(screen.getByText(/Run scripted session/i));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([url]) => url === '/api/agent/invoke');
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
    const firstBody = JSON.parse(fetchMock.mock.calls.find(([url]) => url === '/api/agent/invoke')[1].body);
    expect(firstBody.vertical).toBe('airlines');
    expect(firstBody.prompt).toMatch(/\[CUA step/);
    // Each step is labeled on screen as a computer-use action.
    await waitFor(() => expect(screen.getAllByText(/\[CUA/).length).toBeGreaterThanOrEqual(2));
  });
});
