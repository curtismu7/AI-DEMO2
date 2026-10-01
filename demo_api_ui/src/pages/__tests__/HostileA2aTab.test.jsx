import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HostileA2aTab from '../HostileA2aTab';

// The bundled sample cards are scanned client-side (scanAgentCard, no network),
// so these exercise the dropdown + scan path with no fetch stub.
describe('HostileA2aTab card picker', () => {
  it('flags the default poisoned sample card', async () => {
    render(<MemoryRouter><HostileA2aTab /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /scan this card/i }));
    expect(await screen.findByText(/finding\(s\)\./i)).toBeInTheDocument();
    expect(screen.getByText(/do not trust this specialist/i)).toBeInTheDocument();
  });

  it('passes the clean sample card with no findings', async () => {
    render(<MemoryRouter><HostileA2aTab /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/agent card/i), { target: { value: 'clean' } });
    fireEvent.click(screen.getByRole('button', { name: /scan this card/i }));
    expect(await screen.findByText(/no poisoned metadata found/i)).toBeInTheDocument();
  });

  it('reveals the URL input only for the live option', () => {
    render(<MemoryRouter><HostileA2aTab /></MemoryRouter>);
    expect(screen.queryByPlaceholderText(/agent-card\.json/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/agent card/i), { target: { value: 'live' } });
    expect(screen.getByPlaceholderText(/agent-card\.json/i)).toBeInTheDocument();
  });
});
