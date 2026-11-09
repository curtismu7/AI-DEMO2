// /use-cases/live on the Ping UI Standard (docs/ping-ui-primitives.md): banner first, one primary Run button per view
// state, cards with a real keyboard control, status chips that carry a word, focus that stays put, sample figures that
// say so. The existing LiveUseCaseWorkbenchPage tests cover behaviour; these cover the conversion.
import React from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../LiveUseCaseWorkbenchPage.css', () => ({}), { virtual: true });
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { useCases: [] } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: 'banking' }) }));
vi.mock('../../components/VerticalSwitcher', () => ({ default: () => <div data-testid="vertical-switcher" /> }));
vi.mock('../../components/TokenChainTraceRail', () => ({ default: () => <div data-testid="trace-rail" /> }));
vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    subscribe: vi.fn(() => vi.fn()),
    beginTrace: vi.fn(),
    bindFlowTrace: vi.fn(),
    ingestTokenEvent: vi.fn(),
    ingestAuthorize: vi.fn(),
    completeTrace: vi.fn(),
  },
}));
vi.mock('../../services/mcpFlowSseClient', () => ({ openMcpFlowSse: vi.fn(() => vi.fn()) }));
vi.mock('../../services/tokenChainTrace/simTraceAdapter', () => ({ buildSimRailEvents: vi.fn(() => []) }));
vi.mock('../../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({ setSurfaceHostEl: vi.fn(), setToolbarHostEl: vi.fn(), toolbarHostEl: null }),
}));
vi.mock('../../context/ProofOfEnforcementContext', () => ({
  useProofOfEnforcement: () => ({ verdict: null, history: [] }),
}));

import LiveUseCaseWorkbenchPage from '../LiveUseCaseWorkbenchPage';
import apiClient from '../../services/apiClient';

// UC1 is in both the 15-Min Security Demo group and the primary group, so the page renders it twice.
const CATALOG = [
  { id: 'UC24', useCaseId: 'public-catalog', title: 'Public catalog', expectedOutcome: 'PERMIT', trigger: { type: 'chip', text: 'branches near me' } },
  { id: 'UC1', useCaseId: 'delegated', title: 'Delegated access', expectedOutcome: 'PERMIT', trigger: { type: 'chip', text: 'show my balance' } },
  { id: 'UC6', useCaseId: 'wrong-scope', title: 'Insufficient scope', expectedOutcome: 'DENY', trigger: { type: 'attack', sim: 'insufficient-scope' } },
  { id: 'UC99', useCaseId: 'manual-only', title: 'Manual only', track: 'foundations', trigger: { type: 'manual' } },
];

const primaries = (root) => [...root.querySelectorAll('.pu-btn--primary')];
const runButtons = (root) => [...root.querySelectorAll('.luw-card__run')];

async function renderLoaded(catalog = CATALOG) {
  apiClient.get.mockResolvedValue({ data: { useCases: catalog } });
  const view = render(<LiveUseCaseWorkbenchPage />);
  await waitFor(() => expect(view.container.querySelector('.luw-card')).not.toBeNull());
  return view;
}

beforeEach(() => {
  localStorage.clear();
  apiClient.get.mockReset();
  apiClient.post.mockReset();
  apiClient.post.mockResolvedValue({ data: {} });
});

