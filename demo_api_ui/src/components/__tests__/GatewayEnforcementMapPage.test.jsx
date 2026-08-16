import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import GatewayEnforcementMapPage from '../GatewayEnforcementMapPage';
import { GATEWAY_ENFORCEMENT_ROWS } from '../education/gatewayEnforcementDiagram.generated';

describe('GatewayEnforcementMapPage', () => {
  it('renders a P1AZ column so the table actually compares against P1AZ, not just the two gateways', () => {
    render(<GatewayEnforcementMapPage />);
    expect(screen.getByText('Why P1AZ can\'t')).toBeInTheDocument();
    const firstRow = GATEWAY_ENFORCEMENT_ROWS[0];
    expect(screen.getByText(firstRow.p1az)).toBeInTheDocument();
  });
});
