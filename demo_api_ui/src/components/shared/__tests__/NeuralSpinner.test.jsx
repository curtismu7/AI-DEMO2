import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NeuralSpinner from '../NeuralSpinner';

describe('NeuralSpinner compatibility wrapper', () => {
  it('passes size through to the shared Ping spinner', () => {
    const { container } = render(<NeuralSpinner size={88} />);

    expect(container.querySelector('.ping-spinner').style.getPropertyValue('--ping-spinner-size')).toBe('88px');
  });

  it('uses the shared Ping identity mark and remains decorative', () => {
    const { container } = render(<NeuralSpinner />);

    expect(container.querySelector('.ping-spinner__mark')).toBeInTheDocument();
    expect(container.querySelector('.ns')).toHaveAttribute('aria-hidden', 'true');
  });
});
