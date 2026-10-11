import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HostileA2aTab from '../HostileA2aTab';
import { HOSTILE_A2A_STEPS } from '../../config/hostileA2aDiagram';

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// The bundled sample cards are scanned client-side (scanAgentCard, no network),
// so these exercise the dropdown + scan path with no fetch stub.
// Picker CONTROLS live in the scanner region; the verdict panes render in the
// page body below (and the attack-map diagram's step cards mention the same
// phrases) — so controls are scoped to the region, assertions stay on screen.
function renderTab() {
  return render(<MemoryRouter><HostileA2aTab /></MemoryRouter>);
}
const scanner = () => screen.getByRole('region', { name: 'Agent Card scanner' });

describe('HostileA2aTab card picker', () => {
  it('flags the default poisoned sample card', async () => {
    renderTab();
    fireEvent.click(within(scanner()).getByRole('button', { name: /scan this card/i }));
    expect(await screen.findByText(/finding\(s\)\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/do not trust this specialist/i).length).toBeGreaterThan(0);
  });

  it('passes the clean sample card with no findings', async () => {
    renderTab();
    fireEvent.change(within(scanner()).getByLabelText(/agent card/i), { target: { value: 'clean' } });
    fireEvent.click(within(scanner()).getByRole('button', { name: /scan this card/i }));
    expect(await screen.findByText(/no poisoned metadata found/i)).toBeInTheDocument();
  });

  it('reveals the URL input only for the live option', () => {
    renderTab();
    expect(within(scanner()).queryByPlaceholderText(/agent-card\.json/i)).not.toBeInTheDocument();
    fireEvent.change(within(scanner()).getByLabelText(/agent card/i), { target: { value: 'live' } });
    expect(within(scanner()).getByPlaceholderText(/agent-card\.json/i)).toBeInTheDocument();
  });
});

describe('attack-map diagram', () => {
  it('renders the two poison surfaces, the scanner, both guardrail legs, and the measured step write-up', () => {
    render(
      <MemoryRouter>
        <HostileA2aTab />
      </MemoryRouter>,
    );
    // The two poison surfaces in the card, plus the two defenses, as nodes
    expect(screen.getByTestId('ha2-diagram-flow-node-desc').textContent).toMatch(/Poisoned card description/);
    expect(screen.getByTestId('ha2-diagram-flow-node-skill').textContent).toMatch(/Poisoned skill description/);
    expect(screen.getByTestId('ha2-diagram-flow-node-scanner').textContent).toMatch(/Card scanner/);
    expect(screen.getByTestId('ha2-diagram-flow-node-guardreq').textContent).toMatch(/request leg/);
    expect(screen.getByTestId('ha2-diagram-flow-node-guardres').textContent).toMatch(/response leg/);
    // One write-up card per step; the guardrail steps carry the measured verdicts
    const steps = screen.getAllByTestId(/^ha2-diagram-step-/);
    expect(steps.length).toBe(HOSTILE_A2A_STEPS.length);
    const allText = steps.map((s) => s.textContent).join(' ');
    expect(allText).toMatch(/a2a_request_blocked/);
    expect(allText).toMatch(/a2a_response_blocked/);
    expect(allText).toMatch(/inventory only/);
  });
});
