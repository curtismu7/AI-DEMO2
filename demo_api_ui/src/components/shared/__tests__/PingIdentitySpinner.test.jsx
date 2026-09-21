import { render, screen } from '@testing-library/react';
import PingIdentitySpinner from '../PingIdentitySpinner';

describe('PingIdentitySpinner', () => {
  it('renders the Ping identity mark with an accessible loading label', () => {
    render(<PingIdentitySpinner label="Checking authorization…" />);

    expect(screen.getByRole('status', { name: 'Checking authorization…' })).toBeInTheDocument();
    expect(document.querySelector('.ping-spinner__mark')).not.toBeNull();
    expect(document.querySelector('.ping-spinner__mark text')).toHaveTextContent('P');
  });

  it('uses the requested size and supports unlabeled decorative use', () => {
    render(<PingIdentitySpinner size={72} aria-hidden="true" />);

    const spinner = document.querySelector('.ping-spinner');
    expect(spinner.style.getPropertyValue('--ping-spinner-size')).toBe('72px');
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});
