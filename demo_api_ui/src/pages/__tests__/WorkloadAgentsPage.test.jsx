import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WorkloadAgentsPage from '../WorkloadAgentsPage';
import { VerticalContext } from '../../vertical/VerticalProvider';

const verticals = [
  'banking', 'healthcare', 'retail', 'walbuy', 'government',
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

// The run now carries a random flowTraceId (so the BFF can stream this run's authorize decision and tool result).
const withFlowTrace = (body) => {
  const head = JSON.stringify(body).slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expect.stringMatching(new RegExp(`^${head},"flowTraceId":"[^"]+"}$`));
};


function renderPage(route = '/workload-agents?useCase=UC38&vertical=sporting-goods', activeId = null, user = null) {
  return render(<MemoryRouter initialEntries={[route]}><VerticalContext.Provider value={{ activeId }}><WorkloadAgentsPage user={user} /></VerticalContext.Provider></MemoryRouter>);
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

  it('names the signed-in account on the selected run, since only that account\'s agent is used', async () => {
    renderPage(undefined, null, { username: 'demoAdmin' });
    expect(await screen.findByText(/signed in as demoAdmin/)).toBeTruthy();
  });

  it('says so when nobody is signed in', async () => {
    renderPage();
    expect(await screen.findByText(/not signed in/)).toBeTruthy();
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
      body: withFlowTrace({ prompt: 'my gear', vertical: 'sporting-goods', useCaseId: 'workload-digital-assistant-obo', agentMode: 'heuristics' }),
    })));
    expect(screen.getByText(/UC44.*Super Sports.*list_gear/)).toBeTruthy();
  });

  it('runs UC38 with its distinct protected write prompt', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Run this demo: UC38/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: withFlowTrace({ prompt: 'extend my rental $600', vertical: 'sporting-goods', useCaseId: 'personal-agent-concierge', agentMode: 'heuristics' }),
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
      body: withFlowTrace({ prompt: 'show my balance', vertical: 'banking', useCaseId: 'workload-digital-assistant-obo', agentMode: 'heuristics' }),
    })));
  });

  describe('Ping UI standard', () => {
    const primaries = () => [...document.querySelectorAll('.pu-btn--primary')].map((b) => b.textContent);

    it('puts the banner first inside the page, as a note', async () => {
      renderPage();
      await screen.findByText('list_gear');
      const page = document.querySelector('.pu-page.wa-page');
      expect(page).toBeTruthy();
      const banner = within(page).getByTestId('wa-banner');
      expect(banner.getAttribute('role')).toBe('note');
      expect(page.querySelector('.pu-banner-wrap')).toBe(page.firstElementChild);
      expect(document.querySelectorAll('main').length).toBe(0);
      expect(document.querySelectorAll('h1').length).toBe(1);
    });

    it('derives the banner state from the session and the catalog, not fixed text', async () => {
      const { unmount } = renderPage();
      await screen.findByText('list_gear');
      expect(screen.getByTestId('wa-banner-state').textContent).toMatch(/Nobody is signed in/);
      expect(screen.getByTestId('wa-banner-state').textContent).not.toMatch(/with your session/);
      unmount();
      renderPage(undefined, null, { username: 'demoAdmin' });
      await screen.findByText('list_gear');
      expect(screen.getByTestId('wa-banner-state').getAttribute('role')).toBe('status');
      expect(screen.getByTestId('wa-banner-state').textContent).toMatch(/with your session/);
    });

    it('has exactly one primary button once loaded, and the card Run buttons are secondaries', async () => {
      renderPage();
      await screen.findByText('list_gear');
      expect(primaries()).toEqual(['Run rental extension']);
      expect(screen.getByRole('button', { name: /Run this demo: UC38/ }).className).not.toMatch(/primary/);
      expect(screen.getByRole('button', { name: /Run this demo: UC44/ }).className).not.toMatch(/primary/);
    });

    it('keeps the Run buttons inactive (aria-disabled, with a reason) until the catalog action loads', async () => {
      renderPage();
      const run = screen.getByRole('button', { name: /Run this demo: UC38/ });
      expect(run.getAttribute('aria-disabled')).toBe('true');
      expect(run.hasAttribute('disabled')).toBe(false);
      expect(document.getElementById(run.getAttribute('aria-describedby')).textContent).toMatch(/Waiting for the catalog action/);
      expect(primaries()).toEqual([]);
      fireEvent.click(run);
      expect(fetch).not.toHaveBeenCalled();
      await waitFor(() => expect(run.getAttribute('aria-disabled')).toBeNull());
    });

    it('shows a failed catalog load as Retry (the one primary), and Retry reloads and gives focus to Run', async () => {
      let fail = true;
      apiClient.get.mockImplementation((url) => {
        if (url === '/api/verticals/list') return Promise.resolve({ data: verticals });
        if (fail) return Promise.reject(new Error('down'));
        const id = url.includes('/UC38?') ? 'UC38' : 'UC44';
        return Promise.resolve({ data: { useCase: scenarios[id] } });
      });
      renderPage();
      const retry = await screen.findByRole('button', { name: /Retry loading actions/ });
      expect(screen.getByTestId('wa-error').getAttribute('role')).toBe('alert');
      expect(screen.getByTestId('wa-error').textContent).toMatch(/Failed.*Actions could not be loaded/);
      expect(screen.getByTestId('wa-banner-state').textContent).toMatch(/did not load/);
      expect(primaries()).toEqual(['Retry loading actions']);
      const run = screen.getByRole('button', { name: /Run this demo: UC38/ });
      expect(run.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getAllByText('Unavailable').length).toBe(4);
      fail = false;
      retry.focus();
      fireEvent.click(retry);
      await screen.findByText('list_gear');
      expect(screen.queryByRole('button', { name: /Retry loading actions/ })).toBeNull();
      expect(screen.getByTestId('wa-error').textContent).toBe('');
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Run this demo: UC38/ })));
      expect(primaries()).toEqual(['Run rental extension']);
    });

    it('keeps Retry a secondary when only the vertical list failed (the studio owns the primary)', async () => {
      apiClient.get.mockImplementation((url) => {
        if (url === '/api/verticals/list') return Promise.reject(new Error('down'));
        const id = url.includes('/UC38?') ? 'UC38' : 'UC44';
        return Promise.resolve({ data: { useCase: scenarios[id] } });
      });
      renderPage();
      expect(await screen.findByText(/Vertical choices could not be loaded/)).toBeTruthy();
      await screen.findByText('list_gear');
      expect(primaries()).toEqual(['Run rental extension']);
      expect(screen.getByRole('button', { name: /Retry loading actions/ }).className).not.toMatch(/primary/);
    });

    it('marks the selected scenario with a word, not only an edge', async () => {
      renderPage('/workload-agents?useCase=UC44&vertical=sporting-goods');
      await screen.findAllByText('list_gear');
      expect(within(screen.getByTestId('wa-choice-UC44')).getByText('Selected')).toBeTruthy();
      expect(within(screen.getByTestId('wa-choice-UC38')).queryByText('Selected')).toBeNull();
    });
  });
});

