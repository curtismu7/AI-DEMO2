// /a2a-architecture: both figures render in the Ping style with the reel and the step detail.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import A2aArchitecturePage from '../A2aArchitecturePage';

it('renders both figures with pingStyle and their step bars', () => {
  render(<MemoryRouter><A2aArchitecturePage /></MemoryRouter>);
  expect(screen.getByTestId('a2a-diagram-delegation').classList.contains('sfd--ping')).toBe(true);
  expect(screen.getByTestId('a2a-diagram-discovery').classList.contains('sfd--ping')).toBe(true);
  expect(screen.getByTestId('a2a-steps-delegation')).toBeTruthy();
  expect(screen.getByTestId('a2a-steps-discovery')).toBeTruthy();
});
