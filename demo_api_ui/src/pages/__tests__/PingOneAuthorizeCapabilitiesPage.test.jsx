import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PingOneAuthorizeCapabilitiesPage from '../PingOneAuthorizeCapabilitiesPage';

describe('PingOneAuthorizeCapabilitiesPage', () => {
  it('renders the PingOne Authorize title and all 8 capability cards without any network call', () => {
    render(<PingOneAuthorizeCapabilitiesPage />);
    expect(screen.getByRole('heading', { level: 1, name: /PingOne Authorize/ })).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-decision-endpoints')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-mcp-first-tool-gate')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-fail-closed-resilience')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-trust-framework-attributes')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-policy-tree-visibility')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-obligations-response-shaping')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-recent-decisions-audit')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-coarse-fine-split')).toBeInTheDocument();
  });

  it('states the Contextual Runtime Authorization claim in the intro copy', () => {
    const { container } = render(<PingOneAuthorizeCapabilitiesPage />);
    const intro = container.querySelector('.cap-showcase__intro');
    expect(intro).toHaveTextContent(/Contextual Runtime Authorization/i);
  });
});
