import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResourceServerCheckpointPage from '../ResourceServerCheckpointPage';

const renderPage = () => render(<MemoryRouter><ResourceServerCheckpointPage /></MemoryRouter>);
const scenario = (key) => screen.getByTestId(`rsc-scenario-${key}`);
const KEYS = ['balance', 'transfer', 'sensitive', 'redact'];

describe('ResourceServerCheckpointPage (Ping UI Standard)', () => {
  it('puts the banner first, as a note, honest that every payload is a sample', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.rsc-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/simulated/i);
    expect(banner.textContent).toMatch(/nothing on this page is sent anywhere/i);
    expect(banner.textContent).toMatch(/not called/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The final check before your data');
  });

  it('has exactly one primary button in every scenario, and it is the selected one', () => {
    const { container } = renderPage();
    for (const key of KEYS) {
      fireEvent.click(scenario(key));
      const primaries = container.querySelectorAll('button.pu-btn--primary');
      expect(primaries).toHaveLength(1);
      expect(primaries[0]).toBe(scenario(key));
      expect(scenario(key).getAttribute('aria-pressed')).toBe('true');
      KEYS.filter((k) => k !== key).forEach((k) => expect(scenario(k).getAttribute('aria-pressed')).toBe('false'));
    }
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
    // never a green or red "checked" chip: nothing on this page checks anything
    expect(verdict.querySelector('.pu-chip--ok, .pu-chip--danger')).toBeNull();
  });

  it('shows which legs ran in a key-value list, derived from the scenario', () => {
    const { container } = renderPage();
    const kv = () => Array.from(container.querySelectorAll('.pu-kv dd')).map((d) => d.textContent);
    expect(kv().slice(1)).toEqual(['Ran', 'Ran']);
    fireEvent.click(scenario('transfer'));
    expect(kv().slice(1)).toEqual(['Never ran', 'Not reached']);
  });

  it('marks skipped steps of the flow strip in words, not only by strike-through', () => {
    const { container } = renderPage();
    expect(container.querySelector('.rsc-pill--dead')).toBeNull();
    fireEvent.click(scenario('sensitive'));
    const dead = container.querySelectorAll('.rsc-pill--dead');
    expect(dead).toHaveLength(2);
    dead.forEach((li) => expect(li.textContent).toMatch(/not reached/i));
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

  it('keeps the theme toggle a secondary button with aria-pressed, and the sections as named landmarks', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /dark mode|light mode/i });
    expect(toggle.className).toBe('pu-btn');
    expect(toggle.hasAttribute('aria-pressed')).toBe(true);
    ['Three reasons the final check still matters', 'Pick what the agent attempts', 'The two moments Kong would hook — and we mock', 'What this teaches'].forEach((name) => {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    });
    expect(within(screen.getByRole('region', { name: 'Pick what the agent attempts' })).getAllByRole('button')).toHaveLength(4);
  });
});
