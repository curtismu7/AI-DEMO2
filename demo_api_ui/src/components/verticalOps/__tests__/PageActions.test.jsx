import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../services/bffAxios', () => ({ __esModule: true, default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../utils/appToast', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn(), notifyWarning: vi.fn(), notifyInfo: vi.fn() }));
import bffAxios from '../../../services/bffAxios';
import VerticalOpsConsole from '../VerticalOpsConsole';

describe('VerticalOpsConsole page actions', () => {
  it('renders the banking "Fix PingOne Scopes" tool and runs it, showing summary + steps', async () => {
    bffAxios.post.mockResolvedValueOnce({ data: { success: true, summary: 'Scopes updated', steps: ['added admin scope', 'granted to app'] } });
    render(<VerticalOpsConsole vertical="banking" user={{ role: 'user' }} />);
    const btn = screen.getByRole('button', { name: 'Fix PingOne Scopes' });
    fireEvent.click(btn);
    expect(bffAxios.post).toHaveBeenCalledWith('/api/admin/pingone/update-scopes');
    await waitFor(() => expect(screen.getByText('Scopes updated')).toBeInTheDocument());
    expect(screen.getByText('added admin scope')).toBeInTheDocument();
    expect(screen.getByText('granted to app')).toBeInTheDocument();
  });

  it('renders the shared "Fix PingOne Scopes" tool on non-banking verticals too', () => {
    render(<VerticalOpsConsole vertical="healthcare" user={{ role: 'user' }} />);
    expect(screen.getByRole('button', { name: 'Fix PingOne Scopes' })).toBeInTheDocument();
    expect(screen.getByTestId('vops-tools')).toBeInTheDocument();
  });
});
