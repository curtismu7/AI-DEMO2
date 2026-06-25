/* eslint-disable testing-library/no-unnecessary-act */
/* eslint-disable testing-library/no-node-access */
/* eslint-disable testing-library/no-render-in-setup */
/* eslint-disable testing-library/prefer-find-by */
/* eslint-disable testing-library/no-wait-for-multiple-assertions */
/* eslint-disable testing-library/no-wait-for-side-effects */
/* eslint-disable testing-library/no-container */
/**
 * Tests for CimdSimPanel component
 *
 * Covers:
 *   - FAB button rendering and toggle
 *   - Tab navigation (all 7 tabs)
 *   - 'education-open-cimd' CustomEvent listener
 *   - Simulate tab state machine (idle → running → done)
 *   - Simulate tab reset
 *   - Real-document pre-fetch (success + failure fallback)
 *   - Overlay click closes panel
 *   - Drawer accessibility attributes
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import axios from 'axios';
import CimdSimPanel from '../CimdSimPanel';

vi.mock('axios');

// ── Helpers ───────────────────────────────────────────────────────────────────

function openPanel() {
  // FAB removed; panel opens via CustomEvent (as dispatched by BankingAgent / EducationBar)
  act(() => {
    window.dispatchEvent(new CustomEvent('education-open-cimd', { detail: {} }));
  });
}

function clickTab(name) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.click(tab);
}

// ── FAB button ────────────────────────────────────────────────────────────────

describe('CimdSimPanel — FAB button', () => {
  afterEach(() => jest.clearAllMocks());

  it('does not render a FAB button (FAB removed in favour of CustomEvent)', () => {
    render(<CimdSimPanel />);
    expect(screen.queryByRole('button', { name: /open cimd guide/i })).not.toBeInTheDocument();
  });

  it('drawer is closed and has no visible text before openPanel()', () => {
    render(<CimdSimPanel />);
    // The FAB label "CIMD Simulator" is no longer in the DOM — test that it is absent
    expect(screen.queryByText('CIMD Simulator')).not.toBeInTheDocument();
  });

  it('drawer is hidden on initial render', () => {
    render(<CimdSimPanel />);
    const drawer = screen.getByRole('dialog', { hidden: true });
    expect(drawer).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the drawer when FAB is clicked', () => {
    render(<CimdSimPanel />);
    openPanel();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-hidden', 'false');
  });

  it('closes the drawer using ESC key (FAB toggle removed)', () => {
    render(<CimdSimPanel />);
    openPanel();
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes the drawer when the close button is clicked', () => {
    render(<CimdSimPanel />);
    openPanel();
    const closeBtn = screen.getByRole('button', { name: /close cimd panel/i });
    fireEvent.click(closeBtn);
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes when the overlay backdrop is clicked', () => {
    render(<CimdSimPanel />);
    openPanel();
    const overlay = document.querySelector('.cimd-overlay');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay);
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });
});

// ── Tab navigation ────────────────────────────────────────────────────────────

describe('CimdSimPanel — tab navigation', () => {
  beforeEach(() => { render(<CimdSimPanel />); openPanel(); });
  afterEach(() => jest.clearAllMocks());

  it('defaults to the "What is CIMD" tab', () => {
    expect(screen.getByRole('tab', { name: 'What is CIMD' })).toHaveClass('cimd-tab--active');
  });

  it('renders all 7 tabs', () => {
    ['What is CIMD', 'CIMD vs DCR', 'Doc format', 'How AS uses it', 'Flow diagram', '▶ Simulate', 'PingOne']
      .forEach(label => {
        expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
      });
  });

  it('switches to "CIMD vs DCR" tab and shows comparison table', () => {
    clickTab('CIMD vs DCR');
    expect(screen.getByRole('tab', { name: 'CIMD vs DCR' })).toHaveClass('cimd-tab--active');
    // Table has a column header for DCR
    expect(screen.getByRole('columnheader', { name: /DCR/i })).toBeInTheDocument();
  });

  it('switches to "Doc format" tab and shows JSON schema', () => {
    clickTab('Doc format');
    expect(screen.getByText(/client_name/)).toBeInTheDocument();
  });

  it('switches to "How AS uses it" tab', () => {
    clickTab('How AS uses it');
    // Step 2 in the list: "Fetch the document"
    expect(screen.getByText('Fetch the document')).toBeInTheDocument();
  });

  it('switches to "Flow diagram" tab', () => {
    clickTab('Flow diagram');
    // The ASCII diagram contains this text somewhere in the rendered output
    expect(document.body.textContent).toMatch(/CIMD Registration/i);
  });

  it('switches to "▶ Simulate" tab and shows idle state', () => {
    clickTab('▶ Simulate');
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeInTheDocument();
  });

  it('switches to "PingOne" tab and shows setup steps', () => {
    clickTab('PingOne');
    expect(screen.getByText(/Log in as admin/i)).toBeInTheDocument();
  });
});

// ── education-open-cimd event ─────────────────────────────────────────────────

describe('CimdSimPanel — education-open-cimd event', () => {
  afterEach(() => jest.clearAllMocks());

  it('opens the drawer when the event is dispatched', () => {
    render(<CimdSimPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('education-open-cimd', { detail: {} }));
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-hidden', 'false');
  });

  it('switches to the requested tab via event detail.tab', () => {
    render(<CimdSimPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('education-open-cimd', { detail: { tab: 'vs-dcr' } }));
    });
    expect(screen.getByRole('tab', { name: 'CIMD vs DCR' })).toHaveClass('cimd-tab--active');
  });

  it('opens to simulate tab via event detail', () => {
    render(<CimdSimPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('education-open-cimd', { detail: { tab: 'simulate' } }));
    });
    expect(screen.getByRole('tab', { name: '▶ Simulate' })).toHaveClass('cimd-tab--active');
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeInTheDocument();
  });

  it('removes the event listener on unmount', () => {
    const { unmount } = render(<CimdSimPanel />);
    const spy = jest.spyOn(window, 'removeEventListener');
    unmount();
    expect(spy).toHaveBeenCalledWith('education-open-cimd', expect.any(Function));
  });
});

// ── Simulate tab — idle / running / done (manual Next-button navigation) ────────

describe('CimdSimPanel — Simulate tab state machine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    axios.get.mockRejectedValue(new Error('network'));
    render(<CimdSimPanel />);
    openPanel();
    clickTab('▶ Simulate');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows idle state initially — Run Simulation button visible, no progress bar', () => {
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('transitions to running when Run Simulation is clicked', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders step 0 (Authorization Request) immediately after starting', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    expect(screen.getByText(/① Authorization Request/i)).toBeInTheDocument();
  });

  it('shows a Next button on step 0 instead of auto-advancing', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    // Must find the Next button — there should be NO timer-driven auto-advance
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('advances to step 1 (AS Detects URL) when Next is clicked on step 0', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    const nextBtn = screen.getByRole('button', { name: /next/i });
    await act(async () => { fireEvent.click(nextBtn); });
    expect(screen.getByText(/② AS Detects URL client_id/i)).toBeInTheDocument();
  });

  it('step 1 also shows a Next button (not auto-advancing)', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    // Still on step 1, Next button should be present
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('step 2 shows a Fetch Document button instead of generic Next', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    // Step 0 → 1
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    // Step 1 → 2
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    // Now on step 2: AS Fetches Metadata Document
    expect(screen.getByText(/③ AS Fetches Metadata Document/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fetch document/i })).toBeInTheDocument();
  });

  it('Fetch Document button advances to step 3 and shows the document', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); }); // → 1
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); }); // → 2

    const fetchBtn = screen.getByRole('button', { name: /fetch document/i });
    await act(async () => {
      fireEvent.click(fetchBtn);
      jest.runAllTimers(); // advance the 900ms spinner
    });

    // Step 3: Metadata Document Received
    expect(screen.getByText(/④ Metadata Document Received/i)).toBeInTheDocument();
  });

  it('shows reset button only after reaching the final step', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    // Steps 0 → 1 → 2
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    // Step 2 → 3 (fetch)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fetch document/i }));
      jest.runAllTimers();
    });
    // Steps 3 → 4 → 5 (final)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    expect(screen.getByText(/↩ Reset simulation/i)).toBeInTheDocument();
  });

  it('reset returns to idle state', async () => {
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fetch document/i }));
      jest.runAllTimers();
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /next/i })); });
    const resetBtn = screen.getByText(/↩ Reset simulation/i);
    fireEvent.click(resetBtn);
    expect(screen.getByRole('button', { name: /run simulation/i })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

// ── Real document pre-fetch ───────────────────────────────────────────────────

describe('CimdSimPanel — real document pre-fetch', () => {
  const REAL_DOC = {
    client_id: 'https://example.com/.well-known/oauth-client/real-app-id',
    client_name: 'Real App',
    application_type: 'web',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    redirect_uris: ['https://example.com/callback'],
    token_endpoint_auth_method: 'client_secret_basic',
    scope: 'openid profile',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    render(<CimdSimPanel />);
    openPanel();
    clickTab('▶ Simulate');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('does NOT call axios when ID field is empty', async () => {
    axios.get.mockRejectedValue(new Error('should not be called'));
    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('pre-fetches real document when client ID is entered', async () => {
    axios.get.mockResolvedValue({ data: REAL_DOC });

    const input = screen.getByPlaceholderText(/PingOne app ID/i);
    fireEvent.change(input, { target: { value: 'real-app-id' } });

    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });

    expect(axios.get).toHaveBeenCalledWith(
      '/.well-known/oauth-client/real-app-id',
      expect.objectContaining({ withCredentials: false })
    );
  });

  it('falls back to demo doc silently when real fetch fails', async () => {
    axios.get.mockRejectedValue(new Error('not found'));

    const input = screen.getByPlaceholderText(/PingOne app ID/i);
    fireEvent.change(input, { target: { value: 'bad-id' } });

    const runBtn = screen.getByRole('button', { name: /run simulation/i });
    await act(async () => { fireEvent.click(runBtn); });

    // Simulation still starts despite fetch failure
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────────

describe('CimdSimPanel — accessibility', () => {
  afterEach(() => jest.clearAllMocks());

  it('drawer has role="dialog"', () => {
    render(<CimdSimPanel />);
    openPanel();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('tab list has role="tablist"', () => {
    render(<CimdSimPanel />);
    openPanel();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('active tab has aria-selected="true"', () => {
    render(<CimdSimPanel />);
    openPanel();
    expect(screen.getByRole('tab', { name: 'What is CIMD' })).toHaveAttribute('aria-selected', 'true');
  });

  it('inactive tab has aria-selected="false"', () => {
    render(<CimdSimPanel />);
    openPanel();
    expect(screen.getByRole('tab', { name: 'CIMD vs DCR' })).toHaveAttribute('aria-selected', 'false');
  });
});
