/**
 * MFATestPfCibaSection — PingFederate's own CIBA: start via the PF AI Agent BFF routes, poll, answer on the web approver.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockPost = vi.fn();
const mockGet = vi.fn();
vi.mock('../../services/apiClient', () => ({
  default: { post: (...a) => mockPost(...a), get: (...a) => mockGet(...a) },
}));

const { default: MFATestPfCibaSection } = await import('../MFATestPfCibaSection');

const PENDING = { state: 'pending', loginHint: 'alice', bindingMessage: 'Approve', interval: 5, expiresAt: '2030-01-01T00:00:00Z' };

function routeGets({ features, polls = [] }) {
  mockGet.mockImplementation((url) => {
    if (url === '/api/pf-ai-agent/status') return Promise.resolve({ data: { features } });
    if (url === '/api/pf-ai-agent/ciba/status') return Promise.resolve({ data: polls.length > 1 ? polls.shift() : polls[0] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

async function mountAndStart() {
  render(<MFATestPfCibaSection />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByTestId('mfa-pfciba-start')); });
}

const statusText = () => screen.getByTestId('mfa-pfciba-status').textContent;
const pollCount = () => mockGet.mock.calls.filter(([u]) => u === '/api/pf-ai-agent/ciba/status').length;

describe('MFATestPfCibaSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPost.mockReset();
    mockGet.mockReset();
    mockPost.mockResolvedValue({ data: PENDING });
  });
  afterEach(() => vi.useRealTimers());

  test('disabled with a notice when PingFederate CIBA is not enabled', async () => {
    routeGets({ features: { ciba: false, cibaMock: false, cibaWebApprover: false } });
    render(<MFATestPfCibaSection />);
    await act(async () => {});
    expect(screen.getByText(/PingFederate CIBA is not enabled/)).toBeTruthy();
    expect(screen.getByTestId('mfa-pfciba-start').disabled).toBe(true);
  });

  test('empty login hint sends none (signed-in user), polls every 2s and passes on approved', async () => {
    routeGets({ features: { ciba: true }, polls: [PENDING, { state: 'approved', subject: 'alice' }] });
    await mountAndStart();
    expect(mockPost).toHaveBeenCalledWith('/api/pf-ai-agent/ciba/start', { loginHint: undefined, bindingMessage: 'Approve' });
    expect(statusText()).toMatch(/Testing: Waiting for approval/);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollCount()).toBe(1);
    expect(statusText()).toMatch(/Waiting for approval/);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(pollCount()).toBe(2);
    expect(statusText()).toMatch(/Passed: Approved/);
  });

  test('web approver: Approve posts the web-approver decision', async () => {
    routeGets({ features: { ciba: true, cibaWebApprover: true }, polls: [PENDING] });
    mockPost.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/start') ? PENDING : { ok: true } }));
    await mountAndStart();
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-pfciba-approve')); });
    expect(mockPost).toHaveBeenCalledWith('/api/pf-ai-agent/ciba/web-approver/decision', { decision: 'approve' });
  });

  test('mock phone: Deny posts the mock decision and the returned state fails the card', async () => {
    routeGets({ features: { ciba: false, cibaMock: true }, polls: [PENDING] });
    mockPost.mockImplementation((url) => Promise.resolve({
      data: url.endsWith('/start') ? PENDING : { state: 'denied', reason: 'user_denied' },
    }));
    await mountAndStart();
    await act(async () => { fireEvent.click(screen.getByTestId('mfa-pfciba-deny')); });
    expect(mockPost).toHaveBeenCalledWith('/api/pf-ai-agent/ciba/mock-decision', { decision: 'deny' });
    expect(statusText()).toMatch(/Failed: Denied/);
  });

  test('no Approve / Deny without a web approver or mock phone', async () => {
    routeGets({ features: { ciba: true }, polls: [PENDING] });
    await mountAndStart();
    expect(screen.queryByTestId('mfa-pfciba-approve')).toBeNull();
  });

  test('expired fails the card', async () => {
    routeGets({ features: { ciba: true }, polls: [{ state: 'expired' }] });
    await mountAndStart();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(statusText()).toMatch(/Failed: Expired/);
  });

  test('start error shows the reason', async () => {
    routeGets({ features: { ciba: true } });
    mockPost.mockRejectedValue({ response: { data: { error: 'PF_AI_CIBA_USER_UNKNOWN' } } });
    await mountAndStart();
    expect(statusText()).toMatch(/Failed: Error/);
    expect(screen.getByText(/PingFederate does not know that user/)).toBeTruthy();
  });

  test('Cancel stops polling', async () => {
    routeGets({ features: { ciba: true }, polls: [PENDING] });
    await mountAndStart();
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(pollCount()).toBe(0);
    expect(statusText()).toMatch(/Pending: Not started/);
  });
});
