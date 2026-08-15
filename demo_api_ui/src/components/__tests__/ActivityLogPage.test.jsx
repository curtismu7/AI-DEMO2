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
    expect(screen.getByText('Activity Log')).toBeInTheDocument();
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
});
