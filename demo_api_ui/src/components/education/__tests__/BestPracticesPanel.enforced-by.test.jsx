// Best-practices annotations (coverage plan row "Best Practices" — LINK:
// annotate each practice with the attack-lane use case that enforces it).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import BestPracticesPanel from '../BestPracticesPanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';
import { demoStepNumber } from '../../../config/demoStepNumbers';
import { PRACTICE_ENFORCEMENT } from '../../../config/bestPracticeEnforcement';

const PRACTICE_TABS = ['know', 'detect', 'delegate', 'privilege', 'hitl'];

const renderTab = (tabId) => render(
  <EducationUIProvider>
    <BestPracticesPanel isOpen onClose={() => {}} initialTabId={tabId} />
  </EducationUIProvider>,
);

describe('BestPracticesPanel — where the demo enforces each practice', () => {
  it.each(PRACTICE_TABS)('practice tab "%s" carries the enforcement card', (tabId) => {
    const { baseElement } = renderTab(tabId);
    expect(baseElement.textContent).toContain('Where the demo enforces this');
  });

  it('every named UC is a numbered demo step', () => {
    // A renamed or retired UC breaks this test instead of leaving a dead
    // reference on the panel. (Catalog existence is pinned by the drift gate
    // on demoStepNumbers: step numbers derive from the live script.)
    const ids = Object.values(PRACTICE_ENFORCEMENT).flatMap((b) => b.rows.map((r) => r.uc));
    expect(ids.length).toBeGreaterThanOrEqual(10);
    for (const id of ids) {
      expect(demoStepNumber(id)).toBeGreaterThan(0);
    }
  });

  it('maps the headline controls: UC16b on Delegation, UC14 on Least Privilege, UC8 on HITL', () => {
    const del = renderTab('delegate').baseElement.innerHTML;
    expect(del).toContain('data-enforced-uc="UC16b"');
    const priv = renderTab('privilege').baseElement.innerHTML;
    expect(priv).toContain('data-enforced-uc="UC14"');
    const hitl = renderTab('hitl').baseElement.innerHTML;
    expect(hitl).toContain('data-enforced-uc="UC8"');
  });
});
