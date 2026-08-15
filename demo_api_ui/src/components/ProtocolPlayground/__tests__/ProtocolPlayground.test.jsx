import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import ProtocolPlayground from '../ProtocolPlayground';
import protocolFlows from '../../../data/protocolFlows.json';

// The engine is exercised by its own suite; here we only care that the
// component tree wires together, so keep execution out of the network.
vi.mock('../../../services/executionEngine', () => ({
  default: class {
    constructor(flowSpec) {
      this.flowSpec = flowSpec;
      this.state = { currentStep: null, results: [], error: null };
    }
    async executeAll() {
      this.state = {
        currentStep: 'step-1',
        results: [
          {
            stepId: 'step-1',
            request: { method: 'POST', url: '/api/oauth/token/token' },
            response: { status: 200, body: {} },
            decodedToken: null,
          },
        ],
        error: null,
      };
      return this.state.results;
    }
    async executeStep() {
      return null;
    }
    reset() {
      this.state = { currentStep: null, results: [], error: null };
    }
    getState() {
      return this.state;
    }
  },
}));

const flowIds = Object.keys(protocolFlows);

describe('ProtocolPlayground wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('generated flows carry the fields the viewer and engine read', () => {
    expect(flowIds.length).toBeGreaterThan(0);

    for (const id of flowIds) {
      const flow = protocolFlows[id];
      expect(flow.steps.length).toBeGreaterThan(0);

      for (const step of flow.steps) {
        // ExecutionEngine reads these — without them every request is malformed.
        expect(step.method).toBeTruthy();
        expect(step.endpoint).toBeTruthy();
        // diagramRenderer skips any step missing these, drawing an empty diagram.
        expect(step.fromActor).toBeTruthy();
        expect(step.toActor).toBeTruthy();
        expect(flow.actors).toContain(step.fromActor);
        expect(flow.actors).toContain(step.toActor);
      }
    }
  });

  test('renders the viewer for the default protocol on mount', () => {
    render(<ProtocolPlayground />);

    const first = protocolFlows[flowIds[0]];
    expect(screen.getByRole('heading', { name: first.name })).toBeInTheDocument();
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });

  test('lists every generated protocol in the sidebar', () => {
    const { container } = render(<ProtocolPlayground />);

    // Scoped to the sidebar's own nav. Counting every titled button in the tree
    // also swept up StepCard's "Execute this step" buttons once step cards
    // gained titles, so the count drifted with the selected flow's step count
    // rather than with the number of protocols.
    const buttons = container.querySelectorAll('.protocol-list .protocol-item');
    expect(buttons.length).toBe(flowIds.length);
  });

  test('clicking a sidebar entry switches the viewer', () => {
    render(<ProtocolPlayground />);

    const target = flowIds[1] ?? flowIds[0];
    fireEvent.click(screen.getByTitle(target));

    expect(
      screen.getByRole('heading', { name: protocolFlows[target].name })
    ).toBeInTheDocument();
  });

  test('executing a flow renders results in the activity panel', async () => {
    render(<ProtocolPlayground />);

    fireEvent.click(screen.getByRole('button', { name: /Execute All/i }));

    // ActivityPanel renders each result as a TokenChainEventCard built by
    // synthesizeEvent — "<METHOD> <url>" as the label and "HTTP <status>" as
    // the explanation. It used to print the raw stepId and status code.
    expect(await screen.findByText('POST /api/oauth/token/token')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 200/)).toBeInTheDocument();
    expect(screen.queryByText(/No activity yet/)).not.toBeInTheDocument();
  });
});
