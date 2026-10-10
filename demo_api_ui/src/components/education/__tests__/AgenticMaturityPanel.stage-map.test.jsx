// Agentic Maturity Model (coverage plan row — LINK): map each model stage to
// the numbered demo steps whose attack/defense runs it. Mirrors the
// enforced-by pattern on BestPracticesPanel.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import AgenticMaturityPanel from '../AgenticMaturityPanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';
import { demoStepNumber } from '../../../config/demoStepNumbers';

const renderTab = (tabId) => render(
  <EducationUIProvider>
    <AgenticMaturityPanel isOpen onClose={() => {}} initialTabId={tabId} />
  </EducationUIProvider>,
);

describe('AgenticMaturityPanel — stage → demo steps map', () => {
  it('In This Demo tab carries the stage map', () => {
    const { baseElement } = renderTab('demo');
    expect(baseElement.textContent).toContain('Where each stage runs in the demo');
  });

  it('every named UC is a numbered demo step', () => {
    // Extract all data-stage-uc values from the rendered map — a renamed or
    // retired UC fails here instead of leaving a dead reference on the panel.
    const { baseElement } = renderTab('demo');
    const ucs = [...baseElement.querySelectorAll('[data-stage-uc]')].map((el) => el.getAttribute('data-stage-uc'));
    expect(ucs.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ucs).size).toBe(ucs.length); // no duplicate cites
    for (const uc of ucs) {
      expect(demoStepNumber(uc)).toBeGreaterThan(0);
    }
  });

  it('maps the headline stages: UC24 at Level 1, UC8 on HITL, UC29 on audit/fail-safe', () => {
    const html = renderTab('demo').baseElement.innerHTML;
    expect(html).toContain('data-stage-uc="UC24"');
    expect(html).toContain('data-stage-uc="UC8"');
    expect(html).toContain('data-stage-uc="UC29"');
  });
});
