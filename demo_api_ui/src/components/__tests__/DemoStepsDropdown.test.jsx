/**
 * DemoStepsDropdown — agent header Demo steps menu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DemoStepsDropdown from '../DemoStepsDropdown';
import apiClient from '../../services/apiClient';
import {
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  PRIVILEGE_USE_CASE_IDS,
  DEMO_USE_CASE_IDS,
  ADMIN_PRIMARY_USE_CASE_IDS,
} from '../../config/demoUseCaseSteps';
import { clearIdJagRunState, ID_JAG_USE_CASE_ID } from '../../utils/idJagRunMode';

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const CATALOG = DEMO_USE_CASE_IDS.map((id, i) => ({
  id,
  useCaseId: id === 'UC40' ? ID_JAG_USE_CASE_ID : `slug-${id}`,
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

  it('portals its floating panel to the document body above the Command Dock', async () => {
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

  it('renders the close control and resize handles when open', async () => {
    render(
      <DemoStepsDropdown
        open
        onOpenChange={() => {}}
        onSelect={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('demo-steps-popout')).toBeInTheDocument());

    expect(screen.getByTestId('demo-steps-close')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize southeast' })).toBeInTheDocument();
    expect(screen.getByTestId('demo-steps-popout')).toHaveAttribute('data-placement', 'floating');
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

  it('stacks the drawer search above its actions when the drawer is narrow', () => {
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
      fireEvent.click(screen.getByTestId(`workload-page-${id}`));
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
      { params: { vertical: 'pingone-admin' }, _silent: true },
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
