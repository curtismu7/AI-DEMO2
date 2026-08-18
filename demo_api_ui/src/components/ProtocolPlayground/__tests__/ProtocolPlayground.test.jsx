import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    async executeStep(stepId) {
      const idx = this.flowSpec.steps.findIndex((s) => s.id === stepId);
      const result = {
        stepId,
        request: { method: 'POST', url: `/api/mock/${stepId}` },
        response: { status: 200, body: {} },
        decodedToken: null,
      };
      const results = [...this.state.results];
      results[idx] = result;
      this.state = { ...this.state, currentStep: stepId, results };
      return result;
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
    // the explanation — plus an inline Request detail whose summary repeats
    // the same "<METHOD> <url>" string, hence findAllByText.
    expect((await screen.findAllByText('POST /api/oauth/token/token')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/HTTP 200/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No activity yet/)).not.toBeInTheDocument();
  });

  test('dragging the separators resizes sidebar and activity rail, persisted', () => {
    window.localStorage.removeItem('pp-sidebar-width');
    window.localStorage.removeItem('pp-activity-width');
    const { container } = render(<ProtocolPlayground />);

    const sidebar = container.querySelector('.protocol-playground__sidebar');
    expect(sidebar.style.flex).toBe('0 0 260px');

    const sidebarHandle = screen.getByRole('separator', { name: 'Resize protocol list column' });
    fireEvent.mouseDown(sidebarHandle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 420 });
    fireEvent.mouseUp(document);

    expect(sidebar.style.flex).toBe('0 0 380px');
    expect(window.localStorage.getItem('pp-sidebar-width')).toBe('380');

    // Clamp: dragging far left stops at the minimum.
    fireEvent.mouseDown(sidebarHandle, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(sidebar.style.flex).toBe('0 0 180px');

    // Right activity rail is inverted: dragging left grows it.
    const rail = container.querySelector('.activity-section');
    expect(rail.style.flex).toBe('0 0 420px');
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize activity column' }), { clientX: 800 });
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);
    expect(rail.style.flex).toBe('0 0 520px');
    expect(window.localStorage.getItem('pp-activity-width')).toBe('520');
  });

  test('completing step 1 via its own Execute button enables step 2\'s button', async () => {
    const { container } = render(<ProtocolPlayground />);

    const stepCards = () => container.querySelectorAll('.step-cards-container .step-card');
    const executeButton = (card) => card.querySelector('.step-execute-btn');

    const cardsBefore = stepCards();
    expect(cardsBefore.length).toBeGreaterThanOrEqual(2);

    const step2ButtonBefore = executeButton(cardsBefore[1]);
    expect(step2ButtonBefore).toBeDisabled();
    expect(step2ButtonBefore).toHaveAttribute('title', 'Complete previous steps first');

    fireEvent.click(executeButton(cardsBefore[0]));

    await waitFor(() => {
      const step2ButtonAfter = executeButton(stepCards()[1]);
      expect(step2ButtonAfter).not.toBeDisabled();
      expect(step2ButtonAfter).toHaveAttribute('title', 'Execute this step');
    });
  });
});
