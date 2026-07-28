import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../LiveUseCaseWorkbenchPage.css', () => ({}), { virtual: true });

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { useCases: [] } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ activeId: 'banking' }),
}));

vi.mock('../../components/VerticalSwitcher', () => ({
  default: () => <div data-testid="vertical-switcher" />,
}));

// Mutable so one test (see "rail focus scroll-and-pulse") can swap in a real
// TraceStepCard for the stub, driving the page's scroll/pulse effect through
// its actual `data-step-id={step.id}` output instead of a hardcoded stand-in.
// Must be named `mock*` — vi.mock is hoisted above this file's other
// top-level code, and only `mock`-prefixed bindings survive that hoist.
let mockRailRender = () => <div data-testid="trace-rail" />;
vi.mock('../../components/TokenChainTraceRail', () => ({
  default: (props) => mockRailRender(props),
}));

vi.mock('../../services/tokenChainTrace/tokenChainTraceStore', () => ({
  tokenChainTraceStore: {
    subscribe: vi.fn(() => vi.fn()),
    beginTrace: vi.fn(),
    ingestTokenEvent: vi.fn(),
    ingestAuthorize: vi.fn(),
    completeTrace: vi.fn(),
  },
}));

vi.mock('../../services/tokenChainTrace/simTraceAdapter', () => ({
  buildSimRailEvents: vi.fn(() => []),
}));

const mockSetSurfaceHostEl = vi.fn();
const mockSetToolbarHostEl = vi.fn();
vi.mock('../../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({
    setSurfaceHostEl: mockSetSurfaceHostEl,
    setToolbarHostEl: mockSetToolbarHostEl,
    toolbarHostEl: null,
  }),
}));

const mockProof = { verdict: null, history: [] };
vi.mock('../../context/ProofOfEnforcementContext', () => ({
  useProofOfEnforcement: () => mockProof,
}));

import LiveUseCaseWorkbenchPage from '../LiveUseCaseWorkbenchPage';
import apiClient from '../../services/apiClient';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
// Real (unmocked) component — used only by the "rail focus scroll-and-pulse"
// suite below to render a genuine `data-step-id="authorize"` node.
import TraceStepCard from '../../components/TraceStepCard';

/** The host-registration effect fires more than once during mount (pre-ref-attach
 *  null, functional cleanup updater, then the attached node). Pull the call that
 *  actually carries an Element rather than assuming an index. */
function registeredElement(mockFn) {
  return mockFn.mock.calls
    .map(([arg]) => arg)
    .find((arg) => arg instanceof Element);
}

beforeEach(() => {
  mockSetSurfaceHostEl.mockClear();
  mockSetToolbarHostEl.mockClear();
  localStorage.clear();
});

describe('LiveUseCaseWorkbenchPage — agent toolbar host', () => {
  it('registers a toolbar host node in the topbar', async () => {
    render(<LiveUseCaseWorkbenchPage />);
    await waitFor(() => {
      expect(registeredElement(mockSetToolbarHostEl)).toBeInstanceOf(Element);
    });
    const el = registeredElement(mockSetToolbarHostEl);
    expect(el).toHaveClass('luw-topbar__agent-tools');
    expect(el.closest('.luw-topbar')).not.toBeNull();
  });

  it('still registers the agent surface host', async () => {
    render(<LiveUseCaseWorkbenchPage />);
    await waitFor(() => {
      expect(registeredElement(mockSetSurfaceHostEl)).toBeInstanceOf(Element);
    });
    expect(registeredElement(mockSetSurfaceHostEl)).toHaveClass('luw-agent-host');
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
  });
});

