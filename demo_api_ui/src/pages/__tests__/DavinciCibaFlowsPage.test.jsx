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

  it('carries no inline style', () => {
    const { container } = renderPage();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
