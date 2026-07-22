/**
 * DemoStepsDropdown — agent header Demo steps menu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DemoStepsDropdown from '../DemoStepsDropdown';
import apiClient from '../../services/apiClient';
import { DEMO_USE_CASE_IDS, ADMIN_PRIMARY_USE_CASE_IDS } from '../../config/demoUseCaseSteps';

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
  whatLong: `Long explanation for ${id}`,
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
    expect(
      screen.getByTestId('demo-step-UC1').querySelector('.ba-demo-steps-popout__rail'),
    ).toHaveAttribute('aria-label', 'Step 1');

    // Expand the advanced section to reveal remaining steps
    fireEvent.click(screen.getByTestId('demo-steps-advanced-toggle'));

    const allItems = screen.getAllByTestId(/^demo-step-/);
    expect(allItems.map((el) => el.getAttribute('data-testid'))).toEqual(
      DEMO_USE_CASE_IDS.map((id) => `demo-step-${id}`),
    );
    // UC2 is the first advanced step (step 7)
    expect(
      screen.getByTestId('demo-step-UC2').querySelector('.ba-demo-steps-popout__rail'),
    ).toHaveAttribute('aria-label', 'Step 7');
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

  it('counts completed primary steps in the header and resets on Clear progress', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    const total = screen.getByTestId('demo-steps-progress').textContent.match(/of (\d+) done/)[1];
    expect(screen.getByTestId('demo-steps-progress')).toHaveTextContent(`0 of ${total} done`);

    // Mark one completed the way onSelect does, then click another step to
    // force the tick-driven re-render (same path the checkmarks use).
    sessionStorage.setItem('bx_uc_completed', JSON.stringify(['UC1']));
    fireEvent.click(screen.getByTestId(`demo-step-${DEMO_USE_CASE_IDS[1]}`));
    expect(await screen.findByTestId('demo-steps-progress')).toHaveTextContent(`1 of ${total} done`);

    fireEvent.click(screen.getByTestId('demo-steps-clear'));
    expect(screen.getByTestId('demo-steps-progress')).toHaveTextContent(`0 of ${total} done`);
  });

  it('opens the explain modal from the per-step icon without running the step', async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DemoStepsDropdown
        open
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-explain-UC1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('demo-explain-UC1'));

    expect(await screen.findByText('Long explanation for UC1')).toBeInTheDocument();
    // The icon explains only — running the step stays on the row button.
    expect(onSelect).not.toHaveBeenCalled();
    // The popout MUST close: it is z-index 100061 and DraggableModal is 9999,
    // so leaving it open renders the explanation behind the dropdown.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('treats a backend 400 unknown_vertical as "no demo steps", not an error', async () => {
    // /api/use-cases 400s for verticals with no use-case catalog (e.g. the
    // PingOne Admin console vertical) — that is an expected empty state for
    // this dropdown, not a failure to surface to the user.
    apiClient.get.mockRejectedValue({
      response: { status: 400, data: { error: 'unknown_vertical', vertical: 'pingone-admin' } },
    });
    render(
      <DemoStepsDropdown
        vertical="pingone-admin"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(await screen.findByText('No demo steps for this vertical.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load demo steps/)).not.toBeInTheDocument();
  });
});

describe('DemoStepsDropdown — pingone-admin vertical', () => {
  const ADMIN_CATALOG = ADMIN_PRIMARY_USE_CASE_IDS.map((id) => ({
    id,
    title: `Admin title for ${id}`,
    trigger: { type: 'chip', text: `admin prompt for ${id}` },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: ADMIN_CATALOG } });
  });

  it('lists only the 4 admin steps with no advanced group', async () => {
    render(
      <DemoStepsDropdown
        vertical="pingone-admin"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    const items = screen.getAllByTestId(/^demo-step-/);
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual(
      ADMIN_PRIMARY_USE_CASE_IDS.map((id) => `demo-step-${id}`),
    );
    expect(screen.queryByTestId('demo-steps-advanced-toggle')).not.toBeInTheDocument();
  });

  it('requests the pingone-admin vertical from the API', async () => {
    render(
      <DemoStepsDropdown
        vertical="pingone-admin"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/use-cases',
      { params: { vertical: 'pingone-admin' }, _silent: true },
    ));
  });
});
