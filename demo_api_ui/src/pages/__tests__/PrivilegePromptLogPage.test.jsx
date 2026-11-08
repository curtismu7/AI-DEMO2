import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PrivilegePromptLogPage from '../PrivilegePromptLogPage';
import { SEALED_PROMPT_RECORDS } from '../../config/privilegePlatformUpdateDemos';

afterEach(() => vi.restoreAllMocks());

describe('PrivilegePromptLogPage (standalone UI standard)', () => {
  it('puts the sample-data banner first, honestly, as a note', () => {
    const { container } = render(<PrivilegePromptLogPage />);
    const banner = screen.getByRole('note');
    expect(container.querySelector('.ppl-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/sample/i);
    expect(banner.textContent).toMatch(/no encryption runs/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Prompt Logging, encrypted to you');
  });

  it('shows exactly one primary button; the live check and Close are secondaries', () => {
    const { container } = render(<PrivilegePromptLogPage />);
    expect(container.querySelectorAll('button.pu-btn--primary')).toHaveLength(1);
    expect(screen.getByTestId('ppl-open').className).toContain('pu-btn--primary');
    const live = within(screen.getByTestId('privilege-live-check')).getByRole('button');
    expect(live.className).not.toContain('primary');
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByTestId('ppl-open'));
    expect(container.querySelectorAll('button.pu-btn--primary')).toHaveLength(0);
  });

  it('lists every record with a decision chip that carries the word', () => {
    render(<PrivilegePromptLogPage />);
    const table = screen.getByTestId('ppl-records');
    expect(within(table).getAllByRole('row')).toHaveLength(SEALED_PROMPT_RECORDS.length + 1);
    expect(table.querySelectorAll('.pu-chip')).toHaveLength(SEALED_PROMPT_RECORDS.length);
    expect(within(table).getByText('block').className).toContain('pu-chip--danger');
    expect(screen.getByTestId('ppl-detail').querySelector('dl.pu-kv')).not.toBeNull();
  });

  it('keeps a record sealed until a key is entered, then closes and forgets it', () => {
    render(<PrivilegePromptLogPage />);
    expect(screen.getByTestId('ppl-sealed')).toBeTruthy();
    expect(screen.queryByTestId('ppl-plaintext')).toBeNull();
    fireEvent.click(screen.getByTestId('ppl-open'));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter the private key/);
    expect(screen.queryByTestId('ppl-plaintext')).toBeNull();
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByTestId('ppl-open'));
    expect(screen.getByTestId('ppl-plaintext')).toBeTruthy();
    expect(screen.getByTestId('ppl-detail').textContent).toMatch(/Decrypted/);
    fireEvent.click(screen.getByText('Close and forget the key'));
    expect(screen.getByTestId('ppl-sealed')).toBeTruthy();
    expect(screen.getByLabelText(/private key/i).value).toBe('');
  });

  it('selecting another record re-seals the view and shows that record', () => {
    render(<PrivilegePromptLogPage />);
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByTestId('ppl-open'));
    fireEvent.click(within(screen.getByTestId('ppl-records')).getByText(SEALED_PROMPT_RECORDS[1].id));
    expect(screen.getByTestId('ppl-detail').textContent).toContain(`Record ${SEALED_PROMPT_RECORDS[1].id}`);
    expect(screen.getByTestId('ppl-sealed')).toBeTruthy();
  });

  it('renders the live verdict with a chip that carries the word', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ decision: 'denied', by: 'privilege-gateway', status: 403, latencyMs: 12 }),
    });
    render(<PrivilegePromptLogPage />);
    fireEvent.click(within(screen.getByTestId('privilege-live-check')).getByRole('button'));
    const verdict = await waitFor(() => screen.getByTestId('plc-verdict'));
    expect(verdict.querySelector('.plc__chip').textContent).toBe('Denied');
  });
});
