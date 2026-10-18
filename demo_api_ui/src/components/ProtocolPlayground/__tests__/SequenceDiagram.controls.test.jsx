import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import SequenceDiagram from '../SequenceDiagram';
import protocolFlows from '../../../data/protocolFlows.json';

window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

describe('ProtocolPlayground SequenceDiagram', () => {
  test('has Simulate, Reset and step-time controls', () => {
    render(<SequenceDiagram flowSpec={protocolFlows.par} currentStep={null} results={[]} />);
    expect(screen.getByTestId('diagram-step-bar')).toBeTruthy();
    expect(screen.getAllByText('Simulate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reset').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Step time:').length).toBeGreaterThan(0);
  });
});
