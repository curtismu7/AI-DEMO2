import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrivilegeA2aTab from '../PrivilegeA2aTab';
import apiClient from '../../../services/apiClient';

vi.mock('../../../services/apiClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: 'healthcare' }) }));

// The gateway record is read after a run through a separate door; keep it off
// the fetch mock these tests script, and let one test set what it returns.
const loadGatewayRecord = vi.hoisted(() => vi.fn());
vi.mock('../../../services/gatewayEvents', () => ({ GATEWAY_RECORD_SIGN_IN_PATH: '/llm-gateway', loadGatewayRecord }));

function streamResponse(events, leadingFrame = '') {
  const encoder = new TextEncoder();
  const body = leadingFrame + events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
  };
}

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
  apiClient.get.mockReset().mockResolvedValue({ data: { profile: null } });
  loadGatewayRecord.mockReset().mockResolvedValue({ state: 'ready', guardrail: [], modelCalls: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrivilegeA2aTab', () => {
  test('offers the vertical questions when a profile exists', async () => {
    apiClient.get.mockResolvedValue({ data: { profile: { vertical: 'healthcare', agentName: 'CareConnect agent', specialistName: 'Records Specialist', questions: ['Which patients have open referrals?', 'Q two', 'Q three'] } } });
    render(<PrivilegeA2aTab />);
    expect(await screen.findByRole('option', { name: 'Which patients have open referrals?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Which patients have open referrals?' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Review access on prod-db-primary.' })).toBeNull();
  });

  test('falls back to the generic questions with no profile', async () => {
    render(<PrivilegeA2aTab />);
    expect(await screen.findByRole('option', { name: 'Review access on prod-db-primary.' })).toBeTruthy();
  });

  test('the page toggle is per page: Heuristics rides on the chat request and is remembered', async () => {
    localStorage.clear();
    global.fetch.mockResolvedValueOnce(streamResponse([
      { event: 'token', data: { text: 'Done.' } },
      { event: 'done', data: { sessionId: 's' } },
    ]));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);

    await user.click(screen.getByRole('radio', { name: 'Heuristics' }));
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Review Carol');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText('Done.')).toBeTruthy();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).mode).toBe('heuristics');
    expect(localStorage.getItem('agentMode:privilege-a2a')).toBe('heuristics');
    expect(localStorage.getItem('agentMode:dashboard')).toBeNull();
  });

  test('"Open run details" is off until a run starts, then asks the agent for the sequence view', async () => {
    global.fetch.mockResolvedValueOnce(streamResponse([
      { event: 'token', data: { text: 'Done.' } },
      { event: 'done', data: { sessionId: 's1' } },
    ]));
    const opened = vi.fn();
    window.addEventListener('agent-evidence-open', opened);
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    const button = screen.getByRole('button', { name: 'Open run details' });
    expect(button).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Review Carol Nguyen');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByText('Done.')).toBeTruthy();
    expect(button).toBeEnabled();

    await user.click(button);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][0].detail).toEqual({ view: 'sequence-view' });
    window.removeEventListener('agent-evidence-open', opened);
  });

  test('the middle trace stays light (kind, text, route); a clicked step shows its JSON and timing in the right panel', async () => {
    global.fetch.mockResolvedValueOnce(streamResponse([
      { event: 'trace', data: { kind: 'delegate', from: 'main', to: 'analyst', fromLabel: 'Care Concierge', toLabel: 'Claims Analyst', text: 'concierge → analyst_agent', request: 'POST http://w/jsonrpc\n\n{"method":"message/send"}', response: 'HTTP 200\n\n{"result":{"kind":"message"}}', elapsedMs: 80 } },
      { event: 'token', data: { text: 'Done.' } },
      { event: 'done', data: { sessionId: 's' } },
    ]));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);

    await user.click(await screen.findByRole('button', { name: 'Review access on prod-db-primary.' }));

    const trace = within(await screen.findByRole('complementary', { name: 'Agent trace' }));
    expect(await trace.findByText('Care Concierge → Claims Analyst')).toBeTruthy();
    // no JSON or timing in the middle column
    expect(trace.queryByText('Request')).toBeNull();
    expect(trace.queryByText(/"method":"message\/send"/)).toBeNull();
    expect(trace.queryByText(/80 ms/)).toBeNull();

    const panel = within(screen.getByRole('complementary', { name: 'Step details' }));
    expect(panel.queryByText(/"method":"message\/send"/)).toBeNull();
    await user.click(trace.getByText('concierge → analyst_agent'));
    expect(panel.getByText(/"method":"message\/send"/)).toBeTruthy();
    expect(panel.getByText(/"kind":"message"/)).toBeTruthy();
    expect(panel.getByText('Care Concierge → Claims Analyst · 80 ms')).toBeTruthy();
  });

  test('clicking a suggested question runs it at once and hands it to the floating agent, no Send press', async () => {
    global.fetch.mockResolvedValueOnce(streamResponse([
      { event: 'token', data: { text: 'Done.' } },
      { event: 'done', data: { sessionId: 's' } },
    ]));
    const handoff = vi.fn();
    window.addEventListener('agent-demo-step-select', handoff);
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);

    await user.click(await screen.findByRole('button', { name: 'Review access on prod-db-primary.' }));

    expect(await screen.findByText('Done.')).toBeTruthy();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).message).toBe('Review access on prod-db-primary.');
    expect(handoff).toHaveBeenCalledTimes(1);
    window.removeEventListener('agent-demo-step-select', handoff);
  });

  test('submits through the same-origin BFF and carries the returned session ID forward', async () => {
    global.fetch
      .mockResolvedValueOnce(streamResponse([
        { event: 'trace', data: { kind: 'delegate', text: 'Main agent delegated to analyst' } },
        { event: 'token', data: { text: 'Carol has an expired admin grant.' } },
        { event: 'done', data: { sessionId: 'opaque-session-42' } },
      ]))
      .mockResolvedValueOnce(streamResponse([
        { event: 'token', data: { text: 'The grant remains active.' } },
        { event: 'done', data: { sessionId: 'opaque-session-42' } },
      ]));
    const handoff = vi.fn();
    window.addEventListener('agent-demo-step-select', handoff);
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);

    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Review Carol Nguyen');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText('Carol has an expired admin grant.')).toBeTruthy();
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(handoff.mock.calls[0][0].detail.uc.useCaseId).toBe('privilege-a2a-access-review-agent');
    window.removeEventListener('agent-demo-step-select', handoff);
    expect(screen.getByText('Main agent delegated to analyst')).toBeTruthy();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/privilege-a2a/chat');
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ message: 'Review Carol Nguyen', mode: 'llm' });

    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Is it still active?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText('The grant remains active.');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      message: 'Is it still active?',
      sessionId: 'opaque-session-42',
      mode: 'llm',
    });
  });

  test('shows normalized BFF and SSE errors without rendering model text as markup', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ error: 'A2A service unavailable' }) })
      .mockResolvedValueOnce(streamResponse([
        { event: 'token', data: { text: '<img src=x>review text' } },
        { event: 'error', data: { error: 'Worker access was denied' } },
      ], 'event: token\ndata: {malformed json\n\n'));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    const input = screen.getByRole('textbox', { name: 'Your question' });

    await user.type(input, 'Check access');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A2A service unavailable');

    await user.type(input, 'Try once more');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Worker access was denied');
    expect(screen.getByText('<img src=x>review text')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  test('disables repeat submit while the A2A stream is active', async () => {
    let resolveFetch;
    global.fetch.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Check access');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(screen.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
    resolveFetch(streamResponse([{ event: 'done', data: { sessionId: 'session-1' } }]));
    const input = screen.getByRole('textbox', { name: 'Your question' });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, 'A follow-up question');
    expect(screen.getByRole('button', { name: 'Send question' })).not.toBeDisabled();
  });

  test('cancels the browser stream when the user selects Cancel', async () => {
    global.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Check access');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    const signal = global.fetch.mock.calls[0][1].signal;

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(signal.aborted).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Request cancelled.');
  });

  test('shows the gateway record of the run: model calls with tokens and cost, and guardrail verdicts', async () => {
    loadGatewayRecord.mockResolvedValue({
      state: 'ready',
      modelCalls: [{ model: 'gemini-3.5-flash-lite', provider: 'google', status: 200, promptTokens: 100, completionTokens: 28, totalTokens: 128, costUsd: 0.0004995, latencyMs: 1285 }],
      guardrail: [{ event: 'mcp_response_sanitized', category: 'pii', client: 'worker-agent', rules: ['pii-email'], frameworks: [{ label: 'OWASP LLM', identifiers: ['LLM02'] }] }],
    });
    global.fetch.mockResolvedValueOnce(streamResponse([{ event: 'token', data: { text: 'Done.' } }, { event: 'done', data: {} }]));
    render(<PrivilegeA2aTab />);

    await userEvent.type(screen.getByLabelText('Your question'), 'Review access');
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText(/gemini-3\.5-flash-lite · 128 tokens \(100 in, 28 out\) · \$0\.000500 · 1285 ms · HTTP 200/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('mcp_response_sanitized · pii · worker-agent')).toBeInTheDocument();
    expect(screen.getByText(/OWASP LLM: LLM02/)).toBeInTheDocument();
  });

  test('says how to load the gateway record when its door is not signed in', async () => {
    loadGatewayRecord.mockResolvedValue({ state: 'needsAuth', guardrail: [], modelCalls: [] });
    global.fetch.mockResolvedValueOnce(streamResponse([{ event: 'done', data: {} }]));
    render(<PrivilegeA2aTab />);

    await userEvent.type(screen.getByLabelText('Your question'), 'Review access');
    await userEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByRole('link', { name: 'sign in to the gateway findings door' }, { timeout: 4000 })).toHaveAttribute('href', '/llm-gateway');
  });
});