describe('/use-cases/live: P2 banner', () => {
  it('is the first child of the PingPage root, a note, and says what is real and what is a sample', async () => {
    const { container } = await renderLoaded();
    const root = container.querySelector('.pu-page.luw');
    expect(root).not.toBeNull();
    const first = root.firstElementChild;
    expect(first).toHaveClass('pu-banner-wrap');
    const banner = within(first).getByTestId('luw-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent(/samples this page keeps itself/i);
    expect(banner).toHaveTextContent(/never read from an account/i);
  });

  it('does not name a source it cannot know (the track label and banner never hardcode PingOne)', async () => {
    const { container } = await renderLoaded([
      ...CATALOG,
      { id: 'UC77', useCaseId: 'atk', title: 'Some attack', track: 'attacks', trigger: { type: 'attack', sim: 'wrong-aud' } },
    ]);
    expect(screen.getByTestId('luw-banner').textContent).not.toMatch(/pingone|gateway/i);
    expect(container.querySelector('.luw-track--attacks > summary').textContent).not.toMatch(/pingone/i);
  });
});

describe('/use-cases/live: P9 one primary per view state', () => {
  it('has no primary while the catalog is loading', () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(primaries(container)).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });

  it('has no primary and an alert when the catalog fails to load', async () => {
    apiClient.get.mockRejectedValue(new Error('boom'));
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'));
    expect(primaries(container)).toHaveLength(0);
  });

  it('makes the selected card the only primary, even when its use case is listed in two groups', async () => {
    const { container } = await renderLoaded();
    // UC24 is auto-selected (first of the primary ids). Select UC1, which renders in the security group AND the primary group.
    const uc1Titles = screen.getAllByRole('button', { name: /Delegated access/ });
    expect(uc1Titles.length).toBe(2);
    fireEvent.click(uc1Titles[0]);
    expect(container.querySelectorAll('.luw-card__title[aria-pressed="true"]')).toHaveLength(2);
    const prim = primaries(container);
    expect(prim).toHaveLength(1);
    expect(within(prim[0].closest('.luw-card')).getByRole('button', { name: /Delegated access/ })).toHaveAttribute('aria-pressed', 'true');
    // Every other Run button is a secondary pu-btn.
    runButtons(container).filter((b) => b !== prim[0]).forEach((b) => {
      expect(b).toHaveClass('pu-btn');
      expect(b).not.toHaveClass('pu-btn--primary');
    });
  });

  it('has no primary when the selected card is not runnable', async () => {
    const { container } = await renderLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: /Manual only/ })[0]);
    expect(within(container).getAllByText('Not runnable in live workbench').length).toBeGreaterThan(0);
    expect(primaries(container)).toHaveLength(0);
  });

  it('keeps the Policy conformance button a secondary', async () => {
    const { container } = await renderLoaded();
    const btn = screen.getByRole('button', { name: /Run all policies/ });
    expect(btn).toHaveClass('pu-btn');
    expect(btn).not.toHaveClass('pu-btn--primary');
    expect(primaries(container).every((b) => b !== btn)).toBe(true);
  });
});

describe('/use-cases/live: keyboard and focus', () => {
  it('keeps focus on the Run button after it is pressed and ignores a second press (aria-disabled, never disabled)', async () => {
    let finish;
    apiClient.post.mockImplementation((url) => {
      if (url === '/api/use-cases/demo/run') {
        return new Promise((r) => { finish = () => r({ data: { useCaseId: 'public-catalog', triggerText: 'branches near me' } }); });
      }
      return Promise.resolve({ data: {} });
    });
    const { container } = await renderLoaded();
    const run = primaries(container)[0];
    run.focus();
    expect(document.activeElement).toBe(run);
    fireEvent.click(run);

    await waitFor(() => expect(run).toHaveAttribute('aria-disabled', 'true'));
    expect(run).not.toBeDisabled();
    expect(run).toHaveTextContent('Running…');
    expect(document.activeElement).toBe(run);
    // every Run button is aria-disabled while the run is in flight, and a second press does nothing
    runButtons(container).forEach((b) => expect(b).toHaveAttribute('aria-disabled', 'true'));
    const before = apiClient.post.mock.calls.length;
    fireEvent.click(runButtons(container)[1]);
    expect(apiClient.post.mock.calls.length).toBe(before);

    await act(async () => { finish(); });
    await waitFor(() => expect(run).not.toHaveAttribute('aria-disabled'));
    expect(document.activeElement).toBe(run);
  });

  it('selects a card from its title button (Enter and Space are native button activation) and marks it aria-pressed', async () => {
    await renderLoaded();
    const card = screen.getAllByRole('button', { name: /Insufficient scope/ })[0];
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not put a button inside a role=button: the card container is plain and the title is the control', async () => {
    const { container } = await renderLoaded();
    container.querySelectorAll('.luw-card').forEach((card) => {
      expect(card).not.toHaveAttribute('role');
      expect(card).not.toHaveAttribute('tabindex');
      expect(card).toHaveClass('pu-card');
    });
    expect(container.querySelectorAll('[role="button"] button')).toHaveLength(0);
  });

  it('moves focus into the drawer (the close button) when it opens and back to the edge tab when it closes', async () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    const { container } = await renderLoaded();
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
    expect(document.activeElement).toBe(document.body); // a persisted closed state does not steal focus on mount
    fireEvent.click(screen.getByLabelText('Open demo script'));
    expect(document.activeElement).toBe(screen.getByLabelText('Close demo script'));
    fireEvent.click(screen.getByLabelText('Close demo script'));
    expect(document.activeElement).toBe(screen.getByLabelText('Open demo script'));
  });

  it('the page title is the h1 and the drawer heading is an h2', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Use Cases');
    expect(screen.getByRole('heading', { level: 2, name: 'Demo script' })).toBeInTheDocument();
  });
});