describe('LiveUseCaseWorkbenchPage — demo script slide-over', () => {
  it('starts open and closes on toggle', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-body')).not.toHaveClass('luw-body--drawer-closed');

    fireEvent.click(screen.getByLabelText('Close demo script'));

    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
    expect(screen.getByLabelText('Open demo script')).toBeInTheDocument();
  });

  it('persists the closed state to localStorage', () => {
    render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(screen.getByLabelText('Close demo script'));
    expect(localStorage.getItem('luw_demo_script_collapsed')).toBe('1');
  });

  it('restores the closed state on mount', () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
  });

  it('reopens from the edge tab', () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(screen.getByLabelText('Open demo script'));
    expect(container.querySelector('.luw-body')).not.toHaveClass('luw-body--drawer-closed');
  });

  it('closes on Escape and on the close button', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');

    fireEvent.click(screen.getByLabelText('Open demo script'));
    fireEvent.click(screen.getByLabelText('Close demo script'));
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
  });

  // The drawer is docked in its own grid column, so a modal scrim covers only
  // the agent + Token Chain — dimming them and eating every click there.
  it('renders no scrim over the run area', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-drawer__scrim')).toBeNull();
  });
});

describe('LiveUseCaseWorkbenchPage — demo script slide-over focus return', () => {
  it('returns focus to the edge tab after the close button', () => {
    render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(screen.getByLabelText('Close demo script'));
    expect(document.activeElement).toBe(screen.getByLabelText('Open demo script'));
  });

  it('returns focus to the edge tab after Escape', () => {
    render(<LiveUseCaseWorkbenchPage />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(screen.getByLabelText('Open demo script'));
  });

  it('does not steal focus on a fresh mount with a persisted closed state', () => {
    localStorage.setItem('luw_demo_script_collapsed', '1');
    render(<LiveUseCaseWorkbenchPage />);
    expect(document.activeElement).not.toBe(screen.getByLabelText('Open demo script'));
  });
});

// ── CSS regression: the narrow-viewport revert must beat the closed-state
// specificity, or a presenter who closes the drawer (or arrives with the
// closed preference persisted) sees a blank gap + invisible drawer at
// <=860px with no way to recover (the edge tab is also hidden there).
// jsdom cannot evaluate the cascade, so this asserts on the stylesheet
// source text — same technique already used by
// src/components/__tests__/layout-modal.regression.test.js for the
// UserDashboard grid-column regression.
describe('LiveUseCaseWorkbenchPage CSS — narrow-viewport drawer revert', () => {
  let cssText;

  beforeAll(() => {
    const raw = readFileSync(
      resolve(__dirname, '../LiveUseCaseWorkbenchPage.css'),
      'utf8',
    );
    cssText = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  });

  it('the 860px media query re-asserts transform: none at .luw-body--drawer-closed .luw-drawer specificity', () => {
    const mediaMatch = cssText.match(/@media \(max-width: 860px\) \{([\s\S]*?)\n\}/);
    expect(mediaMatch).not.toBeNull();
    const mediaBlock = mediaMatch[1];

    const ruleMatch = mediaBlock.match(/\.luw-body--drawer-closed\s+\.luw-drawer[^{]*\{([^}]*)\}/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch[1]).toMatch(/transform:\s*none/);
  });

  // A bare `grid-column: -1` is a LINE, not a track: .luw-main starts at the
  // last line and spans one IMPLICIT track past the grid, so the explicit 1fr
  // stays empty and swallows the free space as a grey band while the agent +
  // Token Chain stay pinned at max-content.
  it('places .luw-main in the last declared column, not an implicit track', () => {
    const ruleMatch = cssText.match(/\n\.luw-main\s*\{([^}]*)\}/);
    expect(ruleMatch).not.toBeNull();
    expect(ruleMatch[1]).toMatch(/grid-column:\s*-2\s*\/\s*-1/);
  });
});

