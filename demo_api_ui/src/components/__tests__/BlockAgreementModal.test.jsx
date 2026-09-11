import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BlockAgreementModal, { blockAgreementOutcome } from '../BlockAgreementModal';

describe('blockAgreementOutcome', () => {
  it('off: ML blocks alone regardless of the deterministic layer', () => {
    expect(blockAgreementOutcome('off', 'none', true).blocked).toBe(true);
    expect(blockAgreementOutcome('off', 'none', true).mlHonored).toBe(true);
  });

  it('unit: ML honored only when a deterministic detector fired on the same unit', () => {
    expect(blockAgreementOutcome('unit', 'same_unit', true).mlHonored).toBe(true);
    expect(blockAgreementOutcome('unit', 'elsewhere', true).mlHonored).toBe(false);
    expect(blockAgreementOutcome('unit', 'none', true).mlHonored).toBe(false);
  });

  it('unit + ML-only on a benign prompt: allowed as an alert (the live-test case)', () => {
    const o = blockAgreementOutcome('unit', 'none', true);
    expect(o.blocked).toBe(false);
    expect(o.tone).toBe('alert');
  });

  it('inspection: ML honored when a deterministic detector fired anywhere', () => {
    expect(blockAgreementOutcome('inspection', 'elsewhere', true).mlHonored).toBe(true);
    expect(blockAgreementOutcome('inspection', 'none', true).mlHonored).toBe(false);
  });

  it('a deterministic hit blocks on its own even when ML is silent', () => {
    const o = blockAgreementOutcome('unit', 'elsewhere', false);
    expect(o.blocked).toBe(true);
    expect(o.mlHonored).toBe(false);
    expect(o.tone).toBe('blocked');
  });

  it('nothing flagged: allowed', () => {
    expect(blockAgreementOutcome('off', 'none', false).tone).toBe('allow');
  });
});

describe('BlockAgreementModal', () => {
  it('starts on the live-test case (unit + ML, alert) and blocks when switched to off', () => {
    render(<BlockAgreementModal isOpen onClose={() => {}} />);
    expect(screen.getByText(/logged as an alert/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/ML Blocks Alone/i));
    expect(screen.getByText(/Request blocked/i)).toBeTruthy();
  });
});
