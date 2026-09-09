// banking_api_ui/src/components/shared/__tests__/NeuralSpinner.test.jsx
/**
 * NeuralSpinner is presentational — the only things that can actually break are
 * the two a build cannot catch: the custom-property style keys React has to pass
 * through verbatim, and the one-time stylesheet injection those properties feed.
 */
import { render } from '@testing-library/react';
import NeuralSpinner from '../NeuralSpinner';

const STYLE_ID = 'neural-spinner-styles';

describe('NeuralSpinner', () => {
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it('passes size and accent through as custom properties', () => {
    const { container } = render(<NeuralSpinner size={88} accent="#db2777" />);
    const root = container.querySelector('.ns');

    expect(root.style.getPropertyValue('--ns-size')).toBe('88px');
    expect(root.style.getPropertyValue('--ns-accent')).toBe('#db2777');
  });

  it('accepts a CSS variable as the accent, as spinnerService supplies', () => {
    const { container } = render(<NeuralSpinner accent="var(--brand-navy)" />);
    expect(container.querySelector('.ns').style.getPropertyValue('--ns-accent'))
      .toBe('var(--brand-navy)');
  });

  it('renders eight token spokes with distinct hues', () => {
    const { container } = render(<NeuralSpinner />);
    const spokes = [...container.querySelectorAll('.ns-spoke')];

    expect(spokes).toHaveLength(8);
    const hues = spokes.map((s) => s.style.getPropertyValue('--h'));
    expect(new Set(hues).size).toBe(8);
    spokes.forEach((s, i) => {
      expect(s.style.getPropertyValue('--i')).toBe(String(i));
    });
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
    expect(document.getElementById(STYLE_ID).textContent).toContain('ns-ingress');
  });

  it('is hidden from assistive tech — the card carries the live message', () => {
    const { container } = render(<NeuralSpinner />);
    expect(container.querySelector('.ns')).toHaveAttribute('aria-hidden', 'true');
  });
});
