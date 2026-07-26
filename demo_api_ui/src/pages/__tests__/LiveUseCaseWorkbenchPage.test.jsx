import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

vi.mock('../../components/TokenChainTraceRail', () => ({
  default: () => <div data-testid="trace-rail" />,
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

vi.mock('../../context/ProofOfEnforcementContext', () => ({
  useProofOfEnforcement: () => ({ verdict: null, history: [] }),
}));

import LiveUseCaseWorkbenchPage from '../LiveUseCaseWorkbenchPage';

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

  it('closes on Escape and on scrim click', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');

    fireEvent.click(screen.getByLabelText('Open demo script'));
    fireEvent.click(container.querySelector('.luw-drawer__scrim'));
    expect(container.querySelector('.luw-body')).toHaveClass('luw-body--drawer-closed');
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

  it('returns focus to the edge tab after a scrim click', () => {
    const { container } = render(<LiveUseCaseWorkbenchPage />);
    fireEvent.click(container.querySelector('.luw-drawer__scrim'));
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
});
