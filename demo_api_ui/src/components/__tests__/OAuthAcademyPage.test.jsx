import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const toggleDarkMode = vi.fn();
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode }),
}));

const setTokenEvents = vi.fn();
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ setTokenEvents }),
}));

const sendAgentMessage = vi.fn();
vi.mock('../../services/demoAgentService', () => ({
  sendAgentMessage: (...a) => sendAgentMessage(...a),
}));

const navigateToCustomerOAuthLogin = vi.fn();
vi.mock('../../utils/authUi', () => ({
  navigateToCustomerOAuthLogin: (...a) => navigateToCustomerOAuthLogin(...a),
}));

// The rail and the consent dialog are shared components with their own tests: the page's wiring is what is under test.
vi.mock('../TokenChainTraceRail', () => ({ default: () => <div data-testid="rail-stub" /> }));
vi.mock('../AgentConsentModal', () => ({
  default: ({ hitlContext, onAccept, onDismiss }) => (
    <div role="dialog" aria-label="Authorize Agent Action" data-testid="consent-stub">
      <span>{hitlContext.tool}</span>
      <button type="button" onClick={onAccept}>Approve stub</button>
      <button type="button" onClick={onDismiss}>Dismiss stub</button>
    </div>
  ),
}));

import OAuthAcademyPage from '../OAuthAcademyPage';

const renderPage = () => render(<OAuthAcademyPage />);
const root = (c) => c.querySelector('.oauth-academy-page');
const primaries = (c) => [...c.querySelectorAll('.pu-btn--primary')].map((b) => b.textContent.trim());
const status = () => screen.getByTestId('oa-status').textContent.trim();
const input = () => screen.getByLabelText(/ask the oauth teacher a question/i);
const topic = (name) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
});

