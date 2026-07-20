import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnifiedTokenFlowInspector from './UnifiedTokenFlowInspector';
import { ExchangeModeProvider } from '../context/ExchangeModeContext';

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
