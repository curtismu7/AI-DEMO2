import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DotMemoryPanel from '../DotMemoryPanel';

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ memories: [] }) }));
});
afterEach(cleanup);

describe('DotMemoryPanel layout', () => {
  it('standalone (the Studio): fixed 260px column with a left border', () => {
    render(<DotMemoryPanel />);
    const el = screen.getByTestId('dot-memory-panel');
    expect(el.style.width).toBe('260px');
    expect(el.style.borderLeft).toContain('1px solid');
  });

  it('embedded (inside the workbench card): fills its container, no side border', () => {
    render(<DotMemoryPanel embedded />);
    const el = screen.getByTestId('dot-memory-panel');
    expect(el.style.width).toBe('100%');
    expect(el.getAttribute('style')).not.toMatch(/border-left:\s*1px solid/);
  });
});
