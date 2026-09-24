import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

// Mock TokenChainContext
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ events: [] }),
}));
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';
import apiClient from '../../services/apiClient';

const renderStudio = () => render(
  <MemoryRouter>
    <PersonalAgentStudioPage />
  </MemoryRouter>,
);

describe('PersonalAgentStudioPage', () => {
  it('renders page title', () => {
    renderStudio();
    expect(screen.getByText('Digital Assistant')).toBeTruthy();
  });

  it('renders all skin tabs', () => {
    renderStudio();
    expect(screen.getByText('Privilege')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('Terminal')).toBeTruthy();
    expect(screen.getByText('ChatGPT')).toBeTruthy();
    expect(screen.getByText('Gemini')).toBeTruthy();
  });

  it('shows Split and Pop Out buttons', () => {
    renderStudio();
    expect(screen.getByText(/Split/i)).toBeTruthy();
    expect(screen.getByText(/🪟 Pop Out/i)).toBeTruthy();
  });

  it('starts in full-agent mode — security rail hidden', () => {
    renderStudio();
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('shows security rail after clicking Split', () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
  });

  it('hides security rail when Split clicked again', () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('switches active skin tab', () => {
    renderStudio();
    fireEvent.click(screen.getByText('Claude'));
    // AgentClientSkin renders Claude title
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
  });

  it('shows popped-out placeholder and security rail after Pop Out', () => {
    // Mock window.open
    vi.stubGlobal('open', vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })));
    renderStudio();
    fireEvent.click(screen.getByText(/🪟 Pop Out/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    expect(screen.getByText(/active in external window/i)).toBeTruthy();
  });

  it('launches only the supplied catalog action for a workload run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Read complete.' }) }));
    render(<MemoryRouter><PersonalAgentStudioPage scenario={{ id: 'UC44', useCaseId: 'workload-digital-assistant-obo', primaryTool: 'list_gear', runPrompt: 'my gear' }} vertical="sporting-goods" runNonce={1} /></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'my gear', vertical: 'sporting-goods', useCaseId: 'workload-digital-assistant-obo' }),
    })));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(await screen.findByText('Read complete.')).toBeTruthy();
  });

  it('loads a direct workload query with scenario-specific opening context', async () => {
    apiClient.get.mockResolvedValue({ data: { useCase: {
      id: 'UC38', title: 'Workload Agent: MFA-gated protected action', useCaseId: 'personal-agent-concierge',
      primaryTool: 'extend_rental', runPrompt: 'extend my rental $600',
    } } });
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC38&vertical=sporting-goods']}><PersonalAgentStudioPage /></MemoryRouter>);
    expect(await screen.findByText(/Customer MFA is checked before this protected write/i)).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC38?vertical=sporting-goods');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps legacy freeform prompts on the generic Airlines agent route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Miles checked.' }) }));
    renderStudio();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'check my miles' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'check my miles', vertical: 'airlines' }),
    })));
    expect(await screen.findByText('Miles checked.')).toBeTruthy();
  });

  it('hides a stale catalog action while a changed query is loading', async () => {
    let resolveSecond;
    apiClient.get.mockImplementation((url) => url.includes('UC38')
      ? Promise.resolve({ data: { useCase: { id: 'UC38', title: 'Protected action', useCaseId: 'personal-agent-concierge', primaryTool: 'extend_rental', runPrompt: 'extend my rental $600' } } })
      : new Promise((resolve) => { resolveSecond = resolve; }));
    function ChangeQuery() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/personal-agent?useCase=UC44&vertical=banking')}>Change query</button>;
    }
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC38&vertical=sporting-goods']}><ChangeQuery /><PersonalAgentStudioPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Run UC38 action' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change query' }));
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC44?vertical=banking');
    expect(screen.queryByRole('button', { name: 'Run UC38 action' })).toBeNull();
    expect(screen.queryByText('extend my rental $600')).toBeNull();
    resolveSecond({ data: { useCase: { id: 'UC44', title: 'Customer read', useCaseId: 'workload-digital-assistant-obo', primaryTool: 'get_account_balance', runPrompt: 'show my balance' } } });
    expect(await screen.findByRole('button', { name: 'Run UC44 action' })).toBeTruthy();
    expect(screen.getByText(/get_account_balance/)).toBeTruthy();
  });

  it('shows a failed direct-query catalog load and retries the selected action', async () => {
    apiClient.get.mockReset();
    apiClient.get.mockRejectedValueOnce(new Error('Catalog unavailable')).mockResolvedValueOnce({ data: { useCase: {
      id: 'UC44', title: 'Customer read', useCaseId: 'workload-digital-assistant-obo',
      primaryTool: 'get_account_balance', runPrompt: 'show my balance',
    } } });
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC44&vertical=banking']}><PersonalAgentStudioPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The catalog action could not be loaded.');
    expect(screen.queryByText(/Loading UC44 action/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry loading UC44/i }));
    expect(await screen.findByRole('button', { name: 'Run UC44 action' })).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});
