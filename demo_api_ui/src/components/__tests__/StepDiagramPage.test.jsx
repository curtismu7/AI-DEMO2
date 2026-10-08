import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StepDiagramPage from '../StepDiagramPage';

// The per-step diagram page (mock 3): header repeats the stepper's data, the
// scene renders with a Play/Step walkthrough, unknown steps say so plainly.
const renderPage = (step) => render(
  <MemoryRouter initialEntries={[`/step-diagrams/${step}`]}>
    <StepDiagramPage step={step} />
  </MemoryRouter>,
);

describe('StepDiagramPage', () => {
  it('renders the registered diagram: step number, title, result, scene and walkthrough controls', () => {
    renderPage(5);
    expect(screen.getByText('Step 5')).toBeDefined();
    // the title shows in the page header AND inside the SVG scene
    expect(screen.getAllByText('PAR + RAR intent verified (PERMIT)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /play/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /step/i })).toBeDefined();
  });

  it('walkthrough advances: Step button lights hop 1 with its caption', () => {
    renderPage(2);
    fireEvent.click(screen.getByRole('button', { name: /step/i }));
    expect(screen.getByText('Customer signs in')).toBeDefined();
  });

  it('says so for a step without a diagram, with a way back', () => {
    renderPage(13);
    expect(screen.getByText(/no diagram for this step/i)).toBeDefined();
    const back = screen.getByRole('link', { name: /back to mission control/i });
    expect(back.getAttribute('href')).toBe('/dashboard');
  });
});
