import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickPrimary, approvalWaitMessage } from '../agentLifecycleFlow';

const callMcpTool = vi.fn();
const apiPost = vi.fn(() => Promise.resolve({}));
vi.mock('../../services/demoAgentService', () => ({ callMcpTool: (...a) => callMcpTool(...a) }));
vi.mock('../../services/controlPlaneApi', () => ({ getAgents: () => Promise.resolve({ live: { id: 'agent-1' } }) }));
vi.mock('../../services/apiClient', () => ({ default: { post: (...a) => apiPost(...a), get: () => Promise.resolve({ data: {} }) } }));
vi.mock('../../components/TokenChainTraceRail', () => ({ default: () => <div data-testid="rail" /> }));
vi.mock('../../context/AgentUiModeContext', () => ({ useAgentUiMode: () => ({ setSurfaceHostEl: () => {} }) }));
vi.mock('../../components/shared/PingIdentitySpinner', () => ({ default: () => <span data-testid="spinner" /> }));
vi.mock('../../components/KillSwitchConfirmModal', () => ({
  default: ({ isOpen, onConfirm, onCancel }) => (isOpen ? (
    <div role="dialog" aria-label="Stop Agent — Confirm">
      <button type="button" onClick={() => onConfirm('agent-1', 'Misbehaving', 'instance')}>Confirm Stop Agent</button>
      <button type="button" onClick={() => onConfirm('agent-1', 'Misbehaving', 'full')}>Confirm full</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
  ) : null),
}));

import AgentLifecyclePage from '../AgentLifecyclePage';

const ordersOk = { result: { content: [{ text: JSON.stringify({ orders: [{ id: 'o1', total: 12 }, { id: 'o2', total: 30 }] }) }] } };
const primaryTestIds = (container) => [...container.querySelectorAll('button.pu-btn--primary')].map((b) => b.dataset.testid);