describe('/use-cases/live: chips carry a word and the right tone', () => {
  it('shows Ready on the selected card, Running while a run is in flight, Done after, and Failed on an error', async () => {
    let finish;
    apiClient.post.mockImplementation((url) => {
      if (url === '/api/use-cases/demo/run') return new Promise((r) => { finish = r; });
      return Promise.resolve({ data: {} });
    });
    const { container } = await renderLoaded();
    const cardOf = (id) => [...container.querySelectorAll('.luw-card')].find((c) => c.querySelector('.luw-card__meta').textContent.startsWith(id));
    expect(within(cardOf('UC24')).getByText('Ready').closest('.pu-chip')).toHaveClass('pu-chip--neutral');

    fireEvent.click(primaries(container)[0]);
    await waitFor(() => expect(within(cardOf('UC24')).getByText('Running').closest('.pu-chip')).toHaveClass('pu-chip--info'));

    await act(async () => { finish({ data: { useCaseId: 'public-catalog', triggerText: 'x' } }); });
    // "Done" means the request returned: neutral, never green (the outcome is the verdict strip's job).
    await waitFor(() => expect(within(cardOf('UC24')).getByText('Done').closest('.pu-chip')).toHaveClass('pu-chip--neutral'));
  });

  it('marks a failed run on its card with a danger chip and announces the message', async () => {
    apiClient.post.mockRejectedValue(new Error('launch failed'));
    const { container } = await renderLoaded();
    fireEvent.click(primaries(container)[0]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('launch failed'));
    const failed = screen.getAllByText('Failed')[0].closest('.pu-chip');
    expect(failed).toHaveClass('pu-chip--danger');
  });

  it('labels the resource-server badge as a neutral tag, never a green or amber status', async () => {
    const { container } = await renderLoaded([
      { ...CATALOG[1], resourceServer: { id: 'invest', name: 'Invest', port: 8081 } },
      CATALOG[0],
    ]);
    const badge = container.querySelector('.luw-card__rs-badge');
    expect(badge).toHaveClass('pu-chip', 'pu-chip--neutral');
    expect(badge).toHaveTextContent('Invest :8081');
  });
});

describe('/use-cases/live: simulated content never reads as real', () => {
  it('marks the glance figures as samples with a chip that carries a word', async () => {
    const { container } = await renderLoaded();
    const glance = container.querySelector('.luw-glance');
    const chips = glance.querySelectorAll('.pu-chip');
    expect(chips).toHaveLength(2);
    chips.forEach((c) => expect(c).toHaveTextContent('Sample'));
    expect(within(glance).getByText('$4,820.00')).toBeInTheDocument();
  });
});

describe('/use-cases/live: stylesheet', () => {
  const css = readFileSync(resolve(__dirname, '../LiveUseCaseWorkbenchPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('takes a closed drawer out of the tab order (visibility: hidden) and brings it back in the stacked layout', () => {
    const closed = css.match(/\n\.luw-body--drawer-closed \.luw-drawer\s*\{([^}]*)\}/);
    expect(closed).not.toBeNull();
    expect(closed[1]).toMatch(/visibility:\s*hidden/);
    const media = css.match(/@media \(max-width: 860px\) \{([\s\S]*?)\n\}/)[1];
    const stacked = media.match(/\.luw-body--drawer-closed\s+\.luw-drawer[^{]*\{([^}]*)\}/);
    expect(stacked[1]).toMatch(/visibility:\s*visible/);
  });

  it('sets no literal hex colour and no literal font size (tokens only)', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/font-size:\s*[0-9.]+(?:px|rem|em)/);
  });

  it('every themed ground sets its own ink', () => {
    const bad = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      if (/(?:^|\n)\s*background(?:-color)?\s*:[^;]*--th-/.test(body) && !/(?:^|\n)\s*color\s*:/.test(body)) bad.push(m[1].trim());
    }
    expect(bad).toEqual([]);
  });
});
