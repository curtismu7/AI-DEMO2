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
});
