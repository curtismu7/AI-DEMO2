import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.queryByRole('option', { name: 'Review access on prod-db-primary.' })).toBeNull();
  });

  test('falls back to the generic questions with no profile', async () => {
    render(<PrivilegeA2aTab />);
    expect(await screen.findByRole('option', { name: 'Review access on prod-db-primary.' })).toBeTruthy();
  });

  test('runs through the BFF and hands the run to the floating agent as Step 25A, carrying the session ID forward', async () => {
    global.fetch
      .mockResolvedValueOnce(streamResponse([
        { event: 'token', data: { text: 'Carol has an expired admin grant.' } },
        { event: 'done', data: { sessionId: 'opaque-session-42' } },
      ]))
      .mockResolvedValueOnce(streamResponse([{ event: 'done', data: { sessionId: 'opaque-session-42' } }]));
    const handoff = vi.fn();
    window.addEventListener('agent-demo-step-select', handoff);
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);

    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Review Carol Nguyen');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(handoff).toHaveBeenCalledTimes(1);
    const { uc, opts } = handoff.mock.calls[0][0].detail;
    expect(uc.useCaseId).toBe('privilege-a2a-access-review-agent');
    expect(opts.keepTrace).toBe(true);
    await expect(opts.run).resolves.toMatchObject({ ok: true, answer: 'Carol has an expired admin grant.' });
    expect(global.fetch.mock.calls[0][0]).toBe('/api/privilege-a2a/chat');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ message: 'Review Carol Nguyen' });

    const input = screen.getByRole('textbox', { name: 'Your question' });
    await waitFor(() => expect(input).not.toBeDisabled());
    await user.type(input, 'Is it still active?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ message: 'Is it still active?', sessionId: 'opaque-session-42' });
    window.removeEventListener('agent-demo-step-select', handoff);
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
