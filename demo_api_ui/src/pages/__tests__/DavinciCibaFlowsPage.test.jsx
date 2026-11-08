import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DavinciCibaFlowsPage from '../DavinciCibaFlowsPage';

const renderPage = () => render(<MemoryRouter><DavinciCibaFlowsPage /></MemoryRouter>);

describe('DavinciCibaFlowsPage (Ping UI Standard)', () => {
  it('puts the banner first, as a note, honest that nothing runs or is read live', () => {
    const { container } = renderPage();
    const banner = screen.getByRole('note');
    expect(container.querySelector('.dv-ciba').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/nothing runs here/i);
    expect(banner.textContent).toMatch(/does not call DaVinci or PingOne/i);
    expect(banner.textContent).toMatch(/does not read the live tenant/i);
    expect(banner.textContent).toMatch(/mock phone or email/i);
    expect(banner.textContent).not.toMatch(/push/i);
    expect(screen.getByTestId('davinci-ciba-flows')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/DaVinci CIBA flows/);
  });

  it('keeps all three sections as named landmarks with a card per row', () => {
    renderPage();
    ['CIBA flows (human approves on their device)', 'Login: widget and Orchestration SDK', 'Orchestration showcase (flag off by default)'].forEach(
      (name) => expect(screen.getByRole('region', { name })).toBeTruthy(),
    );
    expect(screen.getAllByTestId('dv-ciba-card')).toHaveLength(8);
    expect(within(screen.getByRole('region', { name: /^CIBA flows/ })).getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('gives every chip a word and keeps every chip neutral (the page checks nothing)', () => {
    const { container } = renderPage();
    const chips = container.querySelectorAll('.pu-chip');
    expect(chips).toHaveLength(8);
    chips.forEach((c) => {
      expect(c.textContent.trim().length).toBeGreaterThan(0);
      expect(c.className).toContain('pu-chip--neutral');
    });
  });

  it('has no primary button in any state; the one control is a secondary link to the kit', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('.pu-btn--primary')).toHaveLength(0);
    const link = screen.getByRole('link', { name: 'PF DaVinci kit' });
    expect(link.getAttribute('href')).toBe('/pingfederate-davinci-kit');
    expect(link.className).toBe('pu-btn');
  });

  it('keeps the configuration facts, including the identifiers, as key-value lists', () => {
    const { container } = renderPage();
    const text = container.textContent;
    ['PINGONE_DAVINCI_LOGIN_POLICY_ID_V1', 'PINGONE_DAVINCI_SDK_POLICY_ID', 'davinci_not_configured', 'POST /webhook/davinci', 'CIBA Step-Up Policy'].forEach(
      (s) => expect(text).toContain(s),
    );
    expect(container.querySelectorAll('dl.pu-kv').length).toBe(8);
  });

  it('wraps the long unbroken tokens (card titles, notes, values) inside the card under the page class', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../DavinciCibaFlowsPage.css'), 'utf8');
    const src = fs.readFileSync(path.resolve(__dirname, '../DavinciCibaFlowsPage.jsx'), 'utf8');
    expect(src).toContain("import './DavinciCibaFlowsPage.css'");
    // Every selector is scoped under .dv-ciba with an element + class pair, so it out-ranks the
    // end-user-nano skin's word-wrap rules (a single class loses).
    ['h3.pu-h3', 'p.pu-note', 'dl.pu-kv dd'].forEach((sel) => expect(css).toContain(`.dv-ciba .pu-card ${sel}`));
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/min-width:\s*0/);
    const { container } = renderPage();
    const titles = [...container.querySelectorAll('.dv-ciba .pu-card h3.pu-h3')].map((h) => h.textContent);
    expect(titles).toContain('Widget policy (PINGONE_DAVINCI_LOGIN_POLICY_ID_V1)');
    expect(titles).toContain('Orchestration SDK policy (PINGONE_DAVINCI_SDK_POLICY_ID)');
    expect(container.querySelector('.dv-ciba .pu-card p.pu-note').textContent.length).toBeGreaterThan(0);
  });

  it('agrees with the banner: the approval is a mock phone or email here, a real MFA device only in a real deployment', () => {
    const { container } = renderPage();
    const policyNote = [...container.querySelectorAll('p.pu-note')].find((p) => p.textContent.includes('CIBA Step-Up Policy'));
    expect(policyNote).toBeTruthy();
    expect(policyNote.textContent).toMatch(/In this demo the approval request is a mock phone or email/);
    expect(policyNote.textContent).toMatch(/only in a real DaVinci deployment does the human see it as a request on their own MFA device/);
    expect(container.textContent).not.toMatch(/the human sees the approval request on their MFA device\./);
    expect(container.textContent).not.toMatch(/push/i);
  });

  it('carries no inline style', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
