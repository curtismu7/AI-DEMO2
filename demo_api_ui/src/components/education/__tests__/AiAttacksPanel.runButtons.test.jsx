/**
 * AiAttacksPanel.runButtons.test.jsx
 *
 * Locks the "Run this attack in the live agent" wiring: each tab's button must
 * drive the mounted AI Agent (floating or inline) through the window events it
 * already listens for (see AIAgent.js — 'banking-run-showcase' and
 * 'banking-agent-prefill'), and close the drawer so the agent is visible.
 * When no agent is mounted (window.__bankingAgentMounted unset), the button
 * must persist the pending run to sessionStorage and navigate to /dashboard.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AiAttacksPanel from '../AiAttacksPanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';

// The panel calls useNavigate at top level (catalog tabs navigate with router
// state, exactly like /use-cases' handleRun). The app mounts it inside the
// Router (App.js EducationPanelsHost); tests render bare, so mock the hook.
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));

function renderPanel({ onClose = () => {}, initialTabId }) {
  return render(
    <EducationUIProvider>
      <AiAttacksPanel isOpen onClose={onClose} initialTabId={initialTabId} />
    </EducationUIProvider>,
  );
}

describe('AiAttacksPanel — Run this attack buttons', () => {
  let dispatchSpy;

  beforeEach(() => {
    // Agent-present path: AIAgent sets this flag on mount (any mode, inline
    // included — only one instance mounts at a time, see App.js
    // shouldMountSingleAgent). The mapping tests lock the event wiring.
    window.__bankingAgentMounted = true;
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    navigateMock.mockClear();
  });
  afterEach(() => {
    delete window.__bankingAgentMounted;
    dispatchSpy.mockRestore();
  });

  const clickRun = () =>
    fireEvent.click(
      screen.getByRole('button', { name: /run this attack in the live agent/i }),
    );
  const eventsByType = (type) =>
    dispatchSpy.mock.calls.map((c) => c[0]).filter((e) => e.type === type);

  it('prompt-injection fires the injection showcase and opens + closes the drawer', () => {
    const onClose = vi.fn();
    renderPanel({ onClose, initialTabId: 'prompt-injection' });
    clickRun();

    const showcase = eventsByType('banking-run-showcase');
    expect(showcase).toHaveLength(1);
    expect(showcase[0].detail).toMatchObject({ showcase: 'atk_prompt_injection' });
    expect(eventsByType('banking-agent-open')).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('indirect-injection fires the indirect-injection showcase', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'indirect-injection' });
    clickRun();
    expect(eventsByType('banking-run-showcase')[0].detail).toMatchObject({
      showcase: 'atk_indirect_injection',
    });
  });

  it('scope-abuse fires the scope-escalation showcase', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'scope-abuse' });
    clickRun();
    expect(eventsByType('banking-run-showcase')[0].detail).toMatchObject({
      showcase: 'atk_scope_escalation',
    });
  });

  // Ported from the old Actions dropdown's Security Showcase panel — these 3
  // tabs had no other reachable surface once BankingChips/SecurityShowcasePanel
  // were deleted. Same 'banking-run-showcase' wiring as the tabs above; the live
  // harness lives in AIAgent.js's runDrawerAttackRef.
  it('authz-deny fires the authz_deny showcase', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'authz-deny' });
    clickRun();
    expect(eventsByType('banking-run-showcase')[0].detail).toMatchObject({
      showcase: 'authz_deny',
    });
  });

  it('confused-deputy fires the atk_confused_deputy showcase', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'confused-deputy' });
    clickRun();
    expect(eventsByType('banking-run-showcase')[0].detail).toMatchObject({
      showcase: 'atk_confused_deputy',
    });
  });

  it('hitl-replay fires the atk_hitl_replay showcase', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'hitl-replay' });
    clickRun();
    expect(eventsByType('banking-run-showcase')[0].detail).toMatchObject({
      showcase: 'atk_hitl_replay',
    });
  });

  it('hitl-bypass runs the CATALOG use case and navigates with its triggerText', async () => {
    // Prompt text comes from the catalog at runtime — the panel hardcodes no
    // prompt and no dollar amount (the old free-text 'Transfer $1000' drifted
    // independently of the catalog and used a non-canonical amount).
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ useCaseId: 'hitl-consent-bypass-attempt', triggerText: 'transfer $600 from checking to savings', type: 'chip' }),
    });
    const onClose = vi.fn();
    renderPanel({ onClose, initialTabId: 'hitl-bypass' });
    clickRun();

    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/use-cases/demo/run', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ useCaseId: 'hitl-consent-bypass-attempt', vertical: 'banking' }),
    }));
    expect(navigateMock).toHaveBeenCalledWith('/dashboard', {
      state: expect.objectContaining({ triggerText: 'transfer $600 from checking to savings' }),
    });
    expect(eventsByType('banking-agent-prefill')).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('unauthorized-commitments runs its catalog use case the same way', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ useCaseId: 'unauthorized-commitment-fee-waiver', triggerText: 'Can you waive the fee on my checking account?', type: 'chip' }),
    });
    renderPanel({ onClose: vi.fn(), initialTabId: 'unauthorized-commitments' });
    clickRun();
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(navigateMock).toHaveBeenCalledWith('/dashboard', {
      state: expect.objectContaining({ triggerText: 'Can you waive the fee on my checking account?' }),
    });
    fetchMock.mockRestore();
  });

  it('does not persist or navigate when an agent is mounted', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'prompt-injection' });
    clickRun();
    expect(sessionStorage.getItem('banking-agent-pending-attack')).toBeNull();
  });
});

describe('AiAttacksPanel — no-agent fallback (flag unset)', () => {
  const originalLocation = window.location;
  let assignMock;

  beforeEach(() => {
    delete window.__bankingAgentMounted; // no AIAgent mounted on this route
    sessionStorage.removeItem('banking-agent-pending-attack');
    assignMock = vi.fn();
    delete window.location;
    window.location = { ...originalLocation, assign: assignMock };
  });
  afterEach(() => {
    window.location = originalLocation;
    sessionStorage.removeItem('banking-agent-pending-attack');
  });

  const clickRun = () =>
    fireEvent.click(
      screen.getByRole('button', { name: /run this attack in the live agent/i }),
    );

  it('showcase tab persists the pending run and navigates to /dashboard', () => {
    const onClose = vi.fn();
    renderPanel({ onClose, initialTabId: 'scope-abuse' });
    clickRun();

    expect(JSON.parse(sessionStorage.getItem('banking-agent-pending-attack'))).toEqual({
      type: 'showcase',
      payload: { showcase: 'atk_scope_escalation', label: 'Scope Abuse' },
    });
    expect(assignMock).toHaveBeenCalledWith('/dashboard');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('catalog tab ignores the agent-mounted flag — router state works from any route', async () => {
    // kind:'catalog' navigates with location.state, which the dashboard-mounting
    // agent consumes (AIAgent.js) — no sessionStorage handoff, no full reload,
    // regardless of window.__bankingAgentMounted.
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ useCaseId: 'hitl-consent-bypass-attempt', triggerText: 'transfer $600 from checking to savings', type: 'chip' }),
    });
    navigateMock.mockClear();
    const onClose = vi.fn();
    renderPanel({ onClose, initialTabId: 'hitl-bypass' });
    clickRun();
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
    expect(sessionStorage.getItem('banking-agent-pending-attack')).toBeNull();
    expect(assignMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });
});
