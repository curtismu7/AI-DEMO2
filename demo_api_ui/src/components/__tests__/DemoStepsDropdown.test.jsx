/**
 * DemoStepsDropdown — agent header Demo steps menu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import DemoStepsDropdown from '../DemoStepsDropdown';
import apiClient from '../../services/apiClient';
import {
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  PRIVILEGE_USE_CASE_IDS,
  DEMO_USE_CASE_IDS,
  ADMIN_PRIMARY_USE_CASE_IDS,
  EXTRA_STEP_GROUPS,
} from '../../config/demoUseCaseSteps';
import { clearIdJagRunState, ID_JAG_USE_CASE_ID } from '../../utils/idJagRunMode';
import { runPrivilegeA2aChatRun, startPrivilegeA2aChainRun } from '../../utils/privilegeA2aChainRun';
import { runProviderLogin } from '../../utils/providerLoginRun';

vi.mock('../../utils/providerLoginRun', async (importOriginal) => ({
  ...(await importOriginal()),
  runProviderLogin: vi.fn(),
}));

vi.mock('../../utils/privilegeA2aChainRun', () => ({
  PRIVILEGE_A2A_CHAIN_USE_CASE_ID: 'privilege-a2a-agent-chain',
  PRIVILEGE_A2A_ACCESS_REVIEW_USE_CASE_ID: 'privilege-a2a-access-review',
  PRIVILEGE_A2A_DEMO_QUESTIONS: ['Review access on prod-db-primary.'],
  startPrivilegeA2aChainRun: vi.fn(),
  runPrivilegeA2aChatRun: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const CATALOG = DEMO_USE_CASE_IDS.map((id, i) => ({
  id,
  useCaseId: id === 'UC40' ? ID_JAG_USE_CASE_ID : id === 'UC47' ? 'privilege-a2a-agent-chain' : id === 'UC46' ? 'privilege-a2a-access-review' : `slug-${id}`,
  ...(id === 'UC47'
    ? {
      chainRuns: [
        { id: 'allowed', label: 'Run the chain', message: 'Refund order 7 for the customer.', specialist: 'refunds' },
        { id: 'denied', label: 'Ungranted agent', message: 'Refund order 7 for the customer.', specialist: 'restricted' },
      ],
    }
    : {}),
  title: `Title for ${id}`,
  ...(id === 'UC8' ? { demoLabel: '✦ MCP App · transfer approval' } : {}),
  whatLong: `Long explanation for ${id}`,
  trigger: { type: 'chip', text: `prompt for ${id}` },
  // Insert a decoy so order-from-catalog ≠ demo script order
  _order: DEMO_USE_CASE_IDS.length - i,
})).reverse();

describe('DemoStepsDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    clearIdJagRunState();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it.each(['demo-step-UC40', 'demo-step-privilege-UC40'])(
    'launches %s through the shared live ID-JAG intent', async (testId) => {
      const onSelect = vi.fn();
      const onLaunch = vi.fn();
      window.addEventListener('id-jag-run-requested', onLaunch);
      try {
        render(<DemoStepsDropdown open onOpenChange={() => {}} onSelect={onSelect} />);
        if (testId === 'demo-step-privilege-UC40') {
          fireEvent.click(await screen.findByTestId('demo-steps-group-j-privilege-mcp'));
        }
        const chip = await screen.findByTestId(testId);
        expect(chip).toHaveTextContent('Run PingFederate ID-JAG');
        expect(chip).toHaveTextContent('Signs out your current session silently, then opens PingFederate login.');
        fireEvent.click(chip);
        expect(onLaunch).toHaveBeenCalledTimes(1);
        expect(onLaunch.mock.calls[0][0].detail).toEqual({
          useCaseId: ID_JAG_USE_CASE_ID,
          mode: 'live-id-jag',
          message: 'show my balance',
          returnTo: '/dashboard',
        });
        expect(onSelect).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('id-jag-run-requested', onLaunch);
      }
    },
  );

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

  it('places UC46 at step 25 in the numbered primary Demo Steps sequence', async () => {
    const onSelect = vi.fn();
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(await screen.findByTestId('demo-step-UC46'));

    expect(onSelect.mock.calls[0][0].id).toBe('UC46');
    expect(onSelect.mock.calls[0][1]).toBe(25);
  });

  it('runs UC46 in the embedded agent from its own button; the card still opens the route', async () => {
    const onSelect = vi.fn();
    render(<DemoStepsDropdown open onOpenChange={() => {}} onSelect={onSelect} />);

    fireEvent.click(await screen.findByTestId('demo-step-UC46'));
    expect(runPrivilegeA2aChatRun).not.toHaveBeenCalled();
    expect(onSelect.mock.calls[0][0].trigger).toEqual({ type: 'chip', text: 'prompt for UC46' });

    fireEvent.click(screen.getByTestId('a2a-in-agent-UC46'));
    expect(runPrivilegeA2aChatRun).toHaveBeenCalledWith({ message: 'Review access on prod-db-primary.' });
    const [uc, step, opts] = onSelect.mock.calls[1];
    expect(uc.id).toBe('UC46');
    expect(step).toBe(25);
    expect(uc.trigger).toEqual({ type: 'link', path: '/dashboard' });
    expect(opts).toEqual({ keepTrace: true });
  });

  it('starts the Privilege A2A agent chain from step 26 and still hands the step to the page', async () => {
    const onSelect = vi.fn();
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(await screen.findByTestId('demo-step-UC47'));

    expect(startPrivilegeA2aChainRun).toHaveBeenCalledWith({
      message: 'Refund order 7 for the customer.',
      specialist: 'refunds',
    });
    expect(onSelect.mock.calls[0][0].id).toBe('UC47');
    expect(onSelect.mock.calls[0][1]).toBe(26);

    fireEvent.click(screen.getByTestId('chain-run-denied'));

    expect(startPrivilegeA2aChainRun).toHaveBeenLastCalledWith({
      message: 'Refund order 7 for the customer.',
      specialist: 'restricted',
    });
  });

  it('aborts an outstanding catalog request when unmounted', () => {
    let requestSignal;
    apiClient.get.mockImplementationOnce((_url, config) => {
      requestSignal = config.signal;
      return new Promise(() => {});
    });
    const { unmount } = render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(requestSignal).toBeDefined();
    expect(requestSignal.aborted).toBe(false);
    unmount();
    expect(requestSignal.aborted).toBe(true);
  });

  it('portals the floating panel to the document body without a modal scrim', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    const panel = await screen.findByTestId('demo-steps-popout');
    expect(panel.parentElement).toBe(document.body);
    expect(panel).toHaveAttribute('data-placement', 'floating');
    expect(screen.queryByTestId('demo-steps-scrim')).not.toBeInTheDocument();
  });

  it('opens clear of the strip the floating agent reserves on the right', async () => {
    const reserveRight = 400;
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
        reserveRight={reserveRight}
      />,
    );
    const panel = await screen.findByTestId('demo-steps-popout');
    const right = parseFloat(panel.style.left) + parseFloat(panel.style.width);
    expect(right).toBeLessThanOrEqual(window.innerWidth - reserveRight);
  });

  it('does not render the legacy live-P1AZ arming button (flags are on by default)', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(await screen.findByTestId('demo-steps-popout')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-live-p1az')).not.toBeInTheDocument();
  });

  it('renders a Stop Agent action that calls onStopAgentClick when open', async () => {
    const onStopAgentClick = vi.fn();
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
        onStopAgentClick={onStopAgentClick}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('demo-steps-stop-agent'));
    expect(onStopAgentClick).toHaveBeenCalledTimes(1);
  });

  it('drawer placement pins to the right edge, resizes by its west edge only, and still closes and pops out', async () => {
    const onOpenChange = vi.fn();
    render(
      <DemoStepsDropdown
        open
        placement="drawer"
        onOpenChange={onOpenChange}
        onSelect={() => {}}
      />,
    );
    const panel = await screen.findByTestId('demo-steps-popout');
    expect(panel).toHaveAttribute('data-placement', 'drawer');
    expect(panel.className).toContain('fp-panel--drawer');
    expect(panel.style.right).toBe('0px');
    expect(panel.style.top).toBe('0px');
    expect(screen.getByRole('separator', { name: 'Resize west' })).toBeInTheDocument();
    expect(screen.queryAllByRole('separator')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /collapse/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pop out Demo Steps' })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Close panel', exact: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe('running a step', () => {
    // A pop-out renders the steps into the popup's own document; give it a real
    // container (attached to body so screen queries reach it).
    function mockPopOut() {
      const container = document.createElement('div');
      container.id = 'fp-popout-root';
      document.body.appendChild(container);
      const win = {
        closed: false,
        close: vi.fn(),
        addEventListener: vi.fn(),
        history: { pushState: vi.fn() },
        document: { write: vi.fn(), close: vi.fn(), getElementById: () => container },
      };
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(win);
      return { win, container, openSpy };
    }

    it('closes the panel when a step runs from the in-page panel', async () => {
      const onOpenChange = vi.fn();
      const onSelect = vi.fn();
      render(<DemoStepsDropdown open onOpenChange={onOpenChange} onSelect={onSelect} />);
      fireEvent.click(await screen.findByTestId('demo-step-UC1'));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('keeps the panel open when a step runs from the pop-out window', async () => {
      const onOpenChange = vi.fn();
      const onSelect = vi.fn();
      const onPopOutChange = vi.fn();
      const { win, container, openSpy } = mockPopOut();
      try {
        render(
          <DemoStepsDropdown
            open
            onOpenChange={onOpenChange}
            onSelect={onSelect}
            onPopOutChange={onPopOutChange}
          />,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Pop out Demo Steps' }));
        await waitFor(() => expect(onPopOutChange).toHaveBeenCalledWith(true));
        fireEvent.click(await within(container).findByTestId('demo-step-UC1'));
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onOpenChange).not.toHaveBeenCalledWith(false);
        expect(win.close).not.toHaveBeenCalled();
      } finally {
        openSpy.mockRestore();
        container.remove();
      }
    });
  });

  it('closes from the title bar and keeps the pop-out and resize affordances when open', async () => {
    const onOpenChange = vi.fn();
    render(
      <DemoStepsDropdown
        open
        onOpenChange={onOpenChange}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    const panel = screen.getByRole('dialog', { name: 'Demo steps' });
    const closeButton = within(panel).getByRole('button', { name: 'Close panel', exact: true });
    expect(closeButton).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pop out Demo Steps' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize east' })).toBeInTheDocument();
    expect(screen.getByTestId('demo-steps-popout')).toHaveAttribute('data-placement', 'floating');

    fireEvent.click(closeButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('launches Agent Identity Academy from Demo steps', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Agent Identity Academy' })).toHaveAttribute(
      'href',
      '/academy/identity',
    );
  });

  it('links to the Jev decision-model page from Demo steps', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Jev' })).toHaveAttribute('href', '/jev-learning');
  });

  it('stacks the floating panel search above its actions when the panel is narrow', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../AIAgent.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@container\s*\(max-width:\s*460px\)[\s\S]*?\.ba-demo-steps-float__content \.ba-demo-steps-popout__header-actions[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/,
    );
    expect(css).toMatch(
      /@container\s*\(max-width:\s*460px\)[\s\S]*?\.ba-demo-steps-float__content \.ba-demo-steps-popout__search[\s\S]*?grid-column:\s*1\s*\/\s*-1/,
    );
  });

  it('omits the Stop Agent action when onStopAgentClick is not provided', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());
    expect(screen.queryByTestId('demo-steps-stop-agent')).not.toBeInTheDocument();
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

    // All 21 steps show at once — the primary/advanced split was flattened
    // to a single 5-column grid (#826); nothing is gated behind a toggle.
    const items = screen.getAllByTestId(/^demo-step-/);
    expect(items.map((el) => el.getAttribute('data-testid'))).toEqual(
      DEMO_USE_CASE_IDS.map((id) => `demo-step-${id}`),
    );
    // UC24 (Act 1 — public catalog) opens the script, so UC1 is step 2.
    expect(screen.getByTestId('demo-explain-UC1')).toHaveAttribute(
      'aria-label',
      'Explain step 2: UC1 — Title for UC1',
    );
    // UC2 is the 9th id in walkthrough order
    expect(screen.getByTestId('demo-explain-UC2')).toHaveAttribute(
      'aria-label',
      'Explain step 9: UC2 — Title for UC2',
    );
    expect(screen.getByTestId('demo-step-UC-TOOL1')).toBeInTheDocument();
  });

  it('shows the CIAM agent-type group as live demo chips', async () => {
    const ciamCatalog = [
      ...CATALOG,
      ...CIAM_AGENT_TYPE_USE_CASE_IDS
        .filter((id) => !DEMO_USE_CASE_IDS.includes(id))
        .map((id) => ({
          id,
          title: `CIAM title for ${id}`,
          trigger: { type: 'chip', text: `CIAM prompt for ${id}` },
        })),
    ];
    apiClient.get.mockResolvedValueOnce({ data: { useCases: ciamCatalog } });
    const onSelect = vi.fn();

    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={onSelect}
      />,
    );

    expect(await screen.findByTestId('demo-steps-ciam-group')).toBeInTheDocument();
    expect(screen.getByText('CIAM agent types')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-ciam-UC43')).toHaveTextContent('CIAM title for UC43');
    expect(screen.getByTestId('demo-step-ciam-UC44')).toHaveTextContent('CIAM title for UC44');
    expect(screen.getByTestId('demo-step-ciam-UC2.6')).toHaveTextContent('CIAM title for UC2.6');

    fireEvent.click(screen.getByTestId('demo-step-ciam-UC44'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'UC44' }),
      expect.any(Number),
      undefined,
    );
  });

  it('keeps the 13 Guided Journey stage groups visible and scopes Personal Agent in one click', async () => {
    const ciamCatalog = [
      ...CATALOG,
      ...CIAM_AGENT_TYPE_USE_CASE_IDS
        .filter((id) => !DEMO_USE_CASE_IDS.includes(id))
        .map((id) => ({
          id,
          title: `CIAM title for ${id}`,
          trigger: { type: 'chip', text: `CIAM prompt for ${id}` },
        })),
    ];
    apiClient.get.mockResolvedValueOnce({ data: { useCases: ciamCatalog } });

    render(<DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />);

    expect(await screen.findByTestId('demo-steps-group-j-personal-agent')).toBeInTheDocument();
    // 13 journey stages + the "All" chip.
    expect(screen.getAllByTestId(/^demo-steps-group-/)).toHaveLength(14);
    fireEvent.click(screen.getByTestId('demo-steps-group-j-personal-agent'));

    expect(screen.getByTestId('demo-step-ciam-UC43')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-ciam-UC44')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-UC38')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-step-UC24')).not.toBeInTheDocument();
  });

  it('uses the MCP App demo label for the selected transfer approval step', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC8')).toBeInTheDocument());
    expect(screen.getByTestId('demo-step-UC8')).toHaveTextContent('✦ MCP App · transfer approval');
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
    expect(onSelect.mock.calls[0][1]).toBe(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each([
    ['UC38', 'sporting-goods', '/workload-agents?useCase=UC38'],
    ['UC44', 'healthcare', '/workload-agents?vertical=banking&useCase=UC44'],
  ])('runs %s as a chip prompt and its secondary button opens the workload page with the active vertical', async (id, vertical, path) => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const catalog = CATALOG.map((uc) => uc.id === id ? { ...uc, trigger: { type: 'link', path }, runPrompt: `pay a $600 change fee` } : uc);
    if (id === 'UC44') catalog.push({ id, title: 'UC44', trigger: { type: 'link', path }, runPrompt: 'pay a $600 change fee' });
    apiClient.get.mockResolvedValue({ data: { useCases: catalog } });
    render(<DemoStepsDropdown vertical={vertical} open onOpenChange={onOpenChange} onSelect={onSelect} />);
    const step = await screen.findByTestId(id === 'UC44' ? 'demo-step-ciam-UC44' : 'demo-step-UC38');

    // Main click: runs in the dashboard agent as a chip prompt (no navigation).
    fireEvent.click(step);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].trigger).toMatchObject({ type: 'chip', text: 'pay a $600 change fee' });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Secondary click: opens the dedicated /workload-agents page. jsdom's
    // location.assign is non-configurable — swap the whole location object
    // (same pattern authUi.test.js uses).
    const originalLocation = window.location;
    let assignedUrl = null;
    delete window.location;
    window.location = { ...originalLocation, assign: (u) => { assignedUrl = u; } };
    try {
      fireEvent.click(screen.getAllByTestId(`workload-page-${id}`)[0]);
      expect(assignedUrl).toBeTruthy();
      expect(assignedUrl).toContain(`useCase=${id}`);
      expect(assignedUrl).toContain(`vertical=${vertical}`);
    } finally {
      window.location = originalLocation;
    }
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
    expect(screen.getByTestId('demo-step-UC1').querySelector('.banking-chips-dropdown__check')).toBeTruthy();

    fireEvent.click(screen.getByTestId('demo-steps-clear'));

    expect(screen.getByTestId('demo-steps-clear')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-UC1').querySelector('.banking-chips-dropdown__check')).toBeFalsy();
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

    const total = screen.getByTestId('demo-steps-progress').textContent.match(/of (\d+) script steps done/)[1];
    expect(screen.getByTestId('demo-steps-progress')).toHaveTextContent(`0 of ${total} script steps done`);

    // Mark one completed the way onSelect does, then click another step to
    // force the tick-driven re-render (same path the checkmarks use).
    sessionStorage.setItem('bx_uc_completed', JSON.stringify(['UC1']));
    fireEvent.click(screen.getByTestId(`demo-step-${DEMO_USE_CASE_IDS[1]}`));
    expect(await screen.findByTestId('demo-steps-progress')).toHaveTextContent(`1 of ${total} script steps done`);

    fireEvent.click(screen.getByTestId('demo-steps-clear'));
    expect(screen.getByTestId('demo-steps-progress')).toHaveTextContent(`0 of ${total} script steps done`);
  });

  it('opens the explain modal from the per-step icon without closing Demo steps or running the step', async () => {
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
    // The presenter keeps the script drawer open while inspecting an explanation.
    expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
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

describe('DemoStepsDropdown — search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it('filters the cards to matches on id, hiding the rest', async () => {
    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    // "UC8" is a collision-free id substring (no UC8x exists).
    fireEvent.change(screen.getByTestId('demo-steps-search'), {
      target: { value: 'UC8' },
    });

    const shown = screen.getAllByTestId(/^demo-step-/);
    expect(shown.map((el) => el.getAttribute('data-testid'))).toEqual([
      'demo-step-UC8',
    ]);
    expect(screen.queryByTestId('demo-step-UC1')).not.toBeInTheDocument();
  });

  it('filters on title as well as id', async () => {
    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    // Catalog titles are `Title for <id>`; "for UC13" is unique to that card.
    fireEvent.change(screen.getByTestId('demo-steps-search'), {
      target: { value: 'for UC13' },
    });

    const shown = screen.getAllByTestId(/^demo-step-/);
    expect(shown.map((el) => el.getAttribute('data-testid'))).toEqual([
      'demo-step-UC13',
    ]);
  });

  it('filters on presenter-friendly use-case terms', async () => {
    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('demo-steps-search'), {
      target: { value: 'mfa' },
    });

    expect(screen.getByTestId('demo-step-UC7')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-step-UC1')).not.toBeInTheDocument();
  });

  it('filters the live script by Guided Journey stage group', async () => {
    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('demo-steps-group-j-authorize'));

    expect(screen.getByTestId('demo-step-UC6')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-UC14')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-step-UC1')).not.toBeInTheDocument();
    expect(screen.getByTestId('demo-steps-group-j-authorize')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the Privilege & JIT steps from the shared catalog under the Privilege MCP journey stage', async () => {
    const privilegeCatalog = [
      ...CATALOG,
      ...PRIVILEGE_USE_CASE_IDS
        .filter((id) => !DEMO_USE_CASE_IDS.includes(id))
        .map((id) => ({
          id,
          title: `Privilege lane ${id}`,
          trigger: { type: 'link', text: `Open Privilege ${id}` },
        })),
    ];
    apiClient.get.mockResolvedValueOnce({ data: { useCases: privilegeCatalog } });

    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('demo-steps-group-j-privilege-mcp'));

    expect(screen.getByTestId('demo-steps-privilege-group')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-privilege-UC17')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-privilege-UC-PAM-SCRIPT')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-step-UC1')).not.toBeInTheDocument();
  });

  it('shows the Privilege & JIT group in the default All view, without repeating scripted steps', async () => {
    const privilegeCatalog = [
      ...CATALOG,
      ...PRIVILEGE_USE_CASE_IDS
        .filter((id) => !DEMO_USE_CASE_IDS.includes(id))
        .map((id) => ({
          id,
          title: `Privilege lane ${id}`,
          trigger: { type: 'link', text: `Open Privilege ${id}` },
        })),
    ];
    apiClient.get.mockResolvedValueOnce({ data: { useCases: privilegeCatalog } });

    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    expect(screen.getByTestId('demo-steps-privilege-group')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-privilege-UC17')).toBeInTheDocument();
    // UC40 is already a scripted step, so it is not listed a second time.
    expect(screen.queryByTestId('demo-step-privilege-UC40')).not.toBeInTheDocument();
  });

  it.each([['UC-LOGIN', 'pingone'], ['UC-LOGIN-PF', 'pingfederate']])(
    'the %s sign-in step starts a live %s login instead of selecting a use case',
    async (id, provider) => {
      const onSelect = vi.fn();
      const catalog = [
        ...CATALOG,
        { id, title: `Login ${id}`, trigger: { type: 'link', path: '/login-flow' } },
      ];
      apiClient.get.mockResolvedValueOnce({ data: { useCases: catalog } });
      render(<DemoStepsDropdown open onOpenChange={() => {}} onSelect={onSelect} />);
      const step = await screen.findByTestId(`demo-extra-sign-in-${id}`);
      fireEvent.click(step);
      expect(runProviderLogin).toHaveBeenCalledWith(provider);
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it('shows the themed groups in All; A2A repeats steps under their original numbers', async () => {
    const ids = EXTRA_STEP_GROUPS.flatMap((g) => g.ids);
    const catalog = [
      ...CATALOG,
      ...ids
        .filter((id) => !CATALOG.some((u) => u.id === id))
        .map((id) => ({ id, title: `Themed ${id}`, trigger: { type: 'link', text: `Open ${id}` } })),
    ];
    apiClient.get.mockResolvedValueOnce({ data: { useCases: catalog } });

    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    for (const g of EXTRA_STEP_GROUPS) {
      expect(screen.getByTestId(`demo-steps-extra-${g.id}`)).toBeInTheDocument();
    }
    // UC2 is scripted step 9 and is listed again under A2A with the same number.
    const a2a = screen.getByTestId('demo-steps-extra-a2a');
    expect(within(a2a).getByTestId('demo-extra-a2a-UC2')).toHaveTextContent('9 · UC2');
    expect(within(a2a).getByTestId('demo-extra-a2a-UC37')).toHaveTextContent('43 · UC37');
  });

  it('finds the CIAM group when searching for its group label', async () => {
    const ciamCatalog = [
      ...CATALOG,
      ...CIAM_AGENT_TYPE_USE_CASE_IDS
        .filter((id) => !DEMO_USE_CASE_IDS.includes(id))
        .map((id) => ({ id, title: `Agent lane ${id}` })),
    ];
    apiClient.get.mockResolvedValueOnce({ data: { useCases: ciamCatalog } });

    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-ciam-UC43')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('demo-steps-search'), {
      target: { value: 'ciam' },
    });

    expect(screen.getByTestId('demo-steps-ciam-group')).toBeInTheDocument();
    expect(screen.getByTestId('demo-step-ciam-UC43')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-step-UC1')).not.toBeInTheDocument();
  });

  it('shows a no-match message and clears back to the full list', async () => {
    render(
      <DemoStepsDropdown open onOpenChange={() => {}} onSelect={() => {}} />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('demo-steps-search'), {
      target: { value: 'zzz-no-such-step' },
    });
    expect(screen.getByTestId('demo-steps-no-match')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^demo-step-/)).toHaveLength(0);

    // The ✕ clear button restores every card.
    fireEvent.click(screen.getByTestId('demo-steps-search-clear'));
    expect(screen.queryByTestId('demo-steps-no-match')).not.toBeInTheDocument();
    expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument();
  });
});

describe('DemoStepsDropdown — vertical switching', () => {
  const RETAIL_CATALOG = ['UC1', 'UC6', 'UC7'].map((id) => ({
    id,
    title: `Retail ${id}`,
    whatLong: `Retail explanation for ${id}`,
    trigger: { type: 'chip', text: `retail prompt ${id}` },
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it('re-fetches when the vertical prop changes', async () => {
    const { rerender } = render(
      <DemoStepsDropdown
        vertical="banking"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/use-cases',
      expect.objectContaining({ params: { vertical: 'banking' } }),
    );

    apiClient.get.mockResolvedValue({ data: { useCases: RETAIL_CATALOG } });
    rerender(
      <DemoStepsDropdown
        vertical="retail"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(apiClient.get).toHaveBeenLastCalledWith(
      '/api/use-cases',
      expect.objectContaining({ params: { vertical: 'retail' } }),
    );
  });

  it('renders the new vertical steps after a switch', async () => {
    const { rerender } = render(
      <DemoStepsDropdown
        vertical="banking"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument());

    apiClient.get.mockResolvedValue({ data: { useCases: RETAIL_CATALOG } });
    rerender(
      <DemoStepsDropdown
        vertical="retail"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );

    // After vertical switch, steps re-render from the new catalog
    await waitFor(() =>
      expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument(),
    );
    // Advanced steps (UC2 onwards) from original banking catalog are gone
    expect(screen.queryByTestId('demo-steps-advanced-toggle')).not.toBeInTheDocument();
  });
});

describe('DemoStepsDropdown — loading and error states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows a loading indicator while the API call is in-flight', async () => {
    // Never-resolving promise keeps the component in loading state
    apiClient.get.mockReturnValue(new Promise(() => {}));
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument(),
    );
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    // No steps while loading
    expect(screen.queryAllByTestId(/^demo-step-/)).toHaveLength(0);
  });

  it('shows the error message for non-400 network failures', async () => {
    apiClient.get.mockRejectedValue({ message: 'Network Error' });
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(await screen.findByText('Network Error')).toBeInTheDocument();
    // Must NOT show the "unknown_vertical" empty-state copy
    expect(
      screen.queryByText('No demo steps for this vertical.'),
    ).not.toBeInTheDocument();
  });
});

describe('DemoStepsDropdown — step rail numbering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it('numbers the full list in walkthrough order', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('demo-step-UC1')).toBeInTheDocument(),
    );

    // No rail badge on the card itself since #826's 5-column grid — the
    // stepNumber still flows through to the per-step explain button.
    expect(screen.getByTestId('demo-explain-UC24')).toHaveAttribute(
      'aria-label',
      'Explain step 1: UC24 — Title for UC24',
    );
    expect(screen.getByTestId('demo-explain-UC1')).toHaveAttribute(
      'aria-label',
      'Explain step 2: UC1 — Title for UC1',
    );
    expect(screen.getByTestId('demo-explain-UC6')).toHaveAttribute(
      'aria-label',
      'Explain step 8: UC6 — Title for UC6',
    );
    expect(screen.getByTestId('demo-explain-UC2')).toHaveAttribute(
      'aria-label',
      'Explain step 9: UC2 — Title for UC2',
    );
    // UC29 left the script (not demonstrable on this deployment), so UC32
    // moved up from 22 to 21.
    expect(screen.getByTestId('demo-explain-UC32')).toHaveAttribute(
      'aria-label',
      'Explain step 21: UC32 — Title for UC32',
    );
  });
});

describe('DemoStepsDropdown — explain modal content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: CATALOG } });
  });

  it('shows the whatLong for the specific step that was explained', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('demo-explain-UC7')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('demo-explain-UC7'));

    expect(
      await screen.findByText('Long explanation for UC7'),
    ).toBeInTheDocument();
    // Sibling steps' explanations must NOT bleed through
    expect(
      screen.queryByText('Long explanation for UC1'),
    ).not.toBeInTheDocument();
  });
});

describe('DemoStepsDropdown — pingone-admin vertical', () => {
  const ADMIN_CATALOG = ADMIN_PRIMARY_USE_CASE_IDS.map((id) => ({
    id,
    title: `Admin title for ${id}`,
    trigger: { type: 'chip', text: `admin prompt for ${id}` },
    demoSurface: 'hosted-pingone-mcp',
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    apiClient.get.mockResolvedValue({ data: { useCases: ADMIN_CATALOG } });
  });

  it('lists all admin steps with no advanced group', async () => {
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
      expect.objectContaining({ params: { vertical: 'pingone-admin' }, _silent: true }),
    ));
  });

  it('labels admin chips as the hosted PingOne MCP path', async () => {
    render(
      <DemoStepsDropdown
        vertical="pingone-admin"
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-step-ADMIN1')).toBeInTheDocument());
    expect(screen.getAllByText('Hosted MCP')).toHaveLength(13);
  });
});
