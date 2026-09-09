// banking_api_ui/src/components/shared/__tests__/NeuralSpinner.test.jsx
/**
 * NeuralSpinner is presentational — the only things that can actually break are
 * the custom-property style keys React has to pass through verbatim, the
 * one-time stylesheet injection those properties feed, and the H3 rule that
 * keeps colour out of inline styles so themes can still own it.
 */
import { render } from '@testing-library/react';
import NeuralSpinner from '../NeuralSpinner';

const STYLE_ID = 'neural-spinner-styles';
const css = () => document.getElementById(STYLE_ID).textContent;

describe('NeuralSpinner', () => {
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it('passes size through as a custom property', () => {
    const { container } = render(<NeuralSpinner size={88} />);
    expect(container.querySelector('.ns').style.getPropertyValue('--ns-size')).toBe('88px');
  });

  /** REGRESSION_PLAN.md H3 — inline colour beats every [data-theme] override. */
  it('sets no colour inline, leaving the accent to the stylesheet', () => {
    const { container } = render(<NeuralSpinner />);
    const root = container.querySelector('.ns');

    expect(root.style.getPropertyValue('--ns-accent')).toBe('');
    expect(root.style.color).toBe('');
    expect(root.style.background).toBe('');
    // The accent now reads through --spinner-accent so /configure's Appearance
    // knob can override it from :root — a value merely inherited from an
    // ancestor loses to this declaration on .ns itself. Still no inline colour,
    // and still --brand-navy when nothing overrides it.
    expect(css()).toContain('--ns-accent: var(--spinner-accent, var(--brand-navy');
  });

  it('renders eight token spokes with distinct hues', () => {
    const { container } = render(<NeuralSpinner />);
    const spokes = [...container.querySelectorAll('.ns-spoke')];

    expect(spokes).toHaveLength(8);
    expect(new Set(spokes.map((s) => s.style.getPropertyValue('--h'))).size).toBe(8);
    spokes.forEach((s, i) => expect(s.style.getPropertyValue('--i')).toBe(String(i)));
  });

  it('injects its stylesheet once, however many instances mount', () => {
    render(
      <>
        <NeuralSpinner />
        <NeuralSpinner />
        <NeuralSpinner />
      </>
    );
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    expect(css()).toContain('ns-ingress');
  });

  /**
   * jsdom cannot evaluate a media query, so assert the rule itself: under
   * reduce, every animated layer must be switched off rather than slowed.
   */
  it('stops every animation under prefers-reduced-motion', () => {
    render(<NeuralSpinner />);
    const block = css().split('@media (prefers-reduced-motion: reduce)')[1];

    expect(block).toBeTruthy();
    expect(block).toContain('animation: none');
    expect(block).not.toContain('infinite');
    expect(block).not.toMatch(/animation-duration/);

    for (const layer of ['.ns::before', '.ns-sweep', '.ns-ticks', '.ns-core', '.ns-halo', '.ns-spoke::before', '.ns-spoke::after']) {
      expect(block).toContain(layer);
    }
  });

  it('is hidden from assistive tech — the card carries the live message', () => {
    const { container } = render(<NeuralSpinner />);
    expect(container.querySelector('.ns')).toHaveAttribute('aria-hidden', 'true');
  });
});
