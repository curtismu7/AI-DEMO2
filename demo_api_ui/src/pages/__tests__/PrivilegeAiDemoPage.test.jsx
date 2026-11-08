import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import PrivilegeAiDemoPage from '../PrivilegeAiDemoPage';

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/privilege-for-ai']}>
      <Routes>
        <Route path="/privilege-for-ai" element={<PrivilegeAiDemoPage />} />
        <Route path="/mcp-scanner" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PrivilegeAiDemoPage (standalone UI standard)', () => {
  it('puts the static-lesson banner first, honestly, as a note', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.pfa-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.getAttribute('data-testid')).toBe('pfa-banner');
    expect(banner.textContent).toMatch(/static lesson/i);
    expect(banner.textContent).toMatch(/no live calls/i);
    expect(banner.textContent).toMatch(/does not re-check/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Privilege for AI — Hostile MCP');
  });

  it('has exactly one primary button, the scanner hand-off, and it navigates there', () => {
    const { container } = renderPage();
    const primaries = [...container.querySelectorAll('button.pu-btn--primary')];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toBe(screen.getByTestId('pfa-open-scanner'));
    expect(primaries[0].textContent).toMatch(/Open the MCP Scanner/);
    // The lesson shell's controls stay secondary: they never carry the primary class.
    expect(screen.getByRole('button', { name: 'Export PDF' }).className).not.toContain('primary');
    fireEvent.click(primaries[0]);
    expect(screen.getByTestId('where').textContent).toBe('/mcp-scanner');
  });

  it('shows the three threats as cards, each with a chip that carries the word', () => {
    renderPage();
    const tones = { 1: 'pu-card--ok', 2: 'pu-card--ok', 3: 'pu-card--warn' };
    [1, 2, 3].forEach((n) => {
      const card = screen.getByTestId(`pfa-threat-${n}`);
      expect(card.className).toContain(tones[n]);
      const chip = card.querySelector('.pu-chip');
      expect(chip.textContent.trim().length).toBeGreaterThan(0);
    });
    expect(within(screen.getByTestId('pfa-threat-3')).getByText("Privilege can't see it").className).toContain('pu-chip--warn');
  });

  it('never renders a bare chip, and states steps 3 and 4 as expected outcomes, not verdicts', () => {
    const { container } = renderPage();
    const chips = [...container.querySelectorAll('.pu-chip')];
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((c) => expect(c.textContent.trim()).not.toBe(''));
    expect(screen.getByText('Expected: permit').className).toContain('pu-chip--ok');
    expect(screen.getByText('Expected: deny').className).toContain('pu-chip--danger');
    expect(screen.queryByText(/^gateway /i)).toBeNull();
  });

  it('lists the scanner findings and the coordinates as key-value lists', () => {
    renderPage();
    const findings = screen.getByTestId('pfa-findings');
    expect(findings.querySelector('dl.pu-kv')).not.toBeNull();
    expect(within(findings).getAllByText('Flagged')).toHaveLength(2);
    expect(within(findings).getByText('Not flagged')).toBeTruthy();
    expect(screen.getAllByText(/^Client URL \(gateway\)$/)).toHaveLength(1);
    expect(document.querySelectorAll('dl.pu-kv')).toHaveLength(2);
  });

  it('makes the sideways-scrolling diagram a named, keyboard-focusable region', () => {
    renderPage();
    const region = screen.getByRole('region', { name: 'Defense in depth diagram' });
    expect(region.getAttribute('tabindex')).toBe('0');
    // The lane labels and guards are in the accessible text, not aria-hidden.
    expect(within(region).getByText('LLM lane')).toBeTruthy();
    expect(within(region).getByText('AIGuard')).toBeTruthy();
    expect(within(region).getByText('policy')).toBeTruthy();
  });

  it('keeps every section-nav target: each nav label has a matching heading id', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Lesson sections' });
    const labels = within(nav).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Three threats', 'Defense in depth', 'Blue-team scanner', 'Demo steps', 'Reference']);
    ['threats', 'flow', 'scanner', 'run', 'reference'].forEach((id) => {
      expect(document.getElementById(id)?.tagName).toBe('H2');
    });
  });

  it('lists the five demo steps in order', () => {
    const { container } = renderPage();
    const steps = [...container.querySelectorAll('.pfa-steps > li')];
    expect(steps).toHaveLength(5);
    expect(steps[2].textContent).toMatch(/weather in Denver/);
    expect(steps[3].textContent).toMatch(/Transfer \$500/);
  });
});
