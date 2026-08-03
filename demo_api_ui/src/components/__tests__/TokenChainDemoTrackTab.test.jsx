import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TokenChainDemoTrackTab from '../TokenChainDemoTrackTab';

const STATE = {
  track: {
    steps: [
      { stepId: 'delegated-access', act: 1, title: 'Delegated access — token exchange', capability: 'RFC 8693 · act claim', ucIds: ['UC1'], buyerStory: 'story', slots: { green: { chipText: 'show my balance', expected: ['PERMIT'] }, red: { label: 'replayed token', expected: ['BLOCKED'] } }, proved: { green: 'g', red: 'r', sayThis: 's' } },
      { stepId: 'attack-gauntlet', act: 1, title: 'Attack gauntlet', capability: 'finale', ucIds: ['UC26'], buyerStory: 'story', slots: { red: { label: 'six attacks', expected: ['BLOCKED'] } }, proved: { green: null, red: 'r', sayThis: 's' } },
      { stepId: 'pingone-mcp-admin', act: 2, title: 'PingOne MCP server', capability: 'admin', ucIds: ['UC-LEARN2'], buyerStory: 'story', slots: { green: { chipText: 'admin task', expected: ['PERMIT'] }, red: { chipText: 'denied', expected: ['DENY'] } }, proved: { green: 'g', red: 'r', sayThis: 's' } },
    ],
    gauntletSims: [{ sim: 'impersonation-no-act', ucId: 'UC16', label: 'Impersonation' }],
  },
  run: {
    runId: 'run-1', startedAt: '2026-08-03T10:00:00Z', activeStepId: 'delegated-access',
    slots: { 'delegated-access:green': { verdict: 'PERMIT', decisionId: null, via: 'get_account_balance', at: '2026-08-03T10:42:00Z' } },
    gauntlet: { 'impersonation-no-act': { blocked: true, status: 403, at: '2026-08-03T10:43:00Z' } },
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(STATE) })));
});

describe('TokenChainDemoTrackTab', () => {
  it('renders acts, steps, and a filled green slot', async () => {
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/Delegated access/)).toBeInTheDocument());
    expect(screen.getByText(/ACT 1/)).toBeInTheDocument();
    expect(screen.getByText(/ACT 2/)).toBeInTheDocument();
    expect(screen.getByText(/PERMIT ✓/)).toBeInTheDocument();
  });

  it('shows gauntlet progress from the gauntlet map', async () => {
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/1 \/ 1 blocked/)).toBeInTheDocument());
  });

  it('links to the full track page', async () => {
    render(<TokenChainDemoTrackTab />);
    const link = await screen.findByText(/Open full track page/);
    expect(link.closest('a')).toHaveAttribute('href', '/demo-track');
  });
});
