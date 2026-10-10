// WebMCP mock surface (coverage plan row "WebMCP (Google)" — MOCK: expose two
// banking tools through the /webmcp manifest so the browser-agent path is
// visible). The hook registers two read-only tools on navigator.modelContext
// when the browser supports it, and always reports its state for the page card.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { useWebMcpTools } from '../useWebMcpTools';

describe('useWebMcpTools', () => {
  let removed;

  beforeEach(() => {
    removed = [];
    window.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unsupported when navigator.modelContext is absent', () => {
    const { result } = renderHook(() => useWebMcpTools());
    expect(result.current.supported).toBe(false);
    expect(result.current.registered).toEqual([]);
  });

  it('registers two read-only banking tools when the API is present', () => {
    const registered = [];
    navigator.modelContext = {
      registerTool: (tool) => registered.push(tool),
    };
    try {
      const { result } = renderHook(() => useWebMcpTools());
      expect(result.current.supported).toBe(true);
      expect(registered.map((t) => t.name)).toEqual([
        'get_my_accounts',
        'get_my_transactions',
      ]);
      expect(result.current.registered).toEqual(['get_my_accounts', 'get_my_transactions']);
      // tools must be read-only
      for (const t of registered) expect(t.execute).toBeTypeOf('function');
    } finally {
      delete navigator.modelContext;
    }
  });

  it('tool execute fetches the BFF endpoint with credentials', async () => {
    const registered = [];
    navigator.modelContext = { registerTool: (tool) => registered.push(tool) };
    try {
      renderHook(() => useWebMcpTools());
      await registered[0].execute({});
      expect(window.fetch).toHaveBeenCalledWith(
        '/api/accounts/my',
        expect.objectContaining({ credentials: 'include' }),
      );
    } finally {
      delete navigator.modelContext;
    }
  });
});
