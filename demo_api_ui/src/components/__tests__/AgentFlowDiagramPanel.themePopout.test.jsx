import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentFlowDiagramPanel from '../AgentFlowDiagramPanel';
import { ExchangeModeProvider } from '../../context/ExchangeModeContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { agentFlowDiagram } from '../../services/agentFlowDiagramService';

function renderPanel() {
  return render(
    <ThemeProvider>
      <ExchangeModeProvider>
        <AgentFlowDiagramPanel />
      </ExchangeModeProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  act(() => {
    agentFlowDiagram.reset();
    agentFlowDiagram.open();
  });
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  act(() => agentFlowDiagram.close());
  vi.restoreAllMocks();
});

it('toggles the shared light/dark theme from the request-flow header', async () => {
  renderPanel();

  const toggle = await screen.findByRole('button', { name: 'Use dark theme' });
  fireEvent.click(toggle);

  await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  expect(screen.getByRole('button', { name: 'Use light theme' })).toBeInTheDocument();
});

it('opens a pop-out window and leaves a bring-back control in the parent', async () => {
  const fakeWindow = {
    closed: false,
    document: {
      documentElement: { dataset: {} },
      querySelector: vi.fn(() => null),
      getElementById: vi.fn(() => null),
      write: vi.fn(),
      close: vi.fn(),
    },
    history: { pushState: vi.fn() },
    addEventListener: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(() => { fakeWindow.closed = true; }),
  };
  vi.spyOn(window, 'open').mockReturnValue(fakeWindow);
  renderPanel();

  fireEvent.click(await screen.findByRole('button', { name: 'Pop out request flow' }));

  expect(window.open).toHaveBeenCalledOnce();
  expect(fakeWindow.document.documentElement.dataset.theme).toBe('light');
  expect(await screen.findByText(/open in another window/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bring back' })).toBeInTheDocument();
});
