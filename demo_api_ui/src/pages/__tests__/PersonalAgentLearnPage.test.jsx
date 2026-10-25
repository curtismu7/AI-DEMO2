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
const traceStore = vi.hoisted(() => ({ beginTrace: vi.fn(), ingestTokenEvent: vi.fn(), ingestAuthorize: vi.fn(), ingestAuthorizeEvaluations: vi.fn(), completeTrace: vi.fn() }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({ tokenChainTraceStore: traceStore }));
vi.mock('../../services/mcpFlowSseClient', () => ({ openMcpFlowSse: vi.fn(() => vi.fn()) }));
import { openSignIn } from '../../utils/signInService';
import PersonalAgentLearnPage from '../PersonalAgentLearnPage';

const PERMIT = [{ id: 'personal-agent-lookup', status: 'active' }, { id: 'gw-introspection', status: 'valid' }, { id: 'gw-authorize', status: 'permit' }];
const DENY = [{ id: 'personal-agent-lookup', status: 'active' }, { id: 'gw-introspection', status: 'valid' }, { id: 'gw-authorize', status: 'deny' }];
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const renderPage = (user = { email: 'sam@x.com' }) => render(<MemoryRouter><PersonalAgentLearnPage user={user} /></MemoryRouter>);
const lesson = (name) => screen.getByRole('button', { name: new RegExp(name, 'i') });

beforeEach(() => { mockEvents = []; Object.values(traceStore).forEach((f) => f.mockClear()); mockSetTokenEvents.mockClear(); openSignIn.mockClear(); localStorage.clear(); });
afterEach(cleanup);

describe('PersonalAgentLearnPage', () => {
  it('shows the path, the three real gates and the reel', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Personal agent studio' })).toBeTruthy();
    expect(screen.getByText('Run a simple request')).toBeTruthy();
    expect(screen.getByText('Ask for something sensitive')).toBeTruthy();
    expect(screen.getByText('Go over your limit')).toBeTruthy();
    ['Signed in', 'Gateway token check', 'PingOne Authorize'].forEach((t) => expect(screen.getByText(t)).toBeTruthy());
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

  it('a plain read with no MFA event still passes the sign-in gate, and says MFA was not needed (not that it was done)', async () => {
    const NO_MFA = [{ id: 'gw-introspection', status: 'valid' }, { id: 'gw-authorize', status: 'permit' }];
    global.fetch = vi.fn(async () => { mockEvents = NO_MFA; return json(200, { reply: 'You are Gold.', success: true, toolsCalled: ['get_loyalty_status'], tokenEvents: NO_MFA }); });
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('You are Gold.');
    await waitFor(() => expect(screen.getByTestId('gate-mfa').dataset.s).toBe('permit'));
    expect(within(screen.getByTestId('gate-mfa')).getByText("Signed in as sam@x.com. MFA wasn't needed for this request.")).toBeTruthy();
    expect(screen.getByTestId('learn-summary').textContent).toMatch(/^Allowed/);
    expect(screen.queryByText(/with MFA/i)).toBeNull();
  });

  it('when an MFA event really reports, the gate says MFA verified', async () => {
    const WITH_MFA = [{ id: 'mfa', status: 'success' }, { id: 'gw-introspection', status: 'valid' }, { id: 'gw-authorize', status: 'permit' }];
    global.fetch = vi.fn(async () => { mockEvents = WITH_MFA; return json(200, { reply: 'Done.', success: true, toolsCalled: [], tokenEvents: WITH_MFA }); });
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('Done.');
    await waitFor(() => expect(within(screen.getByTestId('gate-mfa')).getByText('Signed in as sam@x.com, and MFA verified.')).toBeTruthy());
  });

  // The run must be traced end to end: an id on the request so the BFF streams every step (intent, agent token, exchange,
  // gateway introspection, Authorize, the tool, its result), and a completed trace so the reel does not stop at "in flight".
  it('sends a flowTraceId with the prompt, starts the trace with that id, and completes it OK on a normal reply', async () => {
    global.fetch = vi.fn(async () => json(200, { reply: 'You are Gold.', success: true, toolsCalled: ['get_loyalty_status'], tokenEvents: PERMIT }));
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('You are Gold.');
    const body = JSON.parse(global.fetch.mock.calls.find(([u]) => String(u).includes('/api/agent/invoke'))[1].body);
    expect(typeof body.flowTraceId).toBe('string');
    expect(traceStore.beginTrace).toHaveBeenCalledWith({ prompt: 'What is my loyalty status?', flowTraceId: body.flowTraceId });
    await waitFor(() => expect(traceStore.completeTrace).toHaveBeenCalledWith(true, body.flowTraceId, null));
  });

  it('a refusal completes the trace as NOT ok with the refusal as the reason', async () => {
    global.fetch = vi.fn(async () => json(200, { reply: 'Denied: tier ceiling.', success: false, toolsCalled: ['pay_airline_fee'], tokenEvents: DENY }));
    renderPage();
    fireEvent.click(lesson('Go over your limit'));
    await screen.findByText('Denied: tier ceiling.');
    await waitFor(() => expect(traceStore.completeTrace).toHaveBeenCalledWith(false, expect.any(String), 'Denied: tier ceiling.'));
  });

  it('feeds the authorize decision from the reply into the trace', async () => {
    global.fetch = vi.fn(async () => json(200, { reply: 'ok', success: true, toolsCalled: [], tokenEvents: PERMIT, mcpAuthorizeEvaluation: { decision: 'PERMIT' } }));
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('ok');
    expect(traceStore.ingestAuthorize).toHaveBeenCalledWith({ decision: 'PERMIT' }, expect.any(String));
  });

  it('a request held for MFA does not complete the trace (it is retried as a new run)', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/api/auth/mfa/challenge')) return json(200, { daId: 'da1', devices: [] });
      return json(428, { requiresConsent: true, message: 'This needs your approval.' });
    });
    renderPage();
    fireEvent.click(lesson('Ask for something sensitive'));
    await screen.findByTestId('mfa-modal');
    expect(traceStore.completeTrace).not.toHaveBeenCalled();
  });

  it('a failed request completes the trace as not ok', async () => {
    global.fetch = vi.fn(async () => json(500, { message: 'Boom' }));
    renderPage();
    fireEvent.click(lesson('Run a simple request'));
    await screen.findByText('Boom');
    await waitFor(() => expect(traceStore.completeTrace).toHaveBeenCalledWith(false, expect.any(String), 'Boom'));
  });

  it('a held action shows the approval, and Approve records the decision and runs the prompt again with the challenge', async () => {
    const held = { error: 'hitl_required', reply: 'Transaction requires human approval (HITL consent)', hitlChallengeId: 'chal-42', success: false, tokenEvents: [] };
    global.fetch = vi.fn(async (url) => {
      if (String(url).startsWith('/api/mcp/decision/')) return json(200, {});
      return json(200, global.fetch.mock.calls.length === 1 ? held : { reply: 'Here are your bookings.', success: true, toolsCalled: ['sensitive_account_details'], tokenEvents: [] });
    });
    renderPage();
    fireEvent.click(lesson('Ask for something sensitive'));
    const card = await screen.findByTestId('pal-approval');
    expect(within(card).getByText(/Simulated approval/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect(global.fetch.mock.calls[1][0]).toBe('/api/mcp/decision/chal-42/approve');
    expect(JSON.parse(global.fetch.mock.calls[2][1].body).hitlChallengeId).toBe('chal-42');
    await screen.findByText('Here are your bookings.');
  });

  it('Decline ends the held action without running it again', async () => {
    const held = { error: 'hitl_required', reply: 'held', hitlChallengeId: 'chal-7', success: false, tokenEvents: [] };
    global.fetch = vi.fn(async () => json(200, held));
    renderPage();
    fireEvent.click(lesson('Ask for something sensitive'));
    fireEvent.click(within(await screen.findByTestId('pal-approval')).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Declined. The action was not run.')).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