// Minimal BroadcastChannel spy: every `new BroadcastChannel('demo-script')`
// call (the page recreates its channel each time selectedId changes) appends
// its posted messages to one shared array so a test can assert on the
// cross-window "select" broadcast without depending on jsdom's native
// implementation.
class TestBroadcastChannel {
  constructor(name) {
    this.name = name;
    TestBroadcastChannel.posted = TestBroadcastChannel.posted || [];
  }
  postMessage(msg) {
    TestBroadcastChannel.posted.push(msg);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

describe('LiveUseCaseWorkbenchPage — teleprompter select broadcast', () => {
  let originalBroadcastChannel;

  beforeEach(() => {
    originalBroadcastChannel = global.BroadcastChannel;
    TestBroadcastChannel.posted = [];
    global.BroadcastChannel = TestBroadcastChannel;
  });

  afterEach(() => {
    global.BroadcastChannel = originalBroadcastChannel;
  });

  it('posts a select message on the demo-script channel when a card is chosen', async () => {
    apiClient.get.mockResolvedValueOnce({
      data: {
        useCases: [
          {
            id: 'UC24',
            title: 'Branches near me',
            trigger: { type: 'chip', text: 'what branches are near me' },
          },
        ],
      },
    });

    render(<LiveUseCaseWorkbenchPage />);

    const card = await screen.findByText(/Branches near me/);
    fireEvent.click(card);

    await waitFor(() => {
      expect(TestBroadcastChannel.posted).toContainEqual({ type: 'select', ucId: 'UC24' });
    });
  });
});

describe('LiveUseCaseWorkbenchPage — token chain focus', () => {
  it('does not emphasize the rail before a run', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-run-layout'))
      .not.toHaveClass('luw-run-layout--rail-focus');
  });

  it('exposes a polite live region that is empty before a run', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent('');
  });

  it('does not move DOM focus into the rail', () => {
    render(<LiveUseCaseWorkbenchPage />);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('LiveUseCaseWorkbenchPage — rail focus on a settled verdict', () => {
  afterEach(() => { mockProof.verdict = null; });

  it('emphasizes the rail and announces the result once a verdict lands', () => {
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'denied-as-expected', matchedSteps: [], missingSteps: [] };
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    expect(container.querySelector('.luw-run-layout'))
      .toHaveClass('luw-run-layout--rail-focus');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(/Run complete/i);
  });

  it('does not claim a match when the verdict is incomplete', () => {
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'incomplete', matchedSteps: [], missingSteps: ['authorize-decision'] };
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent(/not proven/i);
    expect(live).not.toHaveTextContent(/matched/i);
  });

  // Carried over from Task 5's review: the page-level wiring that feeds the
  // Actual chip had no coverage, because the store mock never invoked its
  // callback. This is the exact layer the original bug lived in — Actual must
  // track the observed trace, never the expectation.
  it('feeds the Actual chip from the observed trace, not from expectedOutcome', () => {
    let emit;
    tokenChainTraceStore.subscribe.mockImplementation((fn) => { emit = fn; return () => {}; });
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'verified', matchedSteps: [], missingSteps: [] };

    render(<LiveUseCaseWorkbenchPage />);
    act(() => { emit({ trace: { authorize: { outcome: 'PERMIT', decision: 'PERMIT' } } }); });

    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('PERMIT');
  });

  it('shows the observed outcome even when it contradicts the expectation', () => {
    let emit;
    tokenChainTraceStore.subscribe.mockImplementation((fn) => { emit = fn; return () => {}; });
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'mismatch', matchedSteps: [], missingSteps: [] };

    render(<LiveUseCaseWorkbenchPage />);
    act(() => { emit({ trace: { authorize: { outcome: 'PERMIT', decision: 'PERMIT' } } }); });

    // Would fail if anything seeded Actual from the expectation.
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('PERMIT');
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('not proven');
  });

  it('keeps the token chain rail mounted and intact in the focus state', () => {
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'verified', matchedSteps: [], missingSteps: [] };
    render(<LiveUseCaseWorkbenchPage />);
    // The rail is mocked in this suite, so this asserts the focus state does not
    // unmount or replace it. The real guarantee that its detail is untouched is
    // the rail-detail regression test below plus Task 8's live walkthrough.
    expect(screen.getByTestId('trace-rail')).toBeInTheDocument();
  });

