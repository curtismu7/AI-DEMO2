import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InspectorLayout from '../InspectorLayout.jsx';
import { formatTime } from '../CallDetail.jsx';
import { ThemeProvider, THEME_STORAGE_KEY } from '../../../context/ThemeContext.js';

window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const call = (over = {}) => ({
  id: 'c', at: 1700000000000, kind: 'k', title: 't', src: 'you', ms: 1, chips: [], corr: null, banner: null,
  status: { tone: 'ok', label: 'OK' }, request: { label: 'Req', body: { a: 1 } }, response: { label: 'Res', body: { b: 2 } },
  tokens: [], hops: [], steps: [], ...over,
});

function setup(c, ctx) {
  const props = { eyebrow: 'e', title: 'T', lede: 'l', mode: { tone: 'ok', label: 'Live' }, calls: [c], selectedId: c.id, onSelect: vi.fn(), onResend: vi.fn(), onEdit: vi.fn() };
  const ui = <MemoryRouter><InspectorLayout {...props} /></MemoryRouter>;
  if (ctx) localStorage.setItem(THEME_STORAGE_KEY, 'true'); else localStorage.removeItem(THEME_STORAGE_KEY);
  render(ctx ? <ThemeProvider>{ui}</ThemeProvider> : ui);
  return props;
}

describe('CallDetail', () => {
  it('Resend/Edit follow call.input: none disables both, partial disables only Resend', () => {
    setup(call());
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeDisabled();
  });

  it('partial input keeps Edit enabled', () => {
    const props = setup(call({ input: { tool: 't', args: {}, partial: true } }));
    expect(screen.getByRole('button', { name: 'Resend' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('full input enables both', () => {
    setup(call({ input: { tool: 't', args: {} } }));
    expect(screen.getByRole('button', { name: 'Resend' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeEnabled();
  });

  it('wraps JSON panes in .insp-json, dark palette only in dark mode', () => {
    setup(call({ input: { tool: 't' } }));
    fireEvent.click(screen.getByRole('tab', { name: /Request/ }));
    const pre = document.querySelector('.insp-json');
    expect(pre).toBeTruthy();
    expect(pre.className).not.toContain('jh-dark');
  });

  it('adds jh-dark in dark mode', () => {
    setup(call(), { darkMode: true });
    fireEvent.click(screen.getByRole('tab', { name: /Request/ }));
    expect(document.querySelector('.insp-json.jh-dark')).toBeTruthy();
  });

  it('does not nest a <main> landmark', () => {
    setup(call());
    expect(screen.queryByRole('main')).toBeNull();
  });

  it('formatTime guards non-finite values', () => {
    expect(formatTime(NaN)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
  });
});
