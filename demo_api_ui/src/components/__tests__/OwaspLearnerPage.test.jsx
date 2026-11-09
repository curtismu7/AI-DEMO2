import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

const toggleDarkMode = vi.fn();
vi.mock('../../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode }),
}));

import OwaspLearnerPage from '../OwaspLearnerPage';

const renderPage = () => render(<MemoryRouter><OwaspLearnerPage /></MemoryRouter>);

describe('OwaspLearnerPage (standalone UI standard)', () => {
  it('puts an honest static-lesson banner first, as a note, with the page testid kept', () => {
    const { container } = renderPage();
    const root = screen.getByTestId('owasp-learner-page');
    const banner = screen.getByRole('note');
    expect(root.firstElementChild.contains(banner)).toBe(true);
    expect(container.querySelector('.pu-page')).toBe(root);
    expect(banner.textContent).toMatch(/static lesson/i);
    expect(banner.textContent).toMatch(/nothing on this page is simulated/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OWASP: Securing Agentic Applications');
  });

  it('has exactly one primary: the source-guide link, leaving the page safely', () => {
    const { container } = renderPage();
    const primaries = container.querySelectorAll('.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    const link = primaries[0];
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://genai.owasp.org/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    // every other control is a plain pu-btn secondary
    container.querySelectorAll('button').forEach((b) => {
      expect(b.className).toContain('pu-btn');
      expect(b.className).not.toContain('primary');
    });
  });

  it('shows cards, a kv list and word-bearing chips, grouped by how the demo treats each threat', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('.pu-card').length).toBeGreaterThan(10);
    expect(screen.getByTestId('owasp-source').querySelector('dl.pu-kv')).not.toBeNull();
    const chips = [...container.querySelectorAll('.pu-chip')].map((c) => c.textContent.trim());
    expect(chips).toEqual(['In scope', 'Out of scope']);
    const covered = within(screen.getByTestId('owasp-lane-covered'));
    const out = within(screen.getByTestId('owasp-lane-out'));
    expect(covered.getAllByRole('listitem')).toHaveLength(8);
    expect(out.getAllByRole('listitem')).toHaveLength(7);
    // T4 is the control UC18 (rate limiting, maturity "works"), so it sits with the enforced threats.
    expect(covered.getByText('Resource Overload')).toBeTruthy();
    expect(screen.getByTestId('owasp-lane-covered').className).toContain('pu-card--ok');
    // the lede counts match the lanes
    expect(screen.getByText('8 of the 15').tagName).toBe('STRONG');
  });

  it('opens one key component at a time with a real button, and keyboard focus stays on it', async () => {
    const user = userEvent.setup();
    renderPage();
    const kc1 = within(screen.getByTestId('owasp-kc-KC1')).getByRole('button', { name: /KC1/ });
    const kc2 = within(screen.getByTestId('owasp-kc-KC2')).getByRole('button', { name: /KC2/ });
    expect(kc1.getAttribute('aria-expanded')).toBe('false');
    kc1.focus();
    await user.keyboard('{Enter}');
    expect(kc1.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(kc1);
    expect(screen.getByText(/reasoning .brain./i)).toBeTruthy();
    expect(kc1.getAttribute('aria-controls')).toBe('owasp-kc-blurb-KC1');
    expect(document.getElementById('owasp-kc-blurb-KC1')).not.toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(kc2);
    await user.keyboard(' ');
    expect(kc2.getAttribute('aria-expanded')).toBe('true');
    expect(kc1.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(kc2);
    await user.keyboard('{Enter}');
    expect(kc2.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(kc2);
  });

  it('keeps the page theme toggle and the demo-map rows as buttons that act', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /dark mode/i });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggleDarkMode).toHaveBeenCalledTimes(1);

    const rows = screen.getAllByTitle(/^Open \//);
    expect(rows).toHaveLength(8);
    rows.forEach((r) => expect(r.tagName).toBe('BUTTON'));
    fireEvent.click(screen.getByTitle('Open /scope-audit'));
    expect(navigate).toHaveBeenCalledWith('/scope-audit');
  });

  it('never presents sample attack output or colour-only status', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('pre, code').length).toBe(0);
    container.querySelectorAll('.pu-chip').forEach((c) => expect(c.textContent.trim().length).toBeGreaterThan(0));
  });

  it('the map row for UC18 and the T4 lane agree: a control row that exists, no "planned" label anywhere', () => {
    const { container } = renderPage();
    const row = [...container.querySelectorAll('.owasp-map-row')].find((r) => r.textContent.includes('UC18'));
    expect(row.textContent).toMatch(/T4/);
    expect(within(screen.getByTestId('owasp-lane-covered')).getByText('Resource Overload')).toBeTruthy();
    expect(screen.queryByTestId('owasp-lane-planned')).toBeNull();
    expect(container.textContent).not.toMatch(/planned|still being built|not built yet/i);
  });
});
