import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrivilegeA2aTab from '../PrivilegeA2aTab';

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrivilegeA2aTab', () => {
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
    const user = userEvent.setup();
    render(<PrivilegeA2aTab />);

    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Review Carol Nguyen');
    await user.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText('Carol has an expired admin grant.')).toBeTruthy();
    expect(screen.getByText('Main agent delegated to analyst')).toBeTruthy();
    expect(global.fetch.mock.calls[0][0]).toBe('/api/privilege-a2a/chat');
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    });
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ message: 'Review Carol Nguyen' });

    await user.type(screen.getByRole('textbox', { name: 'Your question' }), 'Is it still active?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await screen.findByText('The grant remains active.');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({
      message: 'Is it still active?',
      sessionId: 'opaque-session-42',
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
});