  // Live-verified bug (found by direct browser measurement, not a test): the
  // global trace/verdict isn't scoped to a selection, so switching to a
  // DIFFERENT card kept showing the PREVIOUS card's result as if it were the
  // new one's. This is the exact "expectation vs. wrong observation" failure
  // Task 5 removed, reappearing one layer up at the selection boundary.
  it('clears a stale verdict when the selection changes to a different use case', async () => {
    // UC24/UC5 are real ids (render as ordinary cards; the page filters out
    // wholly synthetic ones) but neither is in DEMO_PRIMARY_USE_CASE_IDS, so
    // the page's own first-primary auto-select never fires — the two clicks
    // below are the only selection events in the test.
    apiClient.get.mockResolvedValueOnce({
      data: {
        useCases: [
          { id: 'UC24', useCaseId: 'public-catalog-access', title: 'Zeta test card A', expectedOutcome: 'PERMIT', trigger: { type: 'chip', text: 'do a' } },
          { id: 'UC5', useCaseId: 'wrong-scope', title: 'Zeta test card B', expectedOutcome: 'DENY', trigger: { type: 'chip', text: 'do b' } },
        ],
      },
    });
    mockProof.verdict = { useCaseId: 'public-catalog-access', title: 'x', state: 'verified', matchedSteps: [], missingSteps: [] };

    const { container } = render(<LiveUseCaseWorkbenchPage />);
    const findCard = (title) =>
      Array.from(container.querySelectorAll('.luw-card')).find((c) => c.textContent.includes(title));

    fireEvent.click(await waitFor(() => {
      const card = findCard('Zeta test card A');
      if (!card) throw new Error('card A not found yet');
      return card;
    }));
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('matched');

    fireEvent.click(findCard('Zeta test card B'));
    // Would fail (still show "matched") if the verdict weren't gated on the
    // newly selected use case's useCaseId.
    expect(screen.queryByTestId('verdict-match')).toBeNull();
  });
});

// Regression for a wrong-id bug: the scroll-and-pulse effect targeted
// `[data-step-id="authorize-decision"]`, a tokenChain *evidence-step* name
// used elsewhere (ProofOfEnforcementContext, TokenChainDisplay), not the
// TraceStepCard `step.id` the real rail renders (buildTraceSteps.js emits
// `makeStep("authorize", ...)`). Every earlier test in this file mocks
// TokenChainTraceRail down to an empty stub, so none of them could ever
// exercise the selector against a real `data-step-id` attribute. This suite
// swaps the stub for the real (unmocked) TraceStepCard for one render, so the
// assertions below run against the actual selector string baked into
// LiveUseCaseWorkbenchPage.js, not a copy of it re-typed in the test.
describe('LiveUseCaseWorkbenchPage — rail focus scroll-and-pulse (real selector)', () => {
  afterEach(() => {
    mockProof.verdict = null;
    mockRailRender = () => <div data-testid="trace-rail" />;
  });

  it('scrolls to and pulses the real authorize step card through the production selector', () => {
    // src/setupTests.js already stubs scrollIntoView on HTMLElement.prototype
    // (jsdom has no implementation) — reuse that vi.fn() rather than shadowing
    // Element.prototype ourselves, which would sit behind HTMLElement.prototype
    // in the chain and never see the real card's call.
    const scrollSpy = window.HTMLElement.prototype.scrollIntoView;
    scrollSpy.mockClear();

    mockRailRender = () => (
      <div data-testid="trace-rail">
        <TraceStepCard
          step={{ id: 'authorize', status: 'done', lane: 'MCP', title: 'Authorize decision', detail: {} }}
          onInspect={() => {}}
        />
      </div>
    );
    mockProof.verdict = { useCaseId: 'uc1', title: 'x', state: 'verified', matchedSteps: [], missingSteps: [] };

    const { container } = render(<LiveUseCaseWorkbenchPage />);

    const card = container.querySelector('[data-step-id="authorize"]');
    expect(card).not.toBeNull();
    expect(scrollSpy).toHaveBeenCalled();
    expect(card).toHaveClass('luw-step-pulse');
  });
});
