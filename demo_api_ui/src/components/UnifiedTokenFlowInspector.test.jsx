import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnifiedTokenFlowInspector from './UnifiedTokenFlowInspector';
import { ExchangeModeProvider } from '../context/ExchangeModeContext';
import { agentFlowDiagram } from '../services/agentFlowDiagramService';

// AgentFlowSection (rendered on the default 'flow' tab, mounted before the
// Token Transform tab is clicked) calls useExchangeMode(), which throws
// outside its provider — wrap so the crash tested isn't a missing-provider
// error but the actual behavior under test.
function renderInspector() {
  return render(
    <ExchangeModeProvider>
      <UnifiedTokenFlowInspector />
    </ExchangeModeProvider>
  );
}

describe('UnifiedTokenFlowInspector — Token Transform tab', () => {
  it('shows a Token Transform tab that renders the gateway-in vs backend-out audience', () => {
    renderInspector();
    fireEvent.click(screen.getByRole('tab', { name: /Token Transform/i }));
    expect(screen.getByText(/gateway-audience-in/i)).toBeInTheDocument();
    expect(screen.getByText(/backend-audience-out/i)).toBeInTheDocument();
  });
});

describe('UnifiedTokenFlowInspector — Flow & Tokens tab (hybrid tree)', () => {
  beforeEach(() => {
    agentFlowDiagram.reset();
    agentFlowDiagram.close();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ currentTokens: [] }) })
    );
  });

  it('shows an empty-state hint when no steps have run yet', () => {
    renderInspector();
    expect(screen.getByText(/Run a banking action in the agent/i)).toBeInTheDocument();
  });

  it('renders live steps as a tree grouped by phase, and shows step detail on select', async () => {
    renderInspector();
    agentFlowDiagram.open();
    // completeMcpToolCall() is the real method that populates state.steps
    // via buildCompletedSteps() — the same call site bankingAgentService
    // uses after a tool finishes.
    agentFlowDiagram.completeMcpToolCall({ toolName: 'get_accounts', tokenEvents: [], ok: true });

    await waitFor(() => {
      expect(screen.getByText(/AUTHENTICATION/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/PingOne — Demo User App/));
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('marks denied steps with the sensitive (red) tree icon and counts them in the replay bar', async () => {
    const { container } = renderInspector();
    agentFlowDiagram.open();
    // ok: false with no matching tokenEvents makes buildCompletedSteps()
    // mark the pingauthorize/mcp/tool steps 'error' — a real step-up-denial
    // shape, not a synthetic one.
    agentFlowDiagram.completeMcpToolCall({
      toolName: 'create_withdrawal',
      tokenEvents: [],
      ok: false,
      errorMessage: 'Step-up required',
    });

    await waitFor(() => {
      expect(screen.getByText(/AUTHORIZATION/)).toBeInTheDocument();
    });
    expect(container.querySelector('.inspector-shell-tree-item__dot--sensitive')).toBeInTheDocument();
    expect(screen.getByText('Denied').querySelector('strong').textContent).not.toBe('0');
  });
});
