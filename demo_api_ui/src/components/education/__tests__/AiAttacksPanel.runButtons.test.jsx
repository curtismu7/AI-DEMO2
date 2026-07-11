/**
 * AiAttacksPanel.runButtons.test.jsx
 *
 * Locks the "Run this attack in the live agent" wiring: each tab's button must
 * drive the mounted AI Agent (floating or inline) through the window events it
 * already listens for (see AIAgent.js — 'banking-run-showcase' and
 * 'banking-agent-prefill'), and close the drawer so the agent is visible.
 * When no agent is mounted (window.__bankingAgentMounted unset), the button
 * must persist the pending run to sessionStorage and navigate to /admin.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AiAttacksPanel from '../AiAttacksPanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';

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

  it('hitl-bypass auto-sends the transfer prompt (no showcase)', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'hitl-bypass' });
    clickRun();

    expect(eventsByType('banking-run-showcase')).toHaveLength(0);
    const prefill = eventsByType('banking-agent-prefill');
    expect(prefill).toHaveLength(1);
    expect(prefill[0].detail).toMatchObject({
      message: 'Transfer $1000 to savings',
      autoSend: true,
    });
  });

  it('unauthorized-commitments auto-sends the fee-waiver prompt', () => {
    renderPanel({ onClose: vi.fn(), initialTabId: 'unauthorized-commitments' });
    clickRun();
    expect(eventsByType('banking-agent-prefill')[0].detail).toMatchObject({
      message: 'Can you waive the fee on my checking account?',
      autoSend: true,
    });
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

  it('showcase tab persists the pending run and navigates to /admin', () => {
    const onClose = vi.fn();
    renderPanel({ onClose, initialTabId: 'scope-abuse' });
    clickRun();

    expect(JSON.parse(sessionStorage.getItem('banking-agent-pending-attack'))).toEqual({
      type: 'showcase',
      payload: { showcase: 'atk_scope_escalation', label: 'Scope Abuse' },
    });
    expect(assignMock).toHaveBeenCalledWith('/admin');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('prompt tab persists the pending prefill and navigates to /admin', () => {
    const onClose = vi.fn();
    renderPanel({ onClose, initialTabId: 'hitl-bypass' });
    clickRun();

    expect(JSON.parse(sessionStorage.getItem('banking-agent-pending-attack'))).toEqual({
      type: 'prefill',
      payload: { message: 'Transfer $1000 to savings', autoSend: true },
    });
    expect(assignMock).toHaveBeenCalledWith('/admin');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
