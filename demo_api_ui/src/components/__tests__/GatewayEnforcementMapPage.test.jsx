import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GatewayEnforcementMapPage from '../GatewayEnforcementMapPage';
import { GATEWAY_ENFORCEMENT_ROWS } from '../education/gatewayEnforcementDiagram.generated';

// @xyflow/react needs ResizeObserver in jsdom (same stub A2AFlowVisualizer.test.jsx uses).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

describe('GatewayEnforcementMapPage', () => {
  it('renders a P1AZ column so the table actually compares against P1AZ, not just the two gateways', () => {
    render(<GatewayEnforcementMapPage />);
    expect(screen.getByText('Why the gateway owns it')).toBeInTheDocument();
    const firstRow = GATEWAY_ENFORCEMENT_ROWS[0];
    expect(screen.getByText(firstRow.p1az)).toBeInTheDocument();
  });
});
