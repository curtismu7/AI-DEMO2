import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WorkloadAgentsPage from '../WorkloadAgentsPage';
import { VerticalContext } from '../../vertical/VerticalProvider';

const verticals = [
  'banking', 'healthcare', 'retail', 'abercrombie-fitch', 'government',
  'university', 'workforce', 'sporting-goods', 'manufacturing',
  'investment', 'airlines',
].map((id) => ({ id, displayName: id === 'sporting-goods' ? 'Super Sports' : id }));

const scenarios = {
  UC38: { id: 'UC38', useCaseId: 'personal-agent-concierge', title: 'Workload Agent: MFA-gated protected action', primaryTool: 'extend_rental', runPrompt: 'extend my rental $600' },
  UC44: { id: 'UC44', useCaseId: 'workload-digital-assistant-obo', title: 'Workload Agent: OBO customer-data read', primaryTool: 'list_gear', runPrompt: 'my gear' },
};
const bankingScenarios = {
  UC38: { ...scenarios.UC38, primaryTool: 'create_transfer', runPrompt: 'transfer $600 from checking to savings' },
  UC44: { ...scenarios.UC44, primaryTool: 'get_account_balance', runPrompt: 'show my balance' },
};

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn(() => Promise.resolve({})) },
}));
vi.mock('../../context/TokenChainContext', () => ({ useTokenChainOptional: () => ({ events: [] }) }));

import apiClient from '../../services/apiClient';

function renderPage(route = '/workload-agents?useCase=UC38&vertical=sporting-goods', activeId = null) {
  return render(<MemoryRouter initialEntries={[route]}><VerticalContext.Provider value={{ activeId }}><WorkloadAgentsPage /></VerticalContext.Provider></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Action complete.' }) }));
  apiClient.get.mockImplementation((url) => {
    if (url === '/api/verticals/list') return Promise.resolve({ data: verticals });
    const id = url.includes('/UC38?') ? 'UC38' : 'UC44';
    return Promise.resolve({ data: { useCase: url.includes('vertical=banking') ? bankingScenarios[id] : scenarios[id] } });
  });
});

describe('WorkloadAgentsPage', () => {
  it('uses the active vertical for a direct link without a vertical query', async () => {
    renderPage('/workload-agents?useCase=UC44', 'healthcare');
    expect((await screen.findByRole('combobox', { name: /vertical/i })).value).toBe('healthcare');
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC44?vertical=healthcare');
  });

  it('ignores an active vertical the page has no actions for', async () => {
    renderPage('/workload-agents?useCase=UC38', 'pingone-admin');
    expect((await screen.findByRole('combobox', { name: /vertical/i })).value).toBe('sporting-goods');
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC38?vertical=sporting-goods');
  });

  it('uses Super Sports when a direct link has no vertical and no active selection', async () => {
    renderPage('/workload-agents');
    expect((await screen.findByRole('combobox', { name: /vertical/i })).value).toBe('sporting-goods');
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC38?vertical=sporting-goods');
  });

  it('offers all 11 supported verticals and respects the explicit deep link', async () => {
    renderPage();
    const selector = await screen.findByRole('combobox', { name: /vertical/i });
    expect(within(selector).getAllByRole('option')).toHaveLength(11);
    expect(selector.value).toBe('sporting-goods');
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC38?vertical=sporting-goods');
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC44?vertical=sporting-goods');
  });

  it('distinguishes the MFA protected write from the OBO customer read', async () => {
    renderPage();
    expect(await screen.findByText(/MFA-gated protected action/i)).toBeTruthy();
    expect(screen.getByText(/OBO customer-data read/i)).toBeTruthy();
    expect(screen.getByText(/sub=user/)).toBeTruthy();
    expect(screen.getByText(/act=agent/)).toBeTruthy();
    expect(screen.getByText(/identity step-up before a workload agent makes a protected change/i)).toBeTruthy();
    expect(screen.getByText(/who authorized the request, which workload agent acted/i)).toBeTruthy();
  });

  it('shows catalog action and exact prompt for each scenario', async () => {
    renderPage();
    expect((await screen.findAllByText('extend_rental')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('extend my rental $600').length).toBeGreaterThan(0);
    expect(screen.getByText('list_gear')).toBeTruthy();
    expect(screen.getByText('my gear')).toBeTruthy();
  });

  it('runs the selected UC44 catalog action with its canonical slug and vertical', async () => {
    renderPage('/workload-agents?useCase=UC44&vertical=sporting-goods');
    const action = await screen.findByRole('button', { name: /Run this demo: UC44/i });
    fireEvent.click(action);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'my gear', vertical: 'sporting-goods', useCaseId: 'workload-digital-assistant-obo' }),
    })));
    expect(screen.getByText(/UC44.*Super Sports.*list_gear/)).toBeTruthy();
  });

  it('runs UC38 with its distinct protected write prompt', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Run this demo: UC38/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'extend my rental $600', vertical: 'sporting-goods', useCaseId: 'personal-agent-concierge' }),
    })));
  });

  it('updates both actions and the invoked prompt when the vertical changes', async () => {
    renderPage();
    const selector = await screen.findByRole('combobox', { name: /vertical/i });
    await screen.findByText('list_gear');
    fireEvent.change(selector, { target: { value: 'banking' } });
    expect(apiClient.post).toHaveBeenCalledWith('/api/verticals/active', { id: 'banking' });
    expect((await screen.findAllByText('create_transfer')).length).toBeGreaterThan(0);
    expect(screen.getByText('get_account_balance')).toBeTruthy();
    expect(screen.getAllByText('transfer $600 from checking to savings').length).toBeGreaterThan(0);
    expect(screen.getByText('show my balance')).toBeTruthy();
    expect(screen.queryByText('list_gear')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Run this demo: UC44/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'show my balance', vertical: 'banking', useCaseId: 'workload-digital-assistant-obo' }),
    })));
  });
});
