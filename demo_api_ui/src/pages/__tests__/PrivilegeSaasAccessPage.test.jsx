import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PrivilegeSaasAccessPage from '../PrivilegeSaasAccessPage';
import { SAAS_STAGES, SAAS_PLATFORMS, SAAS_DRIFT_ROWS } from '../../config/privilegePlatformUpdateDemos';

afterEach(() => vi.restoreAllMocks());

const advance = () => screen.getByTestId('psa-advance');

describe('PrivilegeSaasAccessPage (standalone UI standard)', () => {
  it('puts the simulation banner first, honestly, as a note', () => {
    const { container } = render(<PrivilegeSaasAccessPage />);
    const page = container.querySelector('.psa-page');
    const banner = screen.getByRole('note');
    expect(page.firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/simulat/i);
    expect(banner.textContent).toMatch(/nothing is granted/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SaaS Access Management');
  });

  it('shows exactly one primary button and a secondary Reset', () => {
    const { container } = render(<PrivilegeSaasAccessPage />);
    expect(container.querySelectorAll('button.psa-btn--primary')).toHaveLength(1);
    expect(advance().className).toContain('psa-btn--primary');
    expect(screen.getByTestId('psa-reset').className).not.toContain('primary');
    // The live check is a secondary here, never a second primary.
    const live = within(screen.getByTestId('privilege-live-check')).getByRole('button');
    expect(live.className).not.toContain('primary');
  });

  it('steps the stages with a word-bearing chip, and issues the receipt as a kv list at the grant stage', () => {
    render(<PrivilegeSaasAccessPage />);
    const stages = screen.getByTestId('psa-stages');
    expect(within(stages).getAllByRole('listitem')).toHaveLength(SAAS_STAGES.length);
    expect(stages.textContent).toMatch(/Current/);
    expect(screen.queryByTestId('psa-receipt')).toBeNull();
    fireEvent.click(advance());
    fireEvent.click(advance());
    const receipt = screen.getByTestId('psa-receipt');
    expect(receipt.querySelector('dl.psa-kv')).not.toBeNull();
    expect(receipt.textContent).toMatch(/grt-/);
    expect(within(stages).getAllByText('Done')).toHaveLength(2);
    fireEvent.click(advance());
    expect(advance().disabled).toBe(true);
    fireEvent.click(screen.getByTestId('psa-reset'));
    expect(screen.queryByTestId('psa-receipt')).toBeNull();
    expect(advance().disabled).toBe(false);
  });

  it('keeps the matrix and drift tables with their rows', () => {
    render(<PrivilegeSaasAccessPage />);
    expect(within(screen.getByTestId('psa-matrix')).getAllByRole('row')).toHaveLength(SAAS_PLATFORMS.length + 1);
    expect(within(screen.getByTestId('psa-drift-rows')).getAllByRole('row')).toHaveLength(SAAS_DRIFT_ROWS.length + 1);
    expect(screen.getByTestId('psa-scenario').tagName).toBe('SELECT');
  });

  it('renders the live verdict with a chip that carries the word', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ decision: 'denied', by: 'privilege-gateway', status: 403, latencyMs: 12 }),
    });
    render(<PrivilegeSaasAccessPage />);
    fireEvent.click(within(screen.getByTestId('privilege-live-check')).getByRole('button'));
    const verdict = await waitFor(() => screen.getByTestId('plc-verdict'));
    expect(verdict.querySelector('.plc__chip').textContent).toBe('Denied');
    expect(verdict.textContent).toMatch(/denied the call/);
  });
});
