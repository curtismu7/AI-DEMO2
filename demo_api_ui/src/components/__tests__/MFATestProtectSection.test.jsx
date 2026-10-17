/**
 * MFATestProtectSection — collect PingOne Signals, run a Protect risk evaluation, show the result.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCollect = vi.fn();
const mockEvaluate = vi.fn();
const mockGet = vi.fn();
vi.mock('../../lib/pingOneSignalsSdk', () => ({ collectPingOneSignals: (...a) => mockCollect(...a) }));
vi.mock('../../services/protectAuthenticationService', () => ({
  evaluateProtectBrowserRisk: (...a) => mockEvaluate(...a),
}));
vi.mock('../../services/apiClient', () => ({ default: { get: (...a) => mockGet(...a) } }));

const { default: MFATestProtectSection } = await import('../MFATestProtectSection');

describe('MFATestProtectSection', () => {
  beforeEach(() => {
    mockCollect.mockReset().mockResolvedValue('signals-blob');
    mockEvaluate.mockReset();
    mockGet.mockReset().mockResolvedValue({ data: { user: { username: 'alice' } } });
  });

  test('evaluates the signed-in user with collected signals and shows level, action and bot level', async () => {
    mockEvaluate.mockResolvedValue({ level: 'MEDIUM', recommendedAction: 'BOT_MITIGATION', botDetection: { level: 'HIGH' } });
    render(<MFATestProtectSection />);
    await waitFor(() => expect(screen.getByTestId('mfa-protect-user').value).toBe('alice'));
    fireEvent.click(screen.getByTestId('mfa-protect-run'));
    await waitFor(() => expect(screen.getByTestId('mfa-protect-status').textContent).toMatch(/Passed/));
    expect(mockEvaluate).toHaveBeenCalledWith({ userId: 'alice', signalsData: 'signals-blob' });
    const result = screen.getByTestId('mfa-protect-result').textContent;
    expect(result).toMatch(/MEDIUM/);
    expect(result).toMatch(/BOT_MITIGATION/);
    expect(result).toMatch(/Bot detection: HIGH/);
  });

  test('a 503 from the evaluation reads as Protect not configured', async () => {
    mockEvaluate.mockRejectedValue(new Error('Protect evaluation failed (503)'));
    render(<MFATestProtectSection />);
    await waitFor(() => expect(screen.getByTestId('mfa-protect-user').value).toBe('alice'));
    fireEvent.click(screen.getByTestId('mfa-protect-run'));
    await waitFor(() => expect(screen.getByTestId('mfa-protect-status').textContent).toMatch(/Failed/));
    expect(screen.getByText(/Protect is not configured/)).toBeTruthy();
  });
});
