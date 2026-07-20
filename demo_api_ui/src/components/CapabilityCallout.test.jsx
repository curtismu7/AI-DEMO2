import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CapabilityCallout from './CapabilityCallout';

describe('CapabilityCallout', () => {
  it('renders the capability title and a link to the tour for a known id', () => {
    render(<CapabilityCallout capabilityId="rate-limiting" />);
    expect(screen.getByText(/Throttle requests/)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/agent-gateway-capabilities#rate-limiting');
  });

  it('renders nothing for an unknown capability id', () => {
    const { container } = render(<CapabilityCallout capabilityId="does-not-exist" />);
    expect(container).toBeEmptyDOMElement();
  });
});
