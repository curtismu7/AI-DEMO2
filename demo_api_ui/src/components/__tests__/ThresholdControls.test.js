// ThresholdControls.test.js
// Task 7 — first tests for ThresholdControls.js. Covers what Task 6 changed
// (global thresholds + feature flags are now read-only with links to
// /settings and /feature-flags, no POST from those sections) and confirms
// what Task 6 deliberately left alone (per-vertical thresholds still fully
// editable).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ThresholdControls from '../ThresholdControls';

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url === '/api/config/thresholds') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ confirm_threshold_usd: '250', mfa_threshold_usd: '500' }),
      });
    }
    if (url === '/api/verticals/list') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url === '/api/admin/feature-flags') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          flags: [
            { id: 'ff_hitl_enabled', value: true },
            { id: 'ff_authorize_simulated', value: false },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: false });
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Controls' }));
  await waitFor(() => screen.getByRole('dialog', { name: 'Demo controls' }));
}

describe('ThresholdControls', () => {
  it('shows global thresholds as read-only text with a link to /settings, no Save button', async () => {
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    expect(await screen.findByText('250')).toBeInTheDocument();
    expect(await screen.findByText('500')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save thresholds/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm \(consent\)/i)).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /edit in settings/i });
    expect(link).toHaveAttribute('href', '/settings');
  });

  it('never POSTs to /api/config/thresholds from the global-thresholds section', async () => {
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    await screen.findByText('250');
    const postCalls = global.fetch.mock.calls.filter(
      ([, opts]) => opts && opts.method === 'POST'
    );
    expect(postCalls).toHaveLength(0);
  });

  it('shows feature flags as read-only on/off text with a link to /feature-flags, no checkboxes', async () => {
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    await waitFor(() => screen.getByText('Human-in-the-Loop Consent'));
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /edit in feature flags/i });
    expect(link).toHaveAttribute('href', '/feature-flags');
  });

  it('per-vertical thresholds section is untouched: selecting a vertical still shows editable inputs', async () => {
    global.fetch = vi.fn((url) => {
      if (url === '/api/config/thresholds') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ confirm_threshold_usd: '250', mfa_threshold_usd: '500' }),
        });
      }
      if (url === '/api/verticals/list') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: 'banking', displayName: 'Banking' }]),
        });
      }
      if (url.startsWith('/api/config/thresholds?vertical=')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      if (url === '/api/admin/feature-flags') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ flags: [] }) });
      }
      return Promise.resolve({ ok: false });
    });
    renderWithRouter(<ThresholdControls />);
    await openPanel();
    fireEvent.click(await screen.findByText('Per-Vertical Thresholds'));
    const select = await screen.findByLabelText('Vertical');
    fireEvent.change(select, { target: { value: 'banking' } });
    expect(await screen.findByText('Save for banking')).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm \(consent\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mfa step-up/i)).toBeInTheDocument();
  });
});
