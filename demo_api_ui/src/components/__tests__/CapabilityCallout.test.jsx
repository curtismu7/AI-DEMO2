import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CapabilityCallout from '../CapabilityCallout';

const CAP = { id: 'cap-1', title: 'Capability One', oneLiner: 'Does thing one.' };

describe('CapabilityCallout', () => {
  it('renders a link with the capability title and one-liner as its title attribute', () => {
    render(<CapabilityCallout capability={CAP} to="/some-tour" />);
    const link = screen.getByRole('link', { name: /Capability One/ });
    expect(link).toHaveAttribute('href', '/some-tour');
    expect(link).toHaveAttribute('title', 'Does thing one.');
  });

  it('defaults href to /pingone-authorize-capabilities when `to` is omitted', () => {
    render(<CapabilityCallout capability={CAP} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pingone-authorize-capabilities');
  });

  it('renders nothing for a null capability', () => {
    const { container } = render(<CapabilityCallout capability={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an undefined capability', () => {
    const { container } = render(<CapabilityCallout />);
    expect(container).toBeEmptyDOMElement();
  });
});
