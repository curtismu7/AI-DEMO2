import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmbeddedWorkerPage from '../EmbeddedWorkerPage';

describe('EmbeddedWorkerPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(global, 'fetch').mockImplementation((url) => {
      if (url === '/api/embedded-worker/state') {
        return Promise.resolve({ ok: true, json: async () => ({ agent: { id: 'worker-1', name: 'AI Agent - demo' } }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ reply: 'Website worker completed the request.' }) });
    });
  });

  it('renders as an embedded website worker with its current NHI identity', async () => {
    render(<EmbeddedWorkerPage />);

    expect(screen.getByRole('heading', { name: 'Website Worker' })).toBeInTheDocument();
    expect(screen.getByText(/Embedded in the customer website/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('AI Agent - demo')).toBeInTheDocument());
  });

  it('runs through the real agent invoke route with the embedded-worker use case', async () => {
    render(<EmbeddedWorkerPage />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'help me update my booking' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({
        prompt: 'help me update my booking',
        vertical: 'airlines',
        useCaseId: 'saas-embedded-worker',
      }),
    })));
  });
});
