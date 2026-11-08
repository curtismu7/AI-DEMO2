import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('shows exactly one primary at a time: Open when sealed, Close when open; the live check never', () => {
    const { container } = render(<PrivilegePromptLogPage />);
    const primaries = () => [...container.querySelectorAll('button.pu-btn--primary')];
    expect(primaries()).toHaveLength(1);
    expect(screen.getByTestId('ppl-open').className).toContain('pu-btn--primary');
    const live = within(screen.getByTestId('privilege-live-check')).getByRole('button');
    expect(live.className).not.toContain('primary');
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByTestId('ppl-open'));
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toBe(screen.getByTestId('ppl-close'));
    expect(live.className).not.toContain('primary');
    fireEvent.click(screen.getByTestId('ppl-close'));
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toBe(screen.getByTestId('ppl-open'));
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

  it('records are chosen from the keyboard: a real button per row with aria-current on the selected one', async () => {
    const user = userEvent.setup();
    render(<PrivilegePromptLogPage />);
    const [first, second] = SEALED_PROMPT_RECORDS;
    const firstBtn = screen.getByTestId(`ppl-row-${first.id}`);
    const secondBtn = screen.getByTestId(`ppl-row-${second.id}`);
    expect(firstBtn.tagName).toBe('BUTTON');
    expect(firstBtn.getAttribute('aria-current')).toBe('true');
    expect(secondBtn.getAttribute('aria-current')).toBeNull();
    secondBtn.focus();
    expect(document.activeElement).toBe(secondBtn);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('ppl-detail').textContent).toContain(`Record ${second.id}`);
    expect(secondBtn.getAttribute('aria-current')).toBe('true');
    expect(firstBtn.getAttribute('aria-current')).toBeNull();
    firstBtn.focus();
    await user.keyboard(' ');
    expect(screen.getByTestId('ppl-detail').textContent).toContain(`Record ${first.id}`);
    expect(firstBtn.getAttribute('aria-current')).toBe('true');
  });

  it('a row control is named with its agent, category and decision, not just the id', () => {
    render(<PrivilegePromptLogPage />);
    const r = SEALED_PROMPT_RECORDS[0];
    expect(screen.getByTestId(`ppl-row-${r.id}`).getAttribute('aria-label')).toBe(`${r.id}, ${r.agent}, ${r.category}, ${r.decision}`);
  });

  it('choosing the record that is already selected keeps an open record open', () => {
    render(<PrivilegePromptLogPage />);
    fireEvent.change(screen.getByLabelText(/private key/i), { target: { value: 'k' } });
    fireEvent.click(screen.getByTestId('ppl-open'));
    fireEvent.click(screen.getByTestId(`ppl-row-${SEALED_PROMPT_RECORDS[0].id}`));
    expect(screen.getByTestId('ppl-close')).toBeTruthy();
    expect(screen.queryByTestId('ppl-sealed')).toBeNull();
  });

  it('keeps keyboard focus on the one primary as it turns from Open into Close and back', async () => {
    const user = userEvent.setup();
    render(<PrivilegePromptLogPage />);
    await user.type(screen.getByLabelText(/private key/i), 'k');
    await user.keyboard('{Tab}');
    const primary = screen.getByTestId('ppl-open');
    expect(document.activeElement).toBe(primary);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('ppl-close')).toBe(primary);
    expect(document.activeElement).toBe(primary);
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('ppl-open')).toBe(primary);
    expect(document.activeElement).toBe(primary);
    expect(screen.getByLabelText(/private key/i).value).toBe('');
  });

  it('forgets the typed private key and any error when another record is chosen', async () => {
    const user = userEvent.setup();
    render(<PrivilegePromptLogPage />);
    const key = screen.getByLabelText(/private key/i);
    fireEvent.change(key, { target: { value: 'my-secret-key' } });
    expect(screen.getByLabelText(/private key/i).value).toBe('my-secret-key');
    await user.click(screen.getByTestId(`ppl-row-${SEALED_PROMPT_RECORDS[1].id}`));
    expect(screen.getByLabelText(/private key/i).value).toBe('');
    // Come back to the first record: the key must still be gone, so Open fails until one is typed again.
    await user.click(screen.getByTestId(`ppl-row-${SEALED_PROMPT_RECORDS[0].id}`));
    expect(screen.getByLabelText(/private key/i).value).toBe('');
    fireEvent.click(screen.getByTestId('ppl-open'));
    expect(screen.getByRole('alert').textContent).toMatch(/Enter the private key/);
    expect(screen.queryByTestId('ppl-plaintext')).toBeNull();
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
