import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PrivilegeA2aPage from '../PrivilegeA2aPage';
import { PrivilegeMcpClientPageRoute } from '../../routes/PublicRoutes';
import apiClient from '../../services/apiClient';
import { ThemeProvider, useTheme } from '../../context/ThemeContext';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: 'healthcare' }) }));
vi.mock('../../services/gatewayEvents', () => ({
  GATEWAY_RECORD_SIGN_IN_PATH: '/llm-gateway',
  loadGatewayRecord: vi.fn().mockResolvedValue({ state: 'ready', guardrail: [], modelCalls: [] }),
}));

const profile = { vertical: 'Healthcare', agentName: 'Care Concierge', specialistName: 'Claims Analyst' };

beforeEach(() => {
  localStorage.removeItem('cur_priv_theme');
  apiClient.get.mockReset().mockResolvedValue({ data: { profile } });
});
afterEach(() => vi.restoreAllMocks());

describe('PrivilegeA2aPage', () => {
  test('shows who is asking and which agents answer, above the A2A workspace', async () => {
    render(<MemoryRouter><PrivilegeA2aPage user={{ email: 'carol@example.com' }} /></MemoryRouter>);
    expect(screen.getByTestId('a2a-identity')).toHaveTextContent('carol@example.com');
    await waitFor(() => expect(screen.getByTestId('a2a-main-agent')).toHaveTextContent('Care Concierge'));
    expect(screen.getByTestId('a2a-worker-agent')).toHaveTextContent('Claims Analyst');
    expect(screen.getByTestId('a2a-vertical')).toHaveTextContent('Healthcare');
    expect(screen.getByRole('heading', { name: 'A2A access review' })).toBeInTheDocument();
  });

  test('has no page-local light/dark switch: it follows the app theme', () => {
    render(<ThemeProvider><MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter></ThemeProvider>);
    const page = screen.getByTestId('privilege-a2a-page');
    expect(page).not.toHaveAttribute('data-cur-theme');
    expect(screen.queryByRole('button', { name: 'Dark' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Light' })).toBeNull();
  });

  test('signed out shows a dash, not a made-up identity', () => {
    render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    expect(screen.getByTestId('a2a-identity')).toHaveTextContent('—');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });
});

describe('Ping UI standard', () => {
  test('the first thing on the page is the honest mode banner, a role=note', () => {
    render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    const page = screen.getByTestId('privilege-a2a-page');
    const banner = screen.getByTestId('a2a-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(page.firstElementChild.contains(banner)).toBe(true);
    expect(banner).toHaveTextContent(/sample access data/i);
    expect(banner).toHaveTextContent(/real/i);
  });

  test('exactly one primary button, Send question, before any run; every other control is secondary', () => {
    const { container } = render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    const primaries = container.querySelectorAll('.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Send question');
  });

  test('who is asking is a key-value list with a status chip that carries a word', () => {
    const { container } = render(<MemoryRouter><PrivilegeA2aPage user={{ email: 'carol@example.com' }} /></MemoryRouter>);
    expect(container.querySelector('dl.pu-kv')).not.toBeNull();
    const chip = container.querySelector('.pu-chip');
    expect(chip).toHaveTextContent('Signed in');
  });
});

describe('legacy A2A link', () => {
  test('/privilege-mcp-client?tab=a2a lands on /privilege-a2a', async () => {
    render(
      <MemoryRouter initialEntries={['/privilege-mcp-client?view=demo&tab=a2a']}>
        <Routes>
          <Route path="/privilege-mcp-client" element={<PrivilegeMcpClientPageRoute user={null} logout={() => {}} />} />
          <Route path="/privilege-a2a" element={<div>a2a page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('a2a page')).toBeInTheDocument();
  });
});

describe('Diagram link', () => {
  test('opens the A2A diagram in a new tab', () => {
    render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Diagram' });
    expect(link).toHaveAttribute('href', '/use-case-diagrams/UC46');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});

describe('global agent button', () => {
  test('is hidden while the A2A page is open and restored when it closes', () => {
    const { unmount } = render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    expect(document.body.classList.contains('privilege-a2a-route')).toBe(true);
    unmount();
    expect(document.body.classList.contains('privilege-a2a-route')).toBe(false);
  });
});
