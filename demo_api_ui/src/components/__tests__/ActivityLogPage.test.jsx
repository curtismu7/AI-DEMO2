// demo_api_ui/src/components/__tests__/ActivityLogPage.test.jsx
import { render, screen } from '@testing-library/react';
import ActivityLogPage from '../ActivityLogPage';

vi.mock('../ActivityLogPanel', () => ({
  default: function MockActivityLogPanel({ enabled }) {
    return (
      <div data-testid="activity-log-panel" data-enabled={String(!!enabled)}>
        Activity Log Panel
      </div>
    );
  },
}));

describe('ActivityLogPage', () => {
  it('renders Activity Log in a DraggableModal that fills the page', () => {
    render(<ActivityLogPage />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Application Activity & PingOne Events')).toBeInTheDocument();
    expect(screen.getByTitle('Pop out to new window')).toBeInTheDocument();
    expect(screen.getByTestId('activity-log-panel')).toHaveAttribute(
      'data-enabled',
      'true',
    );
  });

  it('offsets the modal past the sidebar instead of painting over it', () => {
    // Simulate AdminSideNav's reserved space — AppShell's .main-content
    // normally gets this via CSS (margin-left: var(--sidebar-width)), but
    // the fixed-position modal has to read it explicitly since fixed
    // positioning ignores an ancestor's margin.
    const mainContent = document.createElement('div');
    mainContent.className = 'main-content';
    mainContent.style.marginLeft = '310px';
    document.body.appendChild(mainContent);

    render(<ActivityLogPage />, { container: mainContent });

    const dialog = screen.getByRole('dialog');
    expect(parseFloat(dialog.style.left)).toBeGreaterThan(310);

    document.body.removeChild(mainContent);
  });

  it('drops a stale persisted position that would paint over the sidebar', () => {
    // DraggableModal restores {pos,size} from localStorage on mount,
    // unconditionally overriding defaultX/defaultY -- a position saved
    // before the sidebar-aware default existed (or from a drag that
    // clipped to the left edge) would otherwise cover AdminSideNav on
    // every future visit, with no in-app way to recover.
    localStorage.setItem(
      'ba-activity-log-page',
      JSON.stringify({ pos: { x: 0, y: 0 }, size: { w: 800, h: 600 } }),
    );

    const mainContent = document.createElement('div');
    mainContent.className = 'main-content';
    mainContent.style.marginLeft = '310px';
    document.body.appendChild(mainContent);

    render(<ActivityLogPage />, { container: mainContent });

    const dialog = screen.getByRole('dialog');
    expect(parseFloat(dialog.style.left)).toBeGreaterThan(310);

    document.body.removeChild(mainContent);
    localStorage.removeItem('ba-activity-log-page');
  });

  it('keeps a persisted position that does not cover the sidebar', () => {
    // A user-chosen position clear of the sidebar is a legitimate drag/
    // resize, not staleness -- it must survive the mount-time check. Small
    // enough not to be clamped by clampPosToViewport under jsdom's default
    // viewport.
    localStorage.setItem(
      'ba-activity-log-page',
      JSON.stringify({ pos: { x: 400, y: 80 }, size: { w: 300, h: 300 } }),
    );

    const mainContent = document.createElement('div');
    mainContent.className = 'main-content';
    mainContent.style.marginLeft = '310px';
    document.body.appendChild(mainContent);

    render(<ActivityLogPage />, { container: mainContent });

    const dialog = screen.getByRole('dialog');
    expect(parseFloat(dialog.style.left)).toBe(400);

    document.body.removeChild(mainContent);
    localStorage.removeItem('ba-activity-log-page');
  });
});
