// demo_api_ui/src/__tests__/AuthLoadingScreen.test.js
//
// The screen shown while the sign-in check runs must look like index.html's boot
// skeleton, or a refresh swaps two different screens (the white flashes this fixed).
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import AuthLoadingScreen from '../components/shared/AuthLoadingScreen';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

describe('AuthLoadingScreen', () => {
  it('draws the same skeleton parts as the HTML boot screen', () => {
    const { container } = render(<AuthLoadingScreen label="Loading Agent…" />);
    for (const part of ['boot-bar', 'boot-nav', 'boot-main', 'boot-card', 'boot-card boot-card--short']) {
      expect(html).toContain(`class="${part}"`);
      expect(container.querySelector(`.${part.split(' ').join('.')}`)).not.toBeNull();
    }
    expect(container.querySelector('.boot-skeleton')).not.toBeNull();
  });

  it('exposes the label as the accessible name, with no visible label text', () => {
    const { container } = render(<AuthLoadingScreen label="Loading Agent…" />);
    expect(screen.getByRole('status', { name: 'Loading Agent…' })).toBeInTheDocument();
    // A visible label would put token ink on the skeleton's literal ground (rule H1).
    expect(container.querySelector('.ping-spinner__label')).toBeNull();
  });

  it('shows a tip, rotates it, and admits when it is slow', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<AuthLoadingScreen />);
      const tip = () => container.querySelector('.boot-skeleton__tip span').textContent;
      const first = tip();
      expect(container.querySelectorAll('.spinner-tip')).toHaveLength(1);
      expect(container.querySelector('.boot-skeleton__tip em')).toBeNull();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(tip()).not.toBe(first);
      act(() => { vi.advanceTimersByTime(4000); });
      expect(container.querySelector('.boot-skeleton__tip em')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to a generic accessible name', () => {
    render(<AuthLoadingScreen />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