beforeEach(() => {
  callMcpTool.mockReset();
  apiPost.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('pickPrimary (one primary per view state)', () => {
  const base = { orders: false, checkout: false, revoked: false, scopeFull: false, modalOpen: false };
  it('walks orders, checkout, revoke', () => {
    expect(pickPrimary(base)).toBe('orders');
    expect(pickPrimary({ ...base, orders: true })).toBe('checkout');
    expect(pickPrimary({ ...base, orders: true, checkout: true })).toBe('revoke');
  });
  it('hands the primary to the dialog while it is open', () => {
    expect(pickPrimary({ ...base, modalOpen: true })).toBeNull();
  });
  it('after a revoke: re-enable for a full stop, the spent Revoked button for an instance stop', () => {
    expect(pickPrimary({ ...base, orders: true, checkout: true, revoked: true, scopeFull: true })).toBe('reenable');
    expect(pickPrimary({ ...base, revoked: true })).toBe('revoke');
  });
});

describe('approvalWaitMessage (no assumption about who approves)', () => {
  it('only promises auto-approval for the simulated engine', () => {
    expect(approvalWaitMessage('simulated', 'abc')).toMatch(/simulation that auto-approves/);
    expect(approvalWaitMessage('pingone', 'abc')).not.toMatch(/auto-approves/);
    expect(approvalWaitMessage('pingone', 'abc')).toMatch(/PingOne sent to you/);
    expect(approvalWaitMessage(undefined, 'abc')).not.toMatch(/auto-approves/);
  });
});

describe('AgentLifecyclePage (standalone UI standard)', () => {
  it('puts the note banner first and says what is live and what is simulated', () => {
    const { container } = render(<AgentLifecyclePage />);
    const banner = screen.getByTestId('alp-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(container.querySelector('.alp-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/simulat/i);
    expect(banner.textContent).toMatch(/real/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agent Lifecycle');
  });

  it('starts with exactly one primary, the list_orders call, and the rest secondary', () => {
    const { container } = render(<AgentLifecyclePage />);
    expect(primaryTestIds(container)).toEqual(['alp-call-orders']);
    expect(screen.getByTestId('alp-checkout').className).not.toContain('primary');
    expect(screen.getByTestId('alp-revoke').className).not.toContain('primary');
  });

  it('moves the primary to checkout after orders load, with orders as a kv list and a word chip', async () => {
    callMcpTool.mockResolvedValueOnce(ordersOk);
    const { container } = render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByTestId('alp-call-orders'));
    await waitFor(() => expect(screen.getByTestId('alp-orders')).toBeTruthy());
    expect(container.querySelectorAll('.alp-order dl.pu-kv')).toHaveLength(2);
    expect(screen.getByTestId('alp-step-2').textContent).toMatch(/Done · 2 orders/);
    expect(primaryTestIds(container)).toEqual(['alp-checkout']);
  });

  it('reads the order list the live gateway nests under data.orders', async () => {
    callMcpTool.mockResolvedValueOnce({ result: { content: [{ text: JSON.stringify({ success: true, data: { orders: [{ id: '1001' }] } }) }] } });
    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByTestId('alp-call-orders'));
    await waitFor(() => expect(screen.getByTestId('alp-orders')).toBeTruthy());
    expect(screen.getByTestId('alp-step-2').textContent).toMatch(/Done · 1 order(?!s)/);
  });

  it('keeps the primary on list_orders when the call fails, so retry is the obvious click', async () => {
    callMcpTool.mockRejectedValueOnce(new Error('gateway down'));
    const { container } = render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByTestId('alp-call-orders'));
    await waitFor(() => expect(screen.getByTestId('alp-orders-error').textContent).toBe('gateway down'));
    expect(screen.getByTestId('alp-step-2').textContent).toMatch(/Failed/);
    expect(primaryTestIds(container)).toEqual(['alp-call-orders']);
  });

  it('keeps focus on the button while a call is running (aria-disabled, not disabled)', async () => {
    let release;
    callMcpTool.mockReturnValueOnce(new Promise((r) => { release = r; }));
    render(<AgentLifecyclePage />);
    const btn = screen.getByTestId('alp-call-orders');
    btn.focus();
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn); // ignored while busy
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    await act(async () => { release(ordersOk); });
    expect(document.activeElement).toBe(btn);
  });

  it('names the checkout engine from the server reply, never assumes it', async () => {
    callMcpTool.mockResolvedValueOnce({ result: { error: 'mcp_hitl_required', hitlChallengeId: 'h1' } });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/initiate')) return { json: async () => ({ auth_req_id: 'r1', interval: 600, engine: 'pingone' }) };
      return { status: 200, json: async () => ({ status: 'pending' }) };
    }));
    render(<AgentLifecyclePage />);
    fireEvent.click(screen.getByTestId('alp-checkout'));
    await waitFor(() => expect(screen.getByTestId('alp-checkout-status')).toBeTruthy());
    expect(screen.getByTestId('alp-step-3').textContent).toMatch(/PingOne CIBA/);
    expect(screen.getByTestId('alp-step-3').textContent).toMatch(/Waiting for approval/);
    expect(screen.getByTestId('alp-checkout-status').textContent).not.toMatch(/auto-approves/);
    vi.unstubAllGlobals();
  });

  it('revoke: no page primary while the dialog is open, then a spent Revoked button that keeps focus', async () => {
    callMcpTool.mockResolvedValue({ result: { error: 'token_revoked' } });
    const { container } = render(<AgentLifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('alp-revoke').getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('alp-revoke'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(document.activeElement.textContent).toBe('Cancel'));
    expect(primaryTestIds(container)).toEqual([]);
    fireEvent.click(screen.getByText('Confirm Stop Agent'));
    await waitFor(() => expect(screen.getByTestId('alp-revoke-status').textContent).toMatch(/Confirmed revoked/));
    const revoke = screen.getByTestId('alp-revoke');
    expect(revoke.textContent).toBe('Revoked');
    expect(revoke.getAttribute('aria-disabled')).toBe('true');
    expect(primaryTestIds(container)).toEqual(['alp-revoke']);
    expect(screen.queryByTestId('alp-reenable')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(revoke));
    expect(apiPost).toHaveBeenCalledWith('/api/admin/agent/agent-1/kill-switch', { reason: 'Misbehaving', scope: 'instance' });
  });

  it('full-scope revoke offers Re-enable as the single primary', async () => {
    callMcpTool.mockResolvedValue({ result: { error: 'token_revoked' } });
    const { container } = render(<AgentLifecyclePage />);
    await waitFor(() => expect(screen.getByTestId('alp-revoke').getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(screen.getByTestId('alp-revoke'));
    fireEvent.click(screen.getByText('Confirm full'));
    await waitFor(() => expect(screen.getByTestId('alp-reenable')).toBeTruthy());
    expect(primaryTestIds(container)).toEqual(['alp-reenable']);
    expect(screen.getByTestId('alp-revoke').className).not.toContain('primary');
  });
});
