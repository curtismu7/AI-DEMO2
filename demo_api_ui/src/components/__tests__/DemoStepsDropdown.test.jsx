/**
 * DemoStepsDropdown — agent header Demo steps menu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DemoStepsDropdown from '../DemoStepsDropdown';
import apiClient from '../../services/apiClient';
import { DEMO_USE_CASE_IDS } from '../../config/demoUseCaseSteps';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const CATALOG = DEMO_USE_CASE_IDS.map((id, i) => ({
  id,
  useCaseId: `slug-${id}`,
  title: `Title for ${id}`,
  trigger: { type: 'chip', text: `prompt for ${id}` },
  // Insert a decoy so order-from-catalog ≠ demo script order
  _order: DEMO_USE_CASE_IDS.length - i,
})).reverse();

describe('DemoStepsDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it('renders the Demo steps trigger', () => {
    render(
      <DemoStepsDropdown
        open={false}
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('demo-steps-trigger')).toHaveTextContent(/Demo steps/);
  });

  it('lists demo steps in DEMO_USE_CASE_IDS order when open', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    // Primary steps are always visible
    const primaryItems = screen.getAllByTestId(/^demo-step-/);
    expect(primaryItems.map((el) => el.getAttribute('data-testid'))).toEqual(
      DEMO_USE_CASE_IDS.slice(0, 6).map((id) => `demo-step-${id}`),
    );
    expect(screen.getByTestId('demo-step-UC1')).toHaveTextContent(/Step 1/);

    // Expand the advanced section to reveal remaining steps
    fireEvent.click(screen.getByTestId('demo-steps-advanced-toggle'));

    const allItems = screen.getAllByTestId(/^demo-step-/);
    expect(allItems.map((el) => el.getAttribute('data-testid'))).toEqual(
      DEMO_USE_CASE_IDS.map((id) => `demo-step-${id}`),
    );
    // UC2 is the first advanced step (step 7)
    expect(screen.getByTestId('demo-step-UC2')).toHaveTextContent(/Step 7/);
  });

  it('calls onSelect with the catalog entry when a step is clicked', async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DemoStepsDropdown
        open
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-step-UC1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe('UC1');
    expect(onSelect.mock.calls[0][1]).toBe(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows Clear progress even with nothing completed, and clears checkmarks on click', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());
    // Always visible — a presenter should be able to reset before any step
    // has run, not just after one is marked done.
    expect(screen.getByTestId('demo-steps-clear')).toBeInTheDocument();

    // Mark a step completed the way the real onSelect callback does, then click
    // a different primary step to force the tick-driven re-render.
    sessionStorage.setItem('bx_uc_completed', JSON.stringify(['UC1']));
    fireEvent.click(screen.getByTestId(`demo-step-${DEMO_USE_CASE_IDS[1]}`));

    expect(await screen.findByTestId('demo-steps-clear')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-UC1').querySelector('.ba-demo-steps-popout__check')).toBeTruthy();

    fireEvent.click(screen.getByTestId('demo-steps-clear'));

    expect(screen.getByTestId('demo-steps-clear')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-UC1').querySelector('.ba-demo-steps-popout__check')).toBeFalsy();
    expect(sessionStorage.getItem('bx_uc_completed')).toBeNull();
  });
});