describe('PrivilegeA2aTab token counts and the call picker', () => {
  test('a model step shows the tokens the agent reported, and the run total', async () => {
    global.fetch.mockResolvedValueOnce(streamResponse([
      { event: 'trace', data: { kind: 'model', from: 'main', to: 'main', text: 'main agent · gpt-oss-120b', tokens: { input: 412, output: 58 } } },
      { event: 'token', data: { text: 'Done.' } },
      { event: 'done', data: { sessionId: 's2' } },
    ]));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Review Carol Nguyen');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByText('Done.')).toBeTruthy();
    expect(screen.getAllByText('412 in · 58 out').length).toBeGreaterThan(0);
    expect(screen.getByText(/^1 model call · 412 in · 58 out tokens · ≈ \$0\.0014 at Claude Sonnet 5\.5 list price$/)).toBeTruthy();
  });

  test('the calls menu fills the question box without sending it', async () => {
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    await user.click(screen.getByRole('button', { name: /Calls/ }));
    const menu = screen.getByRole('listbox', { name: 'Calls you can make' });
    await user.click(within(menu).getByRole('option', { name: 'Who has the prod-db-admin role?' }));
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Who has the prod-db-admin role?');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('compact agent', () => {
  test('opens from the agent column and sends its question through the same path', async () => {
    global.fetch.mockResolvedValueOnce(streamResponse([
      { event: 'token', data: { text: 'Compact answer.' } },
      { event: 'done', data: { sessionId: 's3' } },
    ]));
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);
    await user.click(screen.getByRole('button', { name: 'Open the compact agent' }));
    const box = screen.getByRole('textbox', { name: 'Question for the compact agent' });
    await user.type(box, 'List all entitlements for Carol Nguyen.');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Compact answer.')).toBeTruthy();
  });
});
