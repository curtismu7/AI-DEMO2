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

  test('the main top bar\'s light/dark switch drives the page theme too', () => {
    let toggleMainBar;
    function MainBar() { toggleMainBar = useTheme().toggleDarkMode; return null; }
    render(<ThemeProvider><MemoryRouter><MainBar /><PrivilegeA2aPage user={null} /></MemoryRouter></ThemeProvider>);
    const page = screen.getByTestId('privilege-a2a-page');
    expect(page).toHaveAttribute('data-cur-theme', 'dark');

    act(() => toggleMainBar()); // global light (default) -> dark
    expect(page).toHaveAttribute('data-cur-theme', 'dark');
    act(() => toggleMainBar()); // dark -> light
    expect(page).toHaveAttribute('data-cur-theme', 'light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark' })); // the page's own button still works
    expect(page).toHaveAttribute('data-cur-theme', 'dark');
  });

  test('signed out shows a dash, not a made-up identity', () => {
    render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    expect(screen.getByTestId('a2a-identity')).toHaveTextContent('—');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });

  test('Light/Dark flips the page theme and shares the MCP client key', () => {
    render(<MemoryRouter><PrivilegeA2aPage user={null} /></MemoryRouter>);
    const page = screen.getByTestId('privilege-a2a-page');
    expect(page).toHaveAttribute('data-cur-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(page).toHaveAttribute('data-cur-theme', 'light');
    expect(localStorage.getItem('cur_priv_theme')).toBe('light');
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
