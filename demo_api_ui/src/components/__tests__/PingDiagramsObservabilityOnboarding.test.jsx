import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ObservabilityDiagramPage from '../ObservabilityDiagramPage';
import AgentOnboardingMermaidPage from '../AgentOnboardingMermaidPage';
import AgentOnboardingFlowDiagram from '../AgentOnboardingFlowDiagram';
import AgentOnboardingSubwayPage from '../AgentOnboardingSubwayPage';

// jsdom measures nothing, so React Flow draws no edges unless the observer reports each node.
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; }
  observe(target) { this.cb([{ target, contentRect: { width: 250, height: 40 } }]); }
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 250 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 40 });
window.DOMMatrixReadOnly = window.DOMMatrixReadOnly || class {};

const page = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

function expectControls(scope) {
  expect(within(scope).getByRole('button', { name: 'Simulate' })).toBeTruthy();
  expect(within(scope).getByRole('button', { name: /Reset$/ })).toBeTruthy();
  expect(within(scope).getByTitle(/Time each step takes/)).toBeTruthy();
}

describe('Observability page, Ping style', () => {
  it('draws the telemetry flow in the Ping style with Simulate, Reset and speed', async () => {
    page(<ObservabilityDiagramPage />);
    expect(document.querySelectorAll('.efd--ping').length).toBe(1);
    expectControls(screen.getByRole('region', { name: 'Telemetry data flow' }));
    expect(await screen.findByTestId('obs-flow-flow-node-prom')).toBeTruthy();
  });

  it('the plane buttons redraw the diagram with only that plane', async () => {
    page(<ObservabilityDiagramPage />);
    expect(await screen.findByTestId('obs-flow-flow-node-loki')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Metrics/ }));
    expect(await screen.findByTestId('obs-flow-flow-node-prom')).toBeTruthy();
    expect(screen.queryByTestId('obs-flow-flow-node-loki')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All planes' }));
    expect(await screen.findByTestId('obs-flow-flow-node-loki')).toBeTruthy();
  });

  it('clicking a box shows the request, the no-token reason and the standards', async () => {
    page(<ObservabilityDiagramPage />);
    fireEvent.click(await screen.findByTestId('obs-flow-flow-node-jaeger'));
    const panel = screen.getByTestId('obs-flow-flow-reel-detail');
    expect(panel.textContent).toContain('/v1/traces');
    expect(panel.textContent).toContain('Token: none');
    expect(panel.textContent).toContain('OpenTelemetry OTLP');
  });

  it('keeps the demo walkthrough tab', () => {
    page(<ObservabilityDiagramPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Demo walkthrough' }));
    expect(screen.getByText(/Part 1/)).toBeTruthy();
    expect(screen.getByText(/Part 2/)).toBeTruthy();
  });
});

describe('Agent Onboarding architecture (React Flow variant), Ping style', () => {
  it('has Simulate, Reset, speed and the Ping style', async () => {
    page(<AgentOnboardingMermaidPage />);
    expect(document.querySelector('.sfd--ping')).toBeTruthy();
    expectControls(document.body);
    expect(await screen.findByTestId('aom-flow-diagram-node-PGW')).toBeTruthy();
  });

  it('clicking a box shows the step detail with the target-state note', async () => {
    page(<AgentOnboardingMermaidPage />);
    fireEvent.click(await screen.findByTestId('aom-flow-diagram-node-PGW'));
    const panel = screen.getByTestId('aom-flow-diagram-reel-detail');
    expect(panel.textContent).toContain('Target-state design');
    expect(panel.textContent).toContain('MCP authorization');
  });
});

describe('Agent Onboarding flow walkthrough, Ping style', () => {
  it('keeps the persona tabs and the controls, drawn in the Ping style', async () => {
    page(<AgentOnboardingFlowDiagram />);
    expect(document.querySelector('.sfd--ping')).toBeTruthy();
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reset$/ })).toBeTruthy();
    expect(await screen.findByTestId('aof-flow-diagram-node-AS')).toBeTruthy();
    expect(screen.getByText(/link n between the boxes/)).toBeTruthy();
  });
});

describe('Agent Onboarding subway map, Ping style', () => {
  it('keeps the persona tabs and the controls, drawn in the Ping style', async () => {
    page(<AgentOnboardingSubwayPage />);
    expect(document.querySelector('.sfd--ping')).toBeTruthy();
    expect(document.querySelector('.aos-page--ping')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Simulate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reset$/ })).toBeTruthy();
    expect(await screen.findByTestId('aos-line-node-s0')).toBeTruthy();
  });
});
