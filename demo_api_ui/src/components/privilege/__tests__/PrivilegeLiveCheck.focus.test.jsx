import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrivilegeLiveCheck from '../PrivilegeLiveCheck';

describe('PrivilegeLiveCheck — keyboard focus while a call is in flight', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps focus on the trigger and ignores a second press until the call settles', async () => {
    let resolveFetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise((r) => { resolveFetch = r; }),
    );
    render(<PrivilegeLiveCheck tool="t" args={{}} />);
    const button = screen.getByRole('button');
    button.focus();
    fireEvent.click(button);

    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    // aria-disabled, not disabled: a disabled button would hand focus to the page body.
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, json: async () => ({ decision: 'allowed', by: 'gw', status: 200, latencyMs: 5 }) });
    await waitFor(() => expect(screen.getByTestId('plc-verdict')).toBeTruthy());
    expect(button.getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
