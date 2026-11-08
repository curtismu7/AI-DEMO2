import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PingPage, SimBanner } from '../pingUi';

const TEXT = 'SIMULATED, NO LIVE CALL. Nothing on this page calls a gateway. Only statements labelled VERIFIED were seen on a real system.';

// jsdom does no layout: scrollHeight and clientHeight are 0. A banner that "is clipped" is one whose scrollHeight
// exceeds its clientHeight, so the tests set those on the prototype.
function setClipped(clipped) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(clipped ? 300 : 40);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
}

afterEach(() => vi.restoreAllMocks());

describe('SimBanner on a phone', () => {
  it('keeps role=note and the full text findable, with no button when nothing is clipped', () => {
    setClipped(false);
    render(<PingPage><SimBanner data-testid="b">{TEXT}</SimBanner></PingPage>);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(TEXT);
    expect(screen.getByText(/Only statements labelled VERIFIED/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('offers More while the text is clipped, and More / Less toggles aria-expanded and the clamp', () => {
    setClipped(true);
    render(<PingPage><SimBanner>{TEXT}</SimBanner></PingPage>);
    const note = screen.getByRole('note');
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', note.id);
    expect(note.className).toContain('pu-banner--clamp');
    // The text is in the DOM whether or not it is shown.
    expect(note).toHaveTextContent(TEXT);

    fireEvent.click(more);
    const less = screen.getByRole('button', { name: 'Less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(note.className).not.toContain('pu-banner--clamp');

    fireEvent.click(less);
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
    expect(note.className).toContain('pu-banner--clamp');
  });

  it('opens when focus lands on a link inside the clipped part (keyboard users never focus hidden text)', () => {
    setClipped(true);
    render(<PingPage><SimBanner>{TEXT} <a href="#x">details</a></SimBanner></PingPage>);
    expect(screen.getByRole('note').className).toContain('pu-banner--clamp');
    fireEvent.focus(screen.getByRole('link', { name: 'details' }));
    expect(screen.getByRole('note').className).not.toContain('pu-banner--clamp');
    expect(screen.getByRole('button', { name: 'Less' })).toBeInTheDocument();
  });

  it('passes data attributes and a page class through to the banner', () => {
    setClipped(false);
    render(<PingPage><SimBanner data-testid="gwc-banner" className="x">{TEXT}</SimBanner></PingPage>);
    const b = screen.getByTestId('gwc-banner');
    expect(b).toHaveAttribute('role', 'note');
    expect(b.className).toContain('pu-banner');
    expect(b.className).toContain('x');
  });
});