describe('OAuthAcademyPage (Ping UI Standard)', () => {
  it('puts an honest live-agent banner first, as a note, naming the real endpoint and the sign-in need', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(root(container).classList.contains('pu-page')).toBe(true);
    expect(root(container).firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/\/api\/agent\/invoke/);
    expect(banner.textContent).toMatch(/oauth-teaching/);
    expect(banner.textContent).toMatch(/need you signed in/i);
    expect(banner.textContent).toMatch(/does not know which/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OAuth Academy');
  });

  it('has frame sections, cards, a kv list and word-bearing chips', () => {
    const { container } = renderPage();
    expect(container.querySelector('.pu-frame')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Ask the teacher',
      'Starter questions',
      'Live token flow',
      'What this page calls',
    ]);
    expect(container.querySelectorAll('.pu-card').length).toBe(3);
    expect(screen.getByTestId('oa-wiring').querySelector('dl.pu-kv')).not.toBeNull();
    const chips = [...container.querySelectorAll('.pu-chip')].map((c) => c.textContent.trim());
    expect(chips).toEqual(['Ready', 'Waiting for a demonstration']);
  });

  it('idle: exactly one primary (Send), every other button a secondary, nothing natively disabled', () => {
    const { container } = renderPage();
    expect(primaries(container)).toEqual(['Send']);
    container.querySelectorAll('button').forEach((b) => {
      expect(b.className).toContain('pu-btn');
      expect(b.disabled).toBe(false);
    });
    // empty box: Send keeps focus but cannot act
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelectorAll('.oa-topic')).toHaveLength(12);
  });

  it('the conversation is a labelled, keyboard-reachable live log; the input has an accessible name', async () => {
    renderPage();
    sendAgentMessage.mockResolvedValueOnce({ reply: 'OAuth is a delegation framework.' });
    await userEvent.type(input(), 'what is oauth{Enter}');
    const log = await screen.findByRole('log', { name: /conversation with the oauth teacher/i });
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('tabindex')).toBe('0');
    expect(log.textContent).toContain('OAuth is a delegation framework.');
  });

  it('sends pinned to the oauth-teaching vertical and keeps focus where it was while the agent works', async () => {
    let resolve;
    sendAgentMessage.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { container } = renderPage();
    const box = input();
    box.focus();
    await userEvent.type(box, 'what is oauth{Enter}');

    expect(sendAgentMessage).toHaveBeenCalledWith(
      'what is oauth',
      null,
      expect.objectContaining({ vertical: 'oauth-teaching', forceHeuristic: true }),
    );
    // working: same Send element is now Stop and is the one primary; the input is read-only, not disabled
    expect(status()).toBe('Waiting for the agent');
    expect(primaries(container)).toEqual(['Stop']);
    expect(box.disabled).toBe(false);
    expect(box.readOnly).toBe(true);
    expect(document.activeElement).toBe(box);
    // topics are paused with a visible reason, and stay focusable
    expect(screen.getByTestId('oa-topics-paused').textContent).toMatch(/paused while the agent answers/i);
    expect(topic('explain refresh tokens').getAttribute('aria-disabled')).toBe('true');
    expect(topic('explain refresh tokens').disabled).toBe(false);

    await act(async () => { resolve({ reply: 'done' }); });
    await waitFor(() => expect(status()).toBe('Answered'));
    expect(primaries(container)).toEqual(['Send']);
    expect(document.activeElement).toBe(box);
  });

  it('a starter question keeps keyboard focus on its button after it is pressed', async () => {
    let resolve;
    sendAgentMessage.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    renderPage();
    const chip = topic('explain scopes and least privilege');
    chip.focus();
    await userEvent.keyboard('{Enter}');
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(chip);
    // a second press while busy does nothing
    await userEvent.keyboard('{Enter}');
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ reply: 'ok' }); });
    expect(document.activeElement).toBe(chip);
  });

  it('Stop aborts the request and says Stopped', async () => {
    sendAgentMessage.mockImplementationOnce((_q, _c, { signal }) => new Promise((_res, rej) => {
      signal.addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; rej(e); });
    }));
    renderPage();
    await userEvent.type(input(), 'what is oauth{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(status()).toBe('Stopped'));
    expect(screen.getByRole('log').textContent).toMatch(/Stopped — ask again/);
  });

  it('signed out: the sign-in prompt becomes the one primary, Send steps back, and the chip says so', async () => {
    sendAgentMessage.mockResolvedValueOnce({ _status: 401, need_auth: true });
    const { container } = renderPage();
    await userEvent.type(input(), 'demonstrate a real token exchange{Enter}');
    await waitFor(() => expect(status()).toBe('Sign-in needed'));
    expect(primaries(container)).toEqual(['Sign in']);
    expect(screen.getByRole('button', { name: 'Send' }).className).not.toContain('primary');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(navigateToCustomerOAuthLogin).toHaveBeenCalledWith('/oauth-academy');
    // asking again hands the primary back to Send/Stop and an older Sign in is only a secondary
    sendAgentMessage.mockResolvedValueOnce({ reply: 'Fine.' });
    await userEvent.type(input(), 'what is oauth{Enter}');
    await waitFor(() => expect(status()).toBe('Answered'));
    expect(primaries(container)).toEqual(['Send']);
  });

  it('approval flow: no page primary while the dialog is open; cancel and approve both end cleanly', async () => {
    const challenge = { reply: 'Over the threshold.', error: 'hitl_required', hitlChallengeId: 'c-1', action: 'demonstrate_hitl' };
    sendAgentMessage.mockResolvedValueOnce(challenge);
    const { container } = renderPage();
    await userEvent.click(topic('demonstrate hitl approval'));
    await screen.findByTestId('consent-stub');
    expect(status()).toBe('Approval needed');
    expect(primaries(container)).toEqual([]);
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('oa-topics-paused').textContent).toMatch(/until you answer the approval dialog/i);

    // cancel
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss stub' }));
    expect(screen.queryByTestId('consent-stub')).toBeNull();
    expect(status()).toBe('Approval cancelled');
    expect(primaries(container)).toEqual(['Send']);
    expect(screen.getByRole('log').textContent).toMatch(/no money moved/);

    // ask again and approve: the approval is recorded, then the question is retried carrying the challenge id
    sendAgentMessage.mockResolvedValueOnce(challenge);
    await userEvent.click(topic('demonstrate hitl approval'));
    await screen.findByTestId('consent-stub');
    sendAgentMessage.mockResolvedValueOnce({ reply: 'Transfer permitted.', tokenEvents: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    await userEvent.click(screen.getByRole('button', { name: 'Approve stub' }));
    await waitFor(() => expect(status()).toBe('Answered'));
    expect(global.fetch).toHaveBeenCalledWith('/api/mcp/decision/c-1/approve', expect.objectContaining({ method: 'POST' }));
    expect(sendAgentMessage).toHaveBeenLastCalledWith(
      'demonstrate hitl approval',
      null,
      expect.objectContaining({ hitlChallengeId: 'c-1', consentGiven: true, forceHeuristic: true }),
    );
    expect(setTokenEvents).toHaveBeenCalledWith('oauth-academy', [{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(screen.getByTestId('oa-token-chain').textContent).toContain('3 token events received');
  });

  it('a failed approval says so with a danger chip', async () => {
    sendAgentMessage.mockResolvedValueOnce({ reply: 'x', error: 'hitl_required', hitlChallengeId: 'c-2' });
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ message: 'nope' }) }));
    renderPage();
    await userEvent.click(topic('demonstrate hitl approval'));
    await screen.findByTestId('consent-stub');
    await userEvent.click(screen.getByRole('button', { name: 'Approve stub' }));
    await waitFor(() => expect(status()).toBe('Last request failed'));
    expect(screen.getByRole('log').textContent).toContain('Failed to approve: nope');
    expect(screen.getByTestId('oa-status').querySelector('.pu-chip--danger')).not.toBeNull();
  });

  it('an unreachable agent is a danger chip, not a silent blank', async () => {
    sendAgentMessage.mockRejectedValueOnce(new Error('network'));
    renderPage();
    await userEvent.type(input(), 'what is oauth{Enter}');
    await waitFor(() => expect(status()).toBe('Last request failed'));
    expect(screen.getByRole('log').textContent).toMatch(/Failed to reach the OAuth Academy agent/);
  });

  it('Clear empties the conversation and returns focus to the input instead of dropping it', async () => {
    sendAgentMessage.mockResolvedValueOnce({ reply: 'hello', tokenEvents: [{ id: 1 }] });
    renderPage();
    await userEvent.type(input(), 'what is oauth{Enter}');
    await waitFor(() => expect(status()).toBe('Answered'));
    const clear = screen.getByRole('button', { name: 'Clear' });
    clear.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('log')).toBeNull();
    expect(status()).toBe('Ready');
    expect(document.activeElement).toBe(input());
    expect(screen.getByTestId('oa-token-chain').textContent).toContain('Waiting for a demonstration');
  });

  it('keeps the theme toggle as an aria-pressed secondary', () => {
    renderPage();
    const t = screen.getByRole('button', { name: /dark mode/i });
    expect(t.getAttribute('aria-pressed')).toBe('false');
    expect(t.className).not.toContain('primary');
    fireEvent.click(t);
    expect(toggleDarkMode).toHaveBeenCalled();
  });
});
