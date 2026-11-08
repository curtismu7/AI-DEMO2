import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SkipLink from '../SkipLink';

describe('SkipLink (KB-1)', () => {
  it('is a link labelled "Skip to main content"', () => {
    render(<SkipLink />);
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
  });

  it('moves focus to the page <main> and makes it programmatically focusable', () => {
    render(
      <>
        <SkipLink />
        <nav><a href="/x">shell link</a></nav>
        <main><button type="button">first control</button></main>
      </>,
    );
    const main = document.querySelector('main');
    expect(main).not.toHaveAttribute('tabindex');
    fireEvent.click(screen.getByTestId('skip-link'));
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(main);
  });

  it('does nothing harmful when the page has no <main>', () => {
    render(<SkipLink />);
    expect(() => fireEvent.click(screen.getByTestId('skip-link'))).not.toThrow();
  });
});
