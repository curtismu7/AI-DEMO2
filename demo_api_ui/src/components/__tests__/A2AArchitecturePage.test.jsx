// /architecture/a2a: the delegation figure is the shared Ping-style diagram (movable boxes, Simulate, Reset, speed), not React Flow's token canvas.
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import A2AArchitecturePage from '../A2AArchitecturePage';
import { DELEGATION_DIAGRAM } from '../../config/a2aArchitectureDiagram';

const renderPage = () => render(<MemoryRouter><A2AArchitecturePage /></MemoryRouter>);

it('draws the shared delegation config in the Ping style', () => {
  renderPage();
  expect(screen.getByTestId('a2a-arch-diagram').classList.contains('sfd--ping')).toBe(true);
  expect(screen.getByTestId('a2a-arch-steps')).toBeTruthy();
  expect(screen.getByRole('button', { name: /simulate/i })).toBeTruthy();
});

it('Simulate starts the walk over every arrow and Reset clears it', () => {
  renderPage();
  expect(screen.getByText(new RegExp(`walks the ${DELEGATION_DIAGRAM.EDGES.length} arrows`))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /simulate/i }));
  expect(screen.getByText(new RegExp(`Step 1 of ${DELEGATION_DIAGRAM.EDGES.length}`))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
  expect(screen.getByText(/walks the/)).toBeTruthy();
});

it('keeps the specialist registry', () => {
  renderPage();
  expect(screen.getByText('Payroll Specialist')).toBeTruthy();
});
