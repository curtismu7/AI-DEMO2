import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

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
