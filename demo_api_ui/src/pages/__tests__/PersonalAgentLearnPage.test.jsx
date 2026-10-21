import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockEvents = [];
const mockSetTokenEvents = vi.fn((tool, evs) => { mockEvents = evs; });
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ events: mockEvents, setTokenEvents: mockSetTokenEvents }),
}));
vi.mock('../../context/ThemeContext', () => ({ useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }) }));
vi.mock('../../utils/signInService', () => ({ openSignIn: vi.fn() }));
vi.mock('../../components/TokenChainFilmstrip', () => ({ default: () => <div data-testid="filmstrip" /> }));
vi.mock('../../components/OtpStepUpModal', () => ({ default: ({ show }) => (show ? <div data-testid="mfa-modal" /> : null) }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({ tokenChainTraceStore: { beginTrace: vi.fn() } }));
import { openSignIn } from '../../utils/signInService';
import PersonalAgentLearnPage from '../PersonalAgentLearnPage';

const PERMIT = [{ id: 'personal-agent-lookup', status: 'active' }, { id: 'gw-introspection', status: 'valid' }, { id: 'gw-authorize', status: 'permit' }];
const DENY = [{ id: 'personal-agent-lookup', status: 'active' }, { id: 'gw-introspection', status: 'valid' }, { id: 'gw-authorize', status: 'deny' }];
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const renderPage = (user = { email: 'sam@x.com' }) => render(<MemoryRouter><PersonalAgentLearnPage user={user} /></MemoryRouter>);
const lesson = (name) => screen.getByRole('button', { name: new RegExp(name, 'i') });

beforeEach(() => { mockEvents = []; mockSetTokenEvents.mockClear(); openSignIn.mockClear(); localStorage.clear(); });
afterEach(cleanup);

describe('PersonalAgentLearnPage', () => {
  it('shows the path, the three real gates and the reel', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Personal agent studio' })).toBeTruthy();
    expect(screen.getByText('Run a simple request')).toBeTruthy();
    expect(screen.getByText('Ask for something sensitive')).toBeTruthy();
    expect(screen.getByText('Go over your limit')).toBeTruthy();
    ['Signed in with MFA', 'Gateway token check', 'PingOne Authorize'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
    expect(screen.getByTestId('filmstrip')).toBeTruthy();
    expect(screen.getByTestId('learn-progress').textContent).toBe('0 of 3 complete');
  });

  it('Learn mode controls whether the "why it matters" lines show', () => {
    const { container } = renderPage();
    expect(container.querySelector('.pal-grid').classList.contains('is-learn')).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Learn mode' }));
    expect(container.querySelector('.pal-grid').classList.contains('is-learn')).toBe(false);
  });

  it('signed out: a prompt opens sign-in and never calls the agent', () => {
    global.fetch = vi.fn();
    renderPage(null);
    expect(screen.getByRole('status').textContent).toMatch(/not signed in/i);
    fireEvent.click(lesson('Run a simple request'));
    expect(openSignIn).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('runs the real agent with the lesson prompt, then explains an allowed run from the real gates', async () => {
    global.fetch = vi.fn(async () => { mockEvents = PERMIT; return json(200, { reply: 'You are Gold.', success: true, toolsCalled: ['get_loyalty_status'], tokenEvents: PERMIT }); });
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('You are Gold.');
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/agent/invoke'));
    expect(JSON.parse(call[1].body)).toMatchObject({ prompt: 'What is my loyalty status?', vertical: 'airlines' });
    await waitFor(() => expect(screen.getByTestId('learn-summary').textContent).toMatch(/^Allowed/));
    expect(screen.getByTestId('learn-progress').textContent).toBe('1 of 3 complete');
    expect(within(screen.getByTestId('gate-authz')).getByText('PERMIT')).toBeTruthy();
  });

  it('a gate that says deny is explained as a refusal at that gate', async () => {
    global.fetch = vi.fn(async () => json(200, { reply: 'Not allowed.', success: false, toolsCalled: ['pay_airline_fee'], tokenEvents: DENY }));
    renderPage();
    fireEvent.click(lesson('Go over your limit'));
    await screen.findByText('Not allowed.');
    await waitFor(() => expect(screen.getByTestId('learn-summary').textContent).toMatch(/Refused at "PingOne Authorize"/));
    expect(screen.getByTestId('gate-authz').dataset.s).toBe('deny');
  });

  it('a 428 consent response is Held (not refused) and starts the MFA challenge', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/mfa/challenge')) return json(200, { daId: 'da1', devices: [] });
      return json(428, { requiresConsent: true, message: 'This needs your approval.' });
    });
    renderPage();
    fireEvent.click(lesson('Ask for something sensitive'));
    await waitFor(() => expect(screen.getByTestId('learn-summary').textContent).toMatch(/^Held, not refused/));
    await screen.findByTestId('mfa-modal');
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/api/auth/mfa/challenge'))).toBe(true);
  });

  it('a failed request is reported, not silently dropped', async () => {
    global.fetch = vi.fn(async () => json(500, { message: 'Boom' }));
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('Boom');
    expect(screen.getByTestId('learn-summary').textContent).toMatch(/did not complete/i);
    expect(screen.getByTestId('learn-progress').textContent).toBe('0 of 3 complete');
  });
});
