import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import EmbeddedWorkerPage from '../EmbeddedWorkerPage';

describe('EmbeddedWorkerPage', () => {
  beforeEach(() => {
    localStorage.clear();
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
    expect(screen.getByText(/Embedded in a third-party SaaS app/)).toBeInTheDocument();
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
        agentMode: 'llm',
      }),
    })));
  });

  it('sends the page\'s own Heuristics choice, remembered under its own key', async () => {
    render(<EmbeddedWorkerPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'Heuristics' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'help me update my booking' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'help me update my booking', vertical: 'airlines', useCaseId: 'saas-embedded-worker', agentMode: 'heuristics' }),
    })));
    expect(localStorage.getItem('agentMode:embedded-worker')).toBe('heuristics');
    expect(localStorage.getItem('agentMode:personal-agent')).toBeNull();
  });

  describe('Ping UI Standard', () => {
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    const primaries = (container) => [...container.querySelectorAll('button.pu-btn--primary')].map((b) => b.textContent);
    const mockApi = ({ state, create, invoke }) => {
      vi.spyOn(global, 'fetch').mockImplementation((url, opts) => {
        if (url === '/api/embedded-worker/state') return state();
        if (url === '/api/embedded-worker/agent') return create ? create(opts) : json({});
        if (url === '/api/agent/invoke') return invoke ? invoke(opts) : json({ reply: 'ok' });
        return json({});
      });
    };

    it('puts a note banner first that names the real engine, and renders one h1 and no <main>', async () => {
      mockApi({ state: () => json({ agent: null }) });
      const { container } = render(<EmbeddedWorkerPage />);
      const banner = screen.getByTestId('embedded-worker-banner');
      expect(banner).toHaveAttribute('role', 'note');
      expect(container.querySelector('.pu-page').firstElementChild).toContainElement(banner);
      expect(banner).toHaveTextContent(/simulation/i);
      expect(banner).toHaveTextContent(/llama\.cpp \(the real local model\)/);
      fireEvent.click(screen.getByRole('radio', { name: 'Heuristics' }));
      expect(banner).toHaveTextContent(/Heuristics \(deterministic routing, no model call\)/);
      expect(banner).not.toHaveTextContent(/llama\.cpp \(the real local model\)/);
      expect(container.querySelectorAll('h1')).toHaveLength(1);
      expect(container.querySelector('main')).toBeNull();
      await screen.findByText('Not created');
    });

    it('signed out: says so, never claims a worker, and the aria-disabled Create button does nothing but keeps focus', async () => {
      mockApi({ state: () => json({}, 401) });
      const { container } = render(<EmbeddedWorkerPage />);
      expect(await screen.findByText('Sign in required')).toBeInTheDocument();
      expect(screen.getByTestId('embedded-worker-status')).toHaveTextContent(/You are signed out/);
      expect(screen.queryByText('Registered')).toBeNull();
      const create = screen.getByRole('button', { name: 'Create Website Worker' });
      expect(create).toHaveAttribute('aria-disabled', 'true');
      expect(create).not.toBeDisabled();
      create.focus();
      fireEvent.click(create);
      expect(document.activeElement).toBe(create);
      expect(fetch).not.toHaveBeenCalledWith('/api/embedded-worker/agent', expect.anything());
      expect(primaries(container)).toEqual(['Create Website Worker']);
    });

    it('a failed lookup reads Unavailable, not Not created', async () => {
      mockApi({ state: () => json({}, 500) });
      render(<EmbeddedWorkerPage />);
      expect(await screen.findByText('Unavailable')).toBeInTheDocument();
      expect(screen.queryByText('Not created')).toBeNull();
    });

    it('one primary per state: Create until a worker exists, then Send; focus moves to the message box', async () => {
      mockApi({
        state: () => json({ agent: null }),
        create: () => json({ created: true, agent: { id: 'w-9', name: 'AI Agent - new' }, cimd: { mocked: true, status: 'registered' } }, 201),
      });
      const { container } = render(<EmbeddedWorkerPage />);
      await screen.findByText('Not created');
      expect(primaries(container)).toEqual(['Create Website Worker']);
      const create = screen.getByRole('button', { name: 'Create Website Worker' });
      expect(create).not.toHaveAttribute('aria-disabled');
      fireEvent.click(create);
      expect(await screen.findByText('AI Agent - new')).toBeInTheDocument();
      expect(screen.getByText('Registered')).toBeInTheDocument();
      expect(screen.getByText(/Mocked \(provenance only\), registered/)).toBeInTheDocument();
      expect(screen.getByTestId('embedded-worker-status')).toHaveTextContent('Website Worker created');
      expect(primaries(container)).toEqual(['Send']);
      expect(screen.queryByRole('button', { name: 'Create Website Worker' })).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Message the Website Worker' }));
    });

    it('a failed create keeps the button mounted and says why', async () => {
      mockApi({ state: () => json({ agent: null }), create: () => json({ message: 'PingOne refused the application' }, 502) });
      render(<EmbeddedWorkerPage />);
      await screen.findByText('Not created');
      fireEvent.click(screen.getByRole('button', { name: 'Create Website Worker' }));
      await waitFor(() => expect(screen.getByTestId('embedded-worker-status')).toHaveTextContent('PingOne refused the application'));
      expect(screen.getByRole('button', { name: 'Create Website Worker' })).not.toHaveAttribute('aria-disabled');
      expect(screen.getByText('Not created')).toBeInTheDocument();
    });

    it('chat log is a named live log mounted up front; replies, MFA and errors carry their own label', async () => {
      mockApi({
        state: () => json({ agent: { id: 'w-1', name: 'AI Agent - demo' } }),
        invoke: (opts) => {
          const { prompt } = JSON.parse(opts.body);
          if (prompt === 'mfa') return json({ reply: 'Complete multi-factor authentication.', step_up_required: true });
          if (prompt === 'boom') return json({ message: 'Gateway said no' }, 502);
          return json({ reply: 'You have 12,400 miles.' });
        },
      });
      render(<EmbeddedWorkerPage />);
      const log = screen.getByRole('log', { name: 'Conversation with the Website Worker' });
      expect(log).toHaveAttribute('aria-live', 'polite');
      expect(within(log).getByText(/No messages yet/)).toBeInTheDocument();
      const input = screen.getByRole('textbox');
      for (const prompt of ['hello', 'mfa', 'boom']) {
        fireEvent.change(input, { target: { value: prompt } });
        fireEvent.keyDown(input, { key: 'Enter' });
      }
      await waitFor(() => expect(within(log).getByText('Gateway said no')).toBeInTheDocument());
      expect(within(log).getByText('You have 12,400 miles.')).toBeInTheDocument();
      expect(within(log).getByText('Complete multi-factor authentication.').closest('.ew-crm__msg')).toHaveClass('is-notice');
      expect(within(log).getByText('Gateway said no').closest('.ew-crm__msg')).toHaveClass('is-error');
      expect(within(log).getByText('Needs MFA')).toBeInTheDocument();
      expect(within(log).getByText('Error')).toBeInTheDocument();
      // three sends in flight at once: each settled its own placeholder, none left spinning
      expect(within(log).queryByText('Working…')).toBeNull();
      expect(log.querySelectorAll('.ew-crm__msg')).toHaveLength(6);
    });

    it('an empty send says why and keeps focus in the message box, with no request', async () => {
      mockApi({ state: () => json({ agent: { id: 'w-1', name: 'AI Agent - demo' } }) });
      render(<EmbeddedWorkerPage />);
      await screen.findByText('AI Agent - demo');
      const input = screen.getByRole('textbox');
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByTestId('embedded-worker-hint')).toHaveTextContent('Type a message first');
      expect(document.activeElement).toBe(input);
      expect(fetch).not.toHaveBeenCalledWith('/api/agent/invoke', expect.anything());
    });

    it('a sample prompt fills the box without sending it', async () => {
      mockApi({ state: () => json({ agent: { id: 'w-1', name: 'AI Agent - demo' } }) });
      render(<EmbeddedWorkerPage />);
      await screen.findByText('AI Agent - demo');
      fireEvent.click(screen.getByRole('button', { name: 'What is my miles balance?' }));
      expect(screen.getByRole('textbox')).toHaveValue('What is my miles balance?');
      expect(fetch).not.toHaveBeenCalledWith('/api/agent/invoke', expect.anything());
    });

    it('keeps the simulated CRM chrome out of the accessibility tree and marks the record as sample data', async () => {
      mockApi({ state: () => json({ agent: null }) });
      const { container } = render(<EmbeddedWorkerPage />);
      expect(container.querySelector('.ew-crm__global')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('.ew-crm__tabs')).toHaveAttribute('aria-hidden', 'true');
      expect(within(screen.getByTestId('embedded-worker-record')).getByText('Sample data')).toBeInTheDocument();
      await screen.findByText('Not created');
    });
  });
});
