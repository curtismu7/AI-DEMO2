// Wording that claims more than the page does: Intent Triage, Coding Agents and PII Detection.
// The modelled outcomes are samples (info tone, "Sample: would ..."), the live-check sections call a fictional
// sample tool through the gateway, and nothing claims a real record, a real ledger or a probe that did not run.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import PrivilegeIntentTriagePage from '../PrivilegeIntentTriagePage';
import PrivilegeCodingAgentsPage from '../PrivilegeCodingAgentsPage';
import PrivilegePiiDetectionPage from '../PrivilegePiiDetectionPage';
import { INTENT_TRIAGE_SCENARIOS, CODING_HOOK_SCENARIOS } from '../../config/privilegePlatformUpdateDemos';

const SAMPLE_TITLE = 'Call a tool through the gateway (sample data)';
const BAD_LIVE = /real record|for real|gateway's own log|live entitlement ledger|through live Privilege|Not simulated: the verdict/i;

describe('Intent Triage', () => {
  it('shows every modelled outcome as a sample in an info chip on a neutral card, never a coloured verdict', () => {
    render(<MemoryRouter><PrivilegeIntentTriagePage /></MemoryRouter>);
    for (const s of INTENT_TRIAGE_SCENARIOS) {
      fireEvent.click(screen.getAllByText(s.title)[0].closest('button'));
      const card = screen.getByTestId('triage-verdict');
      const chip = card.querySelector('.pu-chip');
      expect(chip.textContent, s.key).toMatch(/^Sample: would /);
      expect(chip.className, s.key).toContain('pu-chip--info');
      expect(card.className, s.key).toContain('pu-card--neutral');
      expect(card.textContent, s.key).toMatch(/Nothing was scored, refused or held on this machine/);
      expect(card.textContent, s.key).not.toMatch(/\b(Refused|Allowed|Pending approval)\b/);
    }
  });

  it('retitles the live call as a sample-tool call', () => {
    render(<MemoryRouter><PrivilegeIntentTriagePage /></MemoryRouter>);
    expect(screen.getByText('Gateway call (sample data)')).toBeTruthy();
    expect(within(screen.getByTestId('privilege-live-check')).getByRole('button').textContent).toBe('Call a sample tool through the gateway');
    expect(document.body.textContent).not.toMatch(BAD_LIVE);
    expect(document.body.textContent).toMatch(/fictional sample/);
  });
});

describe('Coding Agents', () => {
  const cleanScenario = CODING_HOOK_SCENARIOS.find((s) => !s.detection);

  it('does not say the evaluation ran, nor show a hardcoded reachability result', () => {
    render(<PrivilegeCodingAgentsPage />);
    fireEvent.click(screen.getAllByText('clean prompt')[0].closest('button'));
    const det = screen.getByTestId('pca-detection');
    expect(det.textContent).toMatch(/In the documented model the evaluation still runs/);
    expect(det.textContent).toMatch(/Nothing was evaluated here/);
    expect(det.textContent).not.toMatch(/still ran/);
    expect(det.querySelector('.pu-chip--ok')).toBeNull();
    expect(det.querySelector('.pu-chip').textContent).toBe('Modelled: no rule fired');
    expect(cleanScenario).toBeTruthy();
  });

  it('labels the JSON tab as a modelled response and drops the gatewayReachable literal', () => {
    render(<PrivilegeCodingAgentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Modelled response' }));
    expect(screen.getByTestId('pca-wire-note').textContent).toMatch(/not produced by a\s+gateway call/);
    expect(screen.getByTestId('pca-wire').textContent).not.toMatch(/gatewayReachable/);
    expect(screen.queryByRole('button', { name: 'What the hook returns' })).toBeNull();
  });

  it('retitles the live check as a sample-tool call', () => {
    render(<PrivilegeCodingAgentsPage />);
    expect(screen.getByRole('heading', { name: SAMPLE_TITLE })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(BAD_LIVE);
    expect(document.body.textContent).toMatch(/fictional sample/);
  });
});

describe('PII Detection', () => {
  it('retitles the live check: a call to a sample tool, not a real record', () => {
    render(<PrivilegePiiDetectionPage />);
    expect(screen.getByRole('heading', { name: SAMPLE_TITLE })).toBeTruthy();
    expect(within(screen.getByTestId('privilege-live-check')).getByRole('button').textContent).toBe('Call a sample tool through the gateway');
    expect(document.body.textContent).not.toMatch(BAD_LIVE);
    expect(document.body.textContent).toMatch(/fictional sample/);
  });
});
