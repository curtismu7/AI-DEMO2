// demo_api_ui/src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { TokenChainProvider, useTokenChain } from '../TokenChainContext';

vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    ingestTokenEvents: vi.fn(),
    ingestTokenEvent: vi.fn(),
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

describe('TokenChainContext.appendTokenEvent', () => {
  it('appends a new event to live events', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    act(() => result.current.setTokenEvents('tool1', [{ id: 'user-token', status: 'active' }]));
    act(() => result.current.appendTokenEvent('tool1', { id: 'tools-list', status: 'success' }));
    expect(result.current.events.map((e) => e.id)).toEqual(['user-token', 'tools-list']);
  });

  it('replaces an event with the same id in place', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    act(() => result.current.setTokenEvents('tool1', [{ id: 'gw-authorize', status: 'waiting' }]));
    act(() => result.current.appendTokenEvent('tool1', { id: 'gw-authorize', status: 'permit' }));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].status).toBe('permit');
  });

  it('does not touch history', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    act(() => result.current.setTokenEvents('tool1', [{ id: 'user-token', status: 'active' }]));
    const historyLengthBefore = result.current.history.length;
    act(() => result.current.appendTokenEvent('tool1', { id: 'tools-list', status: 'success' }));
    expect(result.current.history.length).toBe(historyLengthBefore);
  });
});
