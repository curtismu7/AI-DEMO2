import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../context/ThemeContext';
import ResourceServerCheckpointPage from '../ResourceServerCheckpointPage';

const renderPage = () => render(<MemoryRouter><ResourceServerCheckpointPage /></MemoryRouter>);
// The real ThemeProvider, so the label / aria-pressed pairing is driven by the real toggle.
const renderThemed = () => render(<ThemeProvider><MemoryRouter><ResourceServerCheckpointPage /></MemoryRouter></ThemeProvider>);
const scenario = (key) => screen.getByTestId(`rsc-scenario-${key}`);
const KEYS = ['balance', 'transfer', 'sensitive', 'redact'];

describe('ResourceServerCheckpointPage (Ping UI Standard)', () => {
  it('puts the banner first, as a note, honest that every payload is a sample', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.rsc-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/simulated/i);
    expect(banner.textContent).toMatch(/nothing on this page is sent anywhere/i);
    expect(banner.textContent).toMatch(/no real service is called/i);
    expect(banner.textContent.length).toBeLessThan(160); // compact: it must not push the title band below the fold at 375px
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The final check before your data');
  });

  it('treats the scenarios as a selector (secondary, aria-pressed, check mark) and keeps the one primary as the real action', () => {
    const { container } = renderPage();
    const diagram = screen.getByRole('link', { name: /open the companion diagram/i });
    for (const key of KEYS) {
      fireEvent.click(scenario(key));
      const primaries = container.querySelectorAll('.pu-btn--primary');
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toBe(diagram);
      expect(scenario(key).className).not.toMatch(/primary/);
      expect(scenario(key).getAttribute('aria-pressed')).toBe('true');
      expect(scenario(key).querySelector('.rsc-sc-check')).not.toBeNull();
      KEYS.filter((k) => k !== key).forEach((k) => {
        expect(scenario(k).getAttribute('aria-pressed')).toBe('false');
        expect(scenario(k).querySelector('.rsc-sc-check')).toBeNull();
      });
    }
    expect(diagram.getAttribute('href')).toBe('/resource-server-placement');
    expect(diagram.getAttribute('target')).toBe('_blank');
    expect(diagram.getAttribute('rel')).toMatch(/noopener/);
  });

  it('keeps keyboard focus on the scenario button after it is activated', () => {
    renderPage();
    scenario('transfer').focus();
    fireEvent.click(scenario('transfer'));
    expect(document.activeElement).toBe(scenario('transfer'));
  });

  it('labels the verdict as simulated, in a status region, with a word on the chip', () => {
    renderPage();
    const verdict = screen.getByTestId('rsc-verdict');
    expect(verdict.getAttribute('role')).toBe('status');
    expect(verdict.textContent).toMatch(/simulated permit/i);
    expect(verdict.querySelector('.pu-chip--neutral')).not.toBeNull();
    fireEvent.click(scenario('transfer'));
    expect(verdict.textContent).toMatch(/simulated deny/i);
    expect(verdict.textContent).toMatch(/transfer ceiling is \$5,000/i);
    expect(verdict.textContent).toMatch(/would be blocked/i);
    // never a green or red "checked" chip: nothing on this page checks anything
    expect(verdict.querySelector('.pu-chip--ok, .pu-chip--danger')).toBeNull();
  });

  it('words the leg rows as a sample, never as a live result', () => {
    const { container } = renderPage();
    const rows = () => Array.from(container.querySelectorAll('.pu-kv')).flatMap((kv) => Array.from(kv.querySelectorAll('dt, dd')).map((n) => n.textContent));
    expect(rows().slice(2)).toEqual(['Banking handler (sample)', 'Would run', 'Outbound redaction leg (sample)', 'Would run']);
    fireEvent.click(scenario('transfer'));
    expect(rows().slice(2)).toEqual(['Banking handler (sample)', 'Would not run', 'Outbound redaction leg (sample)', 'Would not be reached']);
    // no past-tense claim of a run anywhere in the lab
    for (const key of KEYS) {
      fireEvent.click(scenario(key));
      const text = container.querySelector('.rsc-lab').textContent;
      expect(text).not.toMatch(/\b(Never ran|Ran|Blocked:|Not reached)\b/);
    }
  });

  it('marks skipped steps of the flow strip in words, not only by strike-through', () => {
    const { container } = renderPage();
    expect(container.querySelector('.rsc-pill--dead')).toBeNull();
    fireEvent.click(scenario('sensitive'));
    const dead = container.querySelectorAll('.rsc-pill--dead');
    expect(dead).toHaveLength(2);
    dead.forEach((li) => expect(li.textContent).toMatch(/not reached in this sample/i));
  });

  it('gives every scrollable payload a role, a name and a tab stop', () => {
    const { container } = renderPage();
    const pres = container.querySelectorAll('.rsc-pane pre');
    expect(pres).toHaveLength(3);
    pres.forEach((pre) => {
      expect(pre.getAttribute('tabindex')).toBe('0');
      expect(pre.getAttribute('role')).toBe('region');
      expect(pre.getAttribute('aria-label')).toMatch(/^Sample /);
    });
  });

  it('keeps a constant theme-toggle label with aria-pressed, so a screen reader never hears "Light mode, pressed"', () => {
    renderThemed();
    const toggle = screen.getByRole('button', { name: 'Dark mode' });
    expect(toggle.className).toBe('pu-btn');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    const after = screen.getByRole('button', { name: 'Dark mode' });
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /light mode/i })).toBeNull();
    // the emoji is decoration, not part of the name
    expect(after.querySelector('[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(after);
    expect(screen.getByRole('button', { name: 'Dark mode' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('does not announce the mouse-only divider as an operable separator', () => {
    const { container } = renderPage();
    const handle = container.querySelector('.divider-drag-handle');
    expect(handle.getAttribute('role')).not.toBe('separator');
    expect(handle.getAttribute('aria-hidden')).toBe('true');
    expect(handle.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps the sections as named landmarks', () => {
    renderPage();
    ['Three reasons the final check still matters', 'Pick what the agent attempts', 'The two moments Kong would hook — and we mock', 'What this teaches'].forEach((name) => {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    });
    expect(within(screen.getByRole('region', { name: 'Pick what the agent attempts' })).getAllByRole('button').filter((b) => b.hasAttribute('data-testid'))).toHaveLength(4);
  });
});
