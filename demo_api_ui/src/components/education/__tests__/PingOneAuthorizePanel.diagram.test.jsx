import React from 'react';
import { render, screen, within } from '@testing-library/react';
import PingOneAuthorizePanel from '../PingOneAuthorizePanel';

window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

describe('PingOneAuthorizePanel — layered policy diagram', () => {
  it('draws the policy checks as a walkable diagram with Simulate, Reset and step time', () => {
    render(<PingOneAuthorizePanel isOpen onClose={() => {}} initialTabId="policy-mcp" />);
    const bar = screen.getByTestId('p1z-authz-diagram-steps');
    expect(within(bar).getByText('Simulate')).toBeInTheDocument();
    expect(within(bar).getByText('Reset')).toBeInTheDocument();
    expect(within(bar).getByText('Step time:')).toBeInTheDocument();
  });
});
