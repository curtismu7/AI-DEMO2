import { renderHook, act } from '@testing-library/react';
import useHitlConsent from '../useHitlConsent';

global.fetch = jest.fn();

describe('useHitlConsent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no pending consent initially', () => {
    const { result } = renderHook(() => useHitlConsent({ hitlPending: null, runId: null }));
    expect(result.current.showConsentModal).toBe(false);
  });

  test('showConsentModal is true when hitlPending is set', () => {
    const hitlPending = { runId: 'r1', tool: 'transfer', params: {}, threshold: 500 };
    const { result } = renderHook(() => useHitlConsent({ hitlPending, runId: 'r1' }));
    expect(result.current.showConsentModal).toBe(true);
    expect(result.current.consentData).toEqual(hitlPending);
  });

  test('submitConsent POSTs to /api/agent/consent/:runId', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const hitlPending = { runId: 'r1', tool: 'transfer', params: {}, threshold: 500 };
    const { result } = renderHook(() => useHitlConsent({ hitlPending, runId: 'r1' }));

    await act(async () => {
      await result.current.submitConsent(true);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/agent/consent/r1',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
