import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import bffAxios from '../../services/bffAxios';
import PingOneVerifyRecognizePage from '../PingOneVerifyRecognizePage';

vi.mock('../../services/bffAxios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const renderPage = () => render(<MemoryRouter><PingOneVerifyRecognizePage /></MemoryRouter>);
const availability = (data) => bffAxios.get.mockImplementation((url) => (
  url === '/api/verify/availability' ? Promise.resolve({ data }) : Promise.resolve({ data: {} })
));
const primaries = (c) => c.querySelectorAll('button.pu-btn--primary');

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.clearAllMocks(); });
beforeEach(() => availability({ enabled: true, available: true }));

describe('PingOneVerifyRecognizePage (Ping UI Standard)', () => {
  it('puts the banner first, as a note, honest that only the card is live and Recognize is not enabled', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.pvr-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/explainer with one live card/i);
    expect(banner.textContent).toMatch(/BFF/);
    expect(banner.textContent).toMatch(/nothing here is simulated/i);
    expect(banner.textContent).toMatch(/Recognize is not enabled/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PingOne Verify & Recognize');
  });

  it('keeps the lesson sections the section nav points at', () => {
    renderPage();
    ['overview', 'verify', 'recognize', 'architecture'].forEach((id) => expect(document.getElementById(id)).not.toBeNull());
  });

  it('uses cards, word-bearing chips and a key-value list', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('.pu-card').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelectorAll('dl.pu-kv')).toHaveLength(1);
    container.querySelectorAll('.pu-chip').forEach((chip) => expect(chip.textContent.trim().length).toBeGreaterThan(0));
    expect(screen.getByTestId('pvr-gate').className).toContain('pu-card--warn');
    expect(screen.getByTestId('pvr-gate').textContent).toMatch(/Gated/);
  });

  it('shows no primary while the card has nothing to do, then one when Verify is ready', async () => {
    const { container } = renderPage();
    expect(primaries(container)).toHaveLength(0); // checking availability
    const start = await screen.findByRole('button', { name: 'Verify identity' });
    expect(start.className).toContain('pu-btn--primary');
    expect(primaries(container)).toHaveLength(1);
    expect(container.querySelector('.pvr-verify-card .pu-chip').textContent).toBe('Ready');
  });

  it('has no primary when signed out, disabled, or not eligible, and each chip says so', async () => {
    for (const [data, word] of [
      [{ enabled: false, available: false }, 'Disabled'],
      [{ enabled: true, available: false }, 'Not eligible'],
    ]) {
      availability(data);
      const { container, unmount } = renderPage();
      await waitFor(() => expect(container.querySelector('.pvr-verify-card .pu-chip').textContent).toBe(word));
      expect(primaries(container)).toHaveLength(0);
      unmount();
    }
    // Signed out: only the availability read fails (other shell reads are not this card's concern).
    bffAxios.get.mockImplementation((url) => (url === '/api/verify/availability' ? Promise.reject(new Error('401')) : Promise.resolve({ data: {} })));
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('.pvr-verify-card .pu-chip').textContent).toBe('Unavailable'));
    expect(screen.getByText(/Sign in and try again/)).toBeInTheDocument();
    expect(primaries(container)).toHaveLength(0);
  });

  it('keeps focus on the button while a start is in flight (aria-disabled, never disabled) and does not post twice', async () => {
    let reject;
    bffAxios.post.mockReturnValue(new Promise((_, r) => { reject = r; }));
    const { container } = renderPage();
    const start = await screen.findByRole('button', { name: 'Verify identity' });
    start.focus();
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => expect(start.textContent).toBe('Starting verification…'));
    expect(start.getAttribute('aria-disabled')).toBe('true');
    expect(start.disabled).toBe(false);
    expect(document.activeElement).toBe(start);
    expect(bffAxios.post).toHaveBeenCalledTimes(1);
    expect(primaries(container)).toHaveLength(1);
    reject(new Error('down'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start identity verification/i);
    expect(document.activeElement).toBe(start);
    expect(start.getAttribute('aria-disabled')).toBeNull();
  });

  it('shows Verified only for SUCCESS, with no primary, and never for a manual approval', async () => {
    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 't1');
    bffAxios.get.mockImplementation((url) => (url === '/api/verify/availability'
      ? Promise.resolve({ data: { enabled: true, available: true } })
      : Promise.resolve({ data: { id: 't1', status: 'SUCCESS', canEnrollRecognize: false } })));
    const { container, unmount } = renderPage();
    await waitFor(() => expect(container.querySelector('.pvr-verify-card .pu-chip').textContent).toBe('Verified'));
    expect(container.querySelector('.pvr-verify-card').className).toContain('pu-card--ok');
    expect(primaries(container)).toHaveLength(0);
    unmount();

    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 't1');
    bffAxios.get.mockImplementation((url) => (url === '/api/verify/availability'
      ? Promise.resolve({ data: { enabled: true, available: true } })
      : Promise.resolve({ data: { id: 't1', status: 'APPROVED_MANUALLY' } })));
    const second = renderPage();
    await waitFor(() => expect(second.container.querySelector('.pvr-verify-card .pu-chip').textContent).toBe('Not confirmed'));
    expect(second.container.querySelector('.pvr-verify-card').className).not.toContain('pu-card--ok');
  });

  it('makes "Start a new verification" the one primary after a failure and moves focus to the new primary', async () => {
    window.sessionStorage.setItem('pingone.verify.activeTransactionId', 't1');
    bffAxios.get.mockImplementation((url) => (url === '/api/verify/availability'
      ? Promise.resolve({ data: { enabled: true, available: true } })
      : Promise.resolve({ data: { id: 't1', status: 'FAIL' } })));
    const { container } = renderPage();
    const again = await screen.findByRole('button', { name: 'Start a new verification' });
    expect(container.querySelector('.pvr-verify-card .pu-chip').textContent).toBe('Not verified');
    expect(again.className).toContain('pu-btn--primary');
    expect(primaries(container)).toHaveLength(1);
    again.focus();
    fireEvent.click(again);
    const start = await screen.findByRole('button', { name: 'Verify identity' });
    expect(document.activeElement).toBe(start);
    expect(primaries(container)).toHaveLength(1);
  });

  it('does not use the violet Profile button classes on this page', async () => {
    const { container } = renderPage();
    await screen.findByRole('button', { name: 'Verify identity' });
    expect(container.querySelector('.up-btn')).toBeNull();
    expect(container.querySelector('.up-card')).toBeNull();
  });
});
