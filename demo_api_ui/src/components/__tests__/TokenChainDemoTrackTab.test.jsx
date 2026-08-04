import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TokenChainDemoTrackTab from '../TokenChainDemoTrackTab';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

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
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: STATE });
  apiClient.post.mockResolvedValue({ data: {} });
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

  it('renders a mini token-chain strip for a filled PERMIT slot ending at the tool', async () => {
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/PERMIT ✓/)).toBeInTheDocument());
    expect(screen.getByText('user token ✓')).toBeInTheDocument();
    expect(screen.getByText('RFC 8693 · act ✓')).toBeInTheDocument();
    expect(screen.getByText('P1AZ PERMIT')).toBeInTheDocument();
    expect(screen.getByText('get_account_balance ✓')).toBeInTheDocument();
  });

  it('renders a deny strip that stops at P1AZ with the tool never called', async () => {
    const denyState = JSON.parse(JSON.stringify(STATE));
    denyState.run.slots['pingone-mcp-admin:red'] = { verdict: 'DENY', decisionId: 'd-9', via: 'denied_tool', at: '2026-08-03T10:44:00Z' };
    apiClient.get.mockResolvedValue({ data: denyState });
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getAllByText(/DENY ✕/).length).toBeGreaterThan(0));
    expect(screen.getByText('P1AZ DENY ✕')).toBeInTheDocument();
    expect(screen.getByText('denied_tool — never called')).toBeInTheDocument();
  });

  it('shows the plain-language reason and error code on a filled slot', async () => {
    const withReason = JSON.parse(JSON.stringify(STATE));
    withReason.run.slots['delegated-access:green'].reason = 'PingOne Authorize permitted get_account_balance — the delegated call satisfied policy and ran.';
    withReason.run.slots['delegated-access:red'] = { verdict: 'DENY', decisionId: null, via: 'x', at: '2026-08-03T10:44:00Z', errorCode: 'invalid_aud', reason: 'Audience check failed at gateway introspection — aud mismatch.' };
    apiClient.get.mockResolvedValue({ data: withReason });
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/permitted get_account_balance/)).toBeInTheDocument());
    expect(screen.getByText(/Audience check failed/)).toBeInTheDocument();
    expect(screen.getByText('invalid_aud')).toBeInTheDocument();
  });

  it('Start new run posts and flashes confirmation', async () => {
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/Delegated access/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start new run'));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/demo-track/runs'));
    await waitFor(() => expect(screen.getByText('✓ New run started')).toBeInTheDocument());
  });

  it('Start new run surfaces a failure instead of doing nothing', async () => {
    apiClient.post.mockRejectedValue(new Error('boom'));
    render(<TokenChainDemoTrackTab />);
    await waitFor(() => expect(screen.getByText(/Delegated access/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start new run'));
    await waitFor(() => expect(screen.getByText('✕ Failed — retry')).toBeInTheDocument());
  });
});
