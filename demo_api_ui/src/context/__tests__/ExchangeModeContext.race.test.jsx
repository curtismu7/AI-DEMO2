import { renderHook, act, waitFor } from '@testing-library/react';
import axios from 'axios';
import { ExchangeModeProvider, useExchangeMode } from '../ExchangeModeContext';

vi.mock('axios');

const wrapper = ({ children }) => <ExchangeModeProvider>{children}</ExchangeModeProvider>;

describe('ExchangeModeContext — overlapping setMode calls', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('a slower earlier request does not overwrite the newer confirmed mode', async () => {
    let resolveFirst;
    axios.post
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => Promise.resolve({ data: { mode: 'single' } }));

    const { result } = renderHook(() => useExchangeMode(), { wrapper });

    // Request A (slow) then request B (fast) before A settles.
    act(() => { result.current.setMode('double'); });
    await act(async () => { await result.current.setMode('single'); });
    expect(result.current.mode).toBe('single');

    // A's late success must NOT repaint B's confirmed 'single'.
    await act(async () => { resolveFirst({ data: { mode: 'double' } }); });
    await waitFor(() => expect(result.current.mode).toBe('single'));
  });

  it('a slower earlier failure does not revert the newer confirmed mode', async () => {
    let rejectFirst;
    axios.post
      .mockImplementationOnce(() => new Promise((_r, rej) => { rejectFirst = rej; }))
      .mockImplementationOnce(() => Promise.resolve({ data: { mode: 'single' } }));

    const { result } = renderHook(() => useExchangeMode(), { wrapper });

    act(() => { result.current.setMode('double'); });
    await act(async () => { await result.current.setMode('single'); });
    expect(result.current.mode).toBe('single');

    await act(async () => {
      rejectFirst(new Error('network down'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.mode).toBe('single'));
  });
});
