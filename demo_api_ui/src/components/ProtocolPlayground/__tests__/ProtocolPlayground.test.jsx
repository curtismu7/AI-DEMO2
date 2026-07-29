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
    render(<ProtocolPlayground />);

    const buttons = screen.getAllByTitle(/.+/).filter((el) => el.tagName === 'BUTTON');
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

    expect(await screen.findByText('step-1')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });
});
