// demo_api_ui/src/context/__tests__/TokenChainContext.sessionFallback.test.jsx
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { TokenChainProvider, useTokenChain } from '../TokenChainContext';

vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    ingestTokenEvents: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getState: vi.fn(() => ({ trace: {}, steps: [] })),
  },
}));

const wrapper = ({ children }) => (
  <TokenChainProvider activePath="/dashboard">{children}</TokenChainProvider>
);

beforeEach(() => {
  if (typeof localStorage !== 'undefined' && localStorage.clear) localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});

describe('TokenChainContext session preview fallback', () => {
  it('clearEvents returns to session login tokens (Simple Stepper / Clear contract)', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    const session = [
      { id: 'user-token', label: 'User Token', status: 'active' },
      { id: 'id-token', label: 'ID Token', status: 'active' },
    ];
    const tool = [{ id: 'token-exchange', label: 'RFC 8693', status: 'success' }];

    act(() => result.current.setSessionToken(session));
    expect(result.current.events.map((e) => e.id)).toEqual(['user-token', 'id-token']);

    act(() => result.current.setTokenEvents('get_balance', tool));
    expect(result.current.events.map((e) => e.id)).toEqual(['token-exchange']);

    act(() => result.current.clearEvents());
    expect(result.current.events.map((e) => e.id)).toEqual(['user-token', 'id-token']);
  });

  it('empty setTokenEvents clears live chain but keeps session preview', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    const session = [{ id: 'user-token', label: 'User Token', status: 'active' }];

    act(() => result.current.setSessionToken(session));
    act(() => result.current.setTokenEvents('broken-tool', []));
    expect(result.current.events.map((e) => e.id)).toEqual(['user-token']);
  });
});
