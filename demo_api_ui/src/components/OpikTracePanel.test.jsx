import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OpikTracePanel, { fmtMs, withDepth } from './OpikTracePanel';

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const STATS = {
  enabled: true, window: '24h', project: 'ai-demo-langchain', project_url: 'https://www.comet.com/opik/ws/projects/p/traces',
  traces: 2, p50_ms: 17712, p90_ms: 22206, avg_tokens_in: 4240, avg_tokens_out: 236, errors: 0, error_rate: 0, tool_calls: 1,
};
const TRACES = { enabled: true, traces: [{ id: 't1', start_time: '2026-10-05T10:50:35Z', duration_ms: 23330, total_tokens: 4539, span_count: 3, tool_calls: true, error: false }] };
const SPANS = { enabled: true, total_ms: 1000, spans: [
  { id: 'a', parent_id: null, name: 'agent', type: 'general', offset_ms: 0, duration_ms: 1000 },
  { id: 'b', parent_id: 'a', name: 'loyalty_balance', type: 'tool', offset_ms: 100, duration_ms: 400 },
] };

function route(map) {
  global.fetch = vi.fn((url) => {
    const key = Object.keys(map).find((k) => url.includes(k));
    return key ? map[key]() : json({}, 404);
  });
}

describe('OpikTracePanel', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { delete global.fetch; });

  test('helpers format durations and nesting', () => {
    expect(fmtMs(412)).toBe('412 ms');
    expect(fmtMs(23330)).toBe('23.3 s');
    expect(fmtMs(null)).toBe('—');
    expect(withDepth(SPANS.spans).map((s) => s.depth)).toEqual([0, 1]);
  });

  test('renders tiles, trace row, waterfall and the Opik link', async () => {
    route({ '/stats': () => json(STATS), '/spans': () => json(SPANS), '/traces?': () => json(TRACES) });
    render(<OpikTracePanel />);
    expect(await screen.findByText('loyalty_balance')).toBeTruthy();
    expect(screen.getByText('4,240')).toBeTruthy();
    expect(screen.getByText('17.7 s')).toBeTruthy();
    expect(screen.getByText('Open in Opik').getAttribute('href')).toBe(STATS.project_url);
  });

  test('shows the disabled state when Opik is not configured', async () => {
    route({ '/stats': () => json({ enabled: false }), '/traces?': () => json({ enabled: false }) });
    render(<OpikTracePanel />);
    expect(await screen.findByText(/not configured/i)).toBeTruthy();
    expect(screen.queryByText('Open in Opik')).toBeNull();
  });

  test('shows an error with retry when the BFF fails', async () => {
    route({ '/stats': () => json({}, 502), '/traces?': () => json({}, 502) });
    render(<OpikTracePanel />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  test('shows an honest empty state when the window has no traces', async () => {
    route({ '/stats': () => json({ ...STATS, traces: 0 }), '/traces?': () => json({ enabled: true, traces: [] }) });
    render(<OpikTracePanel />);
    await waitFor(() => expect(screen.getByText(/No traces in this window/)).toBeTruthy());
  });
});
