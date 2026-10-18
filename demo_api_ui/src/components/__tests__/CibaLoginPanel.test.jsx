/** CibaLoginPanel — passwordless sign-in by approval link (email or SMS). */
import { render, screen, fireEvent, act } from '@testing-library/react';
import CibaLoginPanel from '../CibaLoginPanel';

const res = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const START = { authReqId: 'a'.repeat(48), matchCode: 'K7-42', expiresIn: 120, interval: 2 };

function setup({ start = () => res(START), poll = () => res({ status: 'pending' }), role = 'customer' } = {}) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/auth/ciba/login/start')) return start();
    if (String(url).includes('/api/auth/ciba/login/poll/')) return poll();
    return res({}, 404);
  });
  const props = { role, onSignedIn: vi.fn(), onUsePassword: vi.fn(), onBack: vi.fn() };
  const { unmount } = render(<CibaLoginPanel {...props} />);
  return { ...props, unmount };
}
const pollCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/poll/')).length;
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function toWaiting(channelLabel = 'Email') {
  fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: 'demo@x.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(await screen.findByRole('button', { name: channelLabel }));
  await flush();
}

describe('CibaLoginPanel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('identifier then BOTH channels always shown', () => {
    setup();
    fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text message' })).toBeInTheDocument();
  });

  test('start posts JSON with identifier, channel and role', async () => {
    setup({ role: 'admin' });
    await toWaiting('Text message');
    const [url, init] = global.fetch.mock.calls.find(([u]) => String(u).includes('/login/start'));
    expect(url).toContain('/api/auth/ciba/login/start');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ identifier: 'demo@x.com', channel: 'sms', role: 'admin' });
  });

  test('waiting screen shows the match code and the step-up wording', async () => {
    setup();
    await toWaiting('Email');
    expect(screen.getByText('K7-42')).toBeInTheDocument();
    expect(screen.getByText(
      'We sent an approval link by email. There is nothing to type: open the link, check the page shows match code K7-42, then tap Approve.',
    )).toBeInTheDocument();
  });

  test('pending keeps polling every interval; approved calls onSignedIn once and stops', async () => {
    let n = 0;
    const props = setup({ poll: () => res(++n < 3 ? { status: 'pending' } : { status: 'approved', redirectTo: '/cb?code=1' }) });
    await toWaiting();
    await flush(2000); await flush(2000); await flush(2000);
    expect(props.onSignedIn).toHaveBeenCalledTimes(1);
    expect(props.onSignedIn).toHaveBeenCalledWith('/cb?code=1');
    const calls = pollCalls();
    await flush(10000);
    expect(pollCalls()).toBe(calls);
  });

  test.each([[403, { status: 'denied' }], [410, { status: 'expired' }], [404, {}], [500, {}]])(
    'poll %s is terminal: error with retry, polling stops', async (status, body) => {
      const props = setup({ poll: () => res(body, status) });
      await toWaiting();
      await flush(2000);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      const calls = pollCalls();
      await flush(10000);
      expect(pollCalls()).toBe(calls);
      expect(props.onSignedIn).not.toHaveBeenCalled();
    });

  test('network errors are retried until the code expires', async () => {
    let n = 0;
    const props = setup({ poll: () => (++n < 3 ? Promise.reject(new Error('net')) : res({ status: 'approved', redirectTo: '/ok' })) });
    await toWaiting();
    await flush(2000); await flush(2000); await flush(2000);
    expect(props.onSignedIn).toHaveBeenCalledWith('/ok');
  });

  test('expires after expiresIn with a retry', async () => {
    setup();
    await toWaiting();
    await flush(125000);
    expect(screen.getByRole('alert')).toHaveTextContent(/expired/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('cancel stops polling', async () => {
    const props = setup();
    await toWaiting();
    await flush(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const calls = pollCalls();
    await flush(10000);
    expect(pollCalls()).toBe(calls);
    expect(props.onBack).toHaveBeenCalled();
  });

  test('unmount stops polling', async () => {
    const { unmount } = setup();
    await toWaiting();
    await flush(2000);
    unmount();
    const calls = pollCalls();
    await flush(10000);
    expect(pollCalls()).toBe(calls);
  });

  test('429 shows too many attempts', async () => {
    setup({ start: () => res({ error: 'rate_limited' }, 429) });
    await toWaiting();
    expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  test('503 provider_unsupported shows an unavailable message', async () => {
    setup({ start: () => res({ error: 'provider_unsupported' }, 503) });
    await toWaiting();
    expect(screen.getByRole('alert')).toHaveTextContent(/not available/i);
  });

  test('two synchronous channel clicks issue exactly ONE start POST', async () => {
    let release;
    setup({ start: () => new Promise((r) => { release = r; }) });
    fireEvent.change(screen.getByLabelText(/username or email/i), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const email = screen.getByRole('button', { name: 'Email' });
    const sms = screen.getByRole('button', { name: 'Text message' });
    // Same tick, no re-render between: `disabled` cannot save us, only a ref guard can.
    act(() => { email.click(); email.click(); sms.click(); });
    const starts = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/login/start')).length;
    expect(starts()).toBe(1);
    release(res(START));
    await flush();
    expect(starts()).toBe(1);
  });

  test('use a password instead calls onUsePassword', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use a password instead' }));
    expect(props.onUsePassword).toHaveBeenCalled();
  });
});
