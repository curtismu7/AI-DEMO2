/**
 * AiAttacksPanel.runButtons.test.jsx
 *
 * Locks the "Run this attack in the live agent" wiring: each tab's button must
 * drive the floating AI Agent through the window events it already listens for
 * (see AIAgent.js — 'banking-run-showcase' and 'banking-agent-prefill'), and
 * close the drawer so the agent is visible.
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
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });
  afterEach(() => {
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
});
