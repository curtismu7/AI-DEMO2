/** CibaApprovalPanel — second factor after the password: choose a channel, compare the match code, wait for the approval. */
import { render, screen, fireEvent, act } from '@testing-library/react';
import CibaApprovalPanel from '../CibaApprovalPanel';

const res = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const START = { authReqId: 'a'.repeat(48), matchCode: 'K7-42', expiresIn: 120, interval: 2 };

function setup({ start = () => res(START), poll = () => res({ status: 'pending' }), channels = ['email', 'sms'] } = {}) {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/auth/ciba/login/start')) return start();
    if (String(url).includes('/api/auth/ciba/login/poll/')) return poll();
    return res({}, 404);
  });
  const props = { channels, onApproved: vi.fn(), onCancel: vi.fn() };
  const { unmount } = render(<CibaApprovalPanel {...props} />);
  return { ...props, unmount };
}
const pollCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/poll/')).length;
const startCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/login/start')).length;
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function toWaiting(label = 'Email') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await flush();
}

describe('CibaApprovalPanel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('opens on the channel choice with both channels the user has', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Text message' })).toBeInTheDocument();
  });

  test('a channel not passed is never rendered (user without a phone is never offered text)', () => {
    setup({ channels: ['email'] });
    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Text message' })).toBeNull();
  });

  test('start posts JSON with only the channel', async () => {
    setup();
    await toWaiting('Text message');
    const [url, init] = global.fetch.mock.calls.find(([u]) => String(u).includes('/login/start'));
    expect(url).toContain('/api/auth/ciba/login/start');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ channel: 'sms' });
  });

  test('waiting screen shows the match code and the exact wording', async () => {
    setup();
    await toWaiting('Email');
    expect(screen.getByText('K7-42')).toBeInTheDocument();
    expect(screen.getByText(
      'We sent an approval link by email. There is nothing to type: open the link, check the page shows match code K7-42, then tap Approve.',
    )).toBeInTheDocument();
  });

  test('text channel wording says text message', async () => {
    setup();
    await toWaiting('Text message');
    expect(screen.getByText(/We sent an approval link by text message\./)).toBeInTheDocument();
  });

  test('the countdown is visible, ticks, and sits outside the live region', async () => {
    setup();
    await toWaiting();
    expect(screen.getByText(/Expires in 2:00/)).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent(/Expires/);
    await flush(5000);
    expect(screen.getByText(/Expires in 1:55/)).toBeInTheDocument();
  });

  test('pending keeps polling every interval; approved calls onApproved once and stops', async () => {
    let n = 0;
    const props = setup({ poll: () => res(++n < 3 ? { status: 'pending' } : { status: 'approved', redirectTo: '/cb?code=1' }) });
    await toWaiting();
    await flush(2000); await flush(2000); await flush(2000);
    expect(props.onApproved).toHaveBeenCalledTimes(1);
    expect(props.onApproved).toHaveBeenCalledWith('/cb?code=1');
    const calls = pollCalls();
    await flush(10000);
    expect(pollCalls()).toBe(calls);
  });

  test('an unknown 200 status is treated as pending', async () => {
    const props = setup({ poll: () => res({ status: 'weird' }) });
    await toWaiting();
    await flush(2000); await flush(2000);
    expect(pollCalls()).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(props.onApproved).not.toHaveBeenCalled();
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
      expect(props.onApproved).not.toHaveBeenCalled();
    });

  test('Try again after a failure calls onCancel (back to the choice screen)', async () => {
    const props = setup({ poll: () => res({ status: 'denied' }, 403) });
    await toWaiting();
    await flush(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test('network errors are retried until the code expires', async () => {
    let n = 0;
    const props = setup({ poll: () => (++n < 3 ? Promise.reject(new Error('net')) : res({ status: 'approved', redirectTo: '/ok' })) });
    await toWaiting();
    await flush(2000); await flush(2000); await flush(2000);
    expect(props.onApproved).toHaveBeenCalledWith('/ok');
  });

  test('expires after expiresIn with a retry and stops polling', async () => {
    setup();
    await toWaiting();
    await flush(125000);
    expect(screen.getByRole('alert')).toHaveTextContent(/expired/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const calls = pollCalls();
    await flush(10000);
    expect(pollCalls()).toBe(calls);
  });

  test('cancel stops polling and calls onCancel', async () => {
    const props = setup();
    await toWaiting();
    await flush(2000);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const calls = pollCalls();
    await flush(10000);
    expect(pollCalls()).toBe(calls);
    expect(props.onCancel).toHaveBeenCalled();
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

  test.each([
    [429, { error: 'rate_limited' }, /Too many attempts\. Try again in a few minutes\./],
    [409, { error: 'no_parked_flow' }, /sign-in/i],
    [502, { error: 'approval_unavailable' }, /approval link/i],
  ])('start %s shows an error with retry and never polls', async (status, body, msg) => {
    setup({ start: () => res(body, status) });
    await toWaiting();
    expect(screen.getByRole('alert')).toHaveTextContent(msg);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await flush(10000);
    expect(pollCalls()).toBe(0);
  });

  test('start network failure shows an error', async () => {
    setup({ start: () => Promise.reject(new Error('net')) });
    await toWaiting();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  test('two synchronous channel clicks issue exactly ONE start POST', async () => {
    let release;
    setup({ start: () => new Promise((r) => { release = r; }) });
    const email = screen.getByRole('button', { name: 'Email' });
    const sms = screen.getByRole('button', { name: 'Text message' });
    // Same tick, no re-render between: `disabled` cannot save us, only a ref guard can.
    act(() => { email.click(); email.click(); sms.click(); });
    expect(startCalls()).toBe(1);
    release(res(START));
    await flush();
    expect(startCalls()).toBe(1);
  });

  test('focus moves to the step heading on each step change', async () => {
    setup();
    expect(screen.getByRole('heading', { name: /Where should we send/ })).toHaveFocus();
    await toWaiting();
    expect(screen.getByRole('heading', { name: /Check your email/ })).toHaveFocus();
  });
});
