// /session-lab on the Ping UI Standard: banner first and honest about the real read, chips with words,
// one primary per simulated-session state, focus kept after an action, live result region.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SessionLabPage from '../SessionLabPage';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

const status = (over = {}) => ({ data: { authenticated: true, loginProvider: 'pingone', sessionType: 'user', expiresAt: Date.now() + 30 * 60000, hasRefreshToken: true, ...over } });
const claims = { data: { authenticated: true, decoded: { payload: { sub: 'u1' } }, idToken: { payload: { auth_time: 1790000000, amr: ['pwd', 'mfa'], sid: 'sid-abc', iat: 1790000100, exp: 1790003700 } } } };

function serve({ st = status(), cl = claims } = {}) {
  apiClient.get.mockImplementation((url) => {
    const r = url.endsWith('/status') ? st : cl;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  });
}

const primaries = (c) => [...c.querySelectorAll('button.pu-btn--primary')].map((b) => b.textContent);

describe('SessionLabPage', () => {
  beforeEach(() => { vi.clearAllMocks(); serve(); });

  it('puts a role=note banner first, above the title band', async () => {
    const { container } = render(<SessionLabPage />);
    const banner = screen.getByTestId('session-lab-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(container.querySelector('.pu-page').firstElementChild).toContainElement(banner);
    await screen.findByText('sid-abc (ID token)');
    expect(banner).toHaveTextContent(/real and simulated/i);
    expect(banner).toHaveTextContent(/read just now and read-only/i);
    expect(banner).toHaveTextContent(/cannot read it/i);
  });

  it('shows the real facts in cards with a Real chip and a status that says Read', async () => {
    render(<SessionLabPage />);
    expect(screen.getByTestId('session-lab-real-status')).toHaveTextContent('Reading');
    const bff = await screen.findByTestId('session-lab-bff');
    expect(within(bff).getByText('Real')).toHaveClass('pu-chip');
    expect(within(bff).getByText('pingone')).toBeInTheDocument();
    expect(within(screen.getByTestId('session-lab-claims')).getByText('pwd, mfa (ID token)')).toBeInTheDocument();
    expect(screen.getByTestId('session-lab-real-status')).toHaveTextContent('Read');
    expect(screen.getByTestId('session-lab-cookie-note')).toHaveTextContent(/cannot read it/);
  });

  it('banner and status never claim a real read when signed out', async () => {
    serve({ st: status({ authenticated: false }) });
    render(<SessionLabPage />);
    await screen.findByText('Not signed in');
    expect(screen.getByTestId('session-lab-banner')).toHaveTextContent(/not signed in/i);
    expect(screen.getByTestId('session-lab-banner')).not.toHaveTextContent(/read just now/i);
    expect(screen.queryByTestId('session-lab-bff')).not.toBeInTheDocument();
  });

  it('says so when the status request fails, and when only one request fails', async () => {
    serve({ st: new Error('boom') });
    const first = render(<SessionLabPage />);
    await screen.findByText('Unavailable');
    expect(screen.getByTestId('session-lab-banner')).toHaveTextContent(/could not read your session/i);
    expect(screen.getByTestId('session-lab-banner')).not.toHaveTextContent(/read just now/i);
    first.unmount();
    serve({ cl: new Error('boom') });
    render(<SessionLabPage />);
    await screen.findByText('Partly read');
    expect(within(await screen.findByTestId('session-lab-claims')).getAllByText('not read (the request failed)').length).toBeGreaterThan(0);
  });

  it('a partial read does not claim both requests were read (banner, status, claim values)', async () => {
    serve({ cl: new Error('boom') });
    render(<SessionLabPage />);
    await screen.findByText('Partly read');
    const banner = screen.getByTestId('session-lab-banner');
    expect(banner).toHaveTextContent(/partly real and simulated/i);
    expect(banner).toHaveTextContent(/token-claims request failed/i);
    expect(banner).not.toHaveTextContent(/and the claims in the tokens it holds/i);
    expect(screen.getByTestId('session-lab-real-status')).toHaveTextContent(/token-claims request failed/i);
    const claimsCard = await screen.findByTestId('session-lab-claims');
    expect(within(claimsCard).getAllByText('not read (the request failed)').length).toBe(5);
    expect(within(claimsCard).queryByText('not in these tokens')).not.toBeInTheDocument();
  });

  it('a 401 from the status request is signed out, not "the request failed"', async () => {
    serve({ st: Object.assign(new Error('401'), { response: { status: 401 } }) });
    render(<SessionLabPage />);
    await screen.findByText('Not signed in');
    expect(screen.getByTestId('session-lab-banner')).toHaveTextContent(/not signed in/i);
    expect(screen.getByTestId('session-lab-banner')).not.toHaveTextContent(/request failed/i);
    expect(screen.getByTestId('session-lab-real-status')).not.toHaveTextContent(/request failed/i);
  });

  it('does not put a fixed cookie string in a live card; it is documented in the neutral note', async () => {
    render(<SessionLabPage />);
    const bff = await screen.findByTestId('session-lab-bff');
    expect(within(bff).queryByText(/connect\.sid/)).not.toBeInTheDocument();
    expect(bff).not.toHaveTextContent(/from the server config/i);
    expect(screen.getByTestId('session-lab-cookie-note')).toHaveTextContent(/connect\.sid.*documented server setting, not read from your session/i);
  });

  it('an idle-expired session shows the warn chip, keeps Check as the only primary, and Check says why it fails', async () => {
    const { container } = render(<SessionLabPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Report pwd, idle 5 min' }));
    fireEvent.click(screen.getByRole('button', { name: '+1 hour' }));
    expect(within(screen.getByTestId('session-lab-record')).getByText('Idle timeout passed')).toHaveClass('pu-chip');
    expect(primaries(container)).toEqual(['Check']);
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(within(screen.getByTestId('session-lab-result')).getByText('FAIL')).toHaveClass('pu-chip');
  });

  it('keeps a 100-character unbroken value inside its card (wrapping is CSS: the value stays one text node)', async () => {
    const sid = 'x'.repeat(100);
    serve({ cl: { data: { authenticated: true, idToken: { payload: { sid } } } } });
    render(<SessionLabPage />);
    expect(await screen.findByText(`${sid} (ID token)`)).toHaveClass('pu-mono');
  });

  it('has exactly one primary per state: Sign in with no session, Check once there is one', async () => {
    const { container } = render(<SessionLabPage />);
    await screen.findByTestId('session-lab-bff');
    expect(primaries(container)).toEqual(['Sign in with password']);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }));
    expect(primaries(container)).toEqual(['Check']);

    fireEvent.click(screen.getByRole('button', { name: '+9 hours' }));
    expect(primaries(container)).toEqual(['Check']); // idle-expired or not, a session record exists

    fireEvent.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(primaries(container)).toEqual(['Sign in with password']);
  });

  it('the simulated session record uses chips with words and a key-value list', async () => {
    render(<SessionLabPage />);
    const rec = screen.getByTestId('session-lab-record');
    expect(within(rec).getByText('No session')).toHaveClass('pu-chip');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }));
    expect(within(rec).getByText('Active')).toHaveClass('pu-chip');
    expect(within(rec).getByText('last sign-on · pwd')).toBeInTheDocument();
    expect(within(rec).getByText('t+0 min (0 min ago)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Report pwd, idle 5 min' }));
    fireEvent.click(screen.getByRole('button', { name: '+1 hour' }));
    expect(within(rec).getByText('Idle timeout passed')).toHaveClass('pu-chip');
  });

  it('Check follows the model, announces in an always-mounted status region, and keeps focus', async () => {
    render(<SessionLabPage />);
    const result = screen.getByTestId('session-lab-result');
    expect(result).toHaveAttribute('role', 'status');
    expect(result).toHaveTextContent('Not checked');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }));
    fireEvent.click(screen.getByRole('button', { name: '+9 hours' }));
    const check = screen.getByRole('button', { name: 'Check' });
    check.focus();
    fireEvent.click(check);
    expect(screen.getByTestId('session-lab-result')).toBe(result); // same element, so a screen reader hears the change
    expect(result).toHaveTextContent('FAIL last sign-on older than 480 min');
    expect(within(result).getByText('FAIL')).toHaveClass('pu-chip');
    expect(screen.getByRole('button', { name: 'Check' })).toBe(check);
    expect(check).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Report mfa, no challenge' }));
    expect(result).toHaveTextContent('Not checked'); // an action clears the stale verdict
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'mfa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(within(result).getByText('PASS')).toHaveClass('pu-chip');
    expect(result).toHaveTextContent('PASS method present');
  });

  it('a clicked primary keeps keyboard focus when it stops being the primary', async () => {
    render(<SessionLabPage />);
    const signIn = screen.getByRole('button', { name: 'Sign in with password' });
    signIn.focus();
    fireEvent.click(signIn);
    expect(screen.getByRole('button', { name: 'Sign in with password' })).toBe(signIn);
    expect(signIn).toHaveFocus();
    expect(signIn).not.toHaveClass('pu-btn--primary');
    expect(signIn).toHaveClass('pu-btn');
  });

  it('logs what happened and shows an empty state first', async () => {
    render(<SessionLabPage />);
    const log = screen.getByTestId('session-lab-log');
    expect(within(log).getByText(/Nothing yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with password' }));
    await waitFor(() => expect(within(log).getByText(/New session\. Reported pwd/)).toBeInTheDocument());
  });

  it('labels the simulated half and keeps the diagram', async () => {
    render(<SessionLabPage />);
    expect(within(screen.getByTestId('session-lab-sim')).getByText('Simulated')).toHaveClass('pu-chip');
    expect(screen.getByTestId('session-lab-diagram')).toBeInTheDocument();
  });
});
