// ResourceServerPage.dualView.test.jsx
// Login RS / In-flow RS tabs + dual summary fetch.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import bffAxios from '../../services/bffAxios';
import ResourceServerPage from '../ResourceServerPage';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

vi.mock('../ResourceServerTester', () => ({
  __esModule: true,
  default: () => <div data-testid="rs-tester">tester</div>,
  INFLOW_PROBE_TARGETS: ['/api/resource-server/identity'],
  INFLOW_SOURCES: [{ id: 'mcp', label: 'MCP' }],
}));

const loginSummary = {
  accounts: [{ id: 'a1', accountType: 'checking', name: 'Checking', balance: 100, currency: 'USD', accountNumber: '****1234' }],
  transactions: [],
  accessTokenClaims: { sub: 'user-1', aud: 'enduser.ping.demo', exp: Math.floor(Date.now() / 1000) + 3600 },
  idTokenClaims: { sub: 'user-1', name: 'Demo User' },
  tokenMetadata: { audience: 'enduser.ping.demo', scopes: ['openid', 'read', 'banking:accounts'] },
  resourceServerInfo: {
    name: 'Banking API Resource Server (Login)',
    targetAudience: 'enduser.ping.demo',
    view: 'login',
  },
};

const inflowSummary = {
  hasMcpToken: false,
  accessTokenClaims: null,
  idTokenClaims: null,
  tokenMetadata: null,
  resourceServerInfo: {
    name: 'In-flow Resource Server (Gateway Path B)',
    targetAudience: 'mcpgateway.ping.demo',
    probeHint: '/api/resource-server/identity',
    view: 'inflow',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/resource-server/summary') return Promise.resolve({ data: loginSummary });
    if (url === '/api/resource-server/summary-inflow') return Promise.resolve({ data: inflowSummary });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
});

describe('ResourceServerPage dual view', () => {
  it('loads both summaries and shows Login RS by default', async () => {
    render(<MemoryRouter><ResourceServerPage /></MemoryRouter>);
    expect(await screen.findByRole('tab', { name: /Login RS/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /In-flow RS/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/LOGIN OAUTH PATH/i)).toBeInTheDocument();
    expect(screen.getByText(/Login resource server/i)).toBeInTheDocument();
    expect(bffAxios.get).toHaveBeenCalledWith('/api/resource-server/summary');
    expect(bffAxios.get).toHaveBeenCalledWith('/api/resource-server/summary-inflow');
  });

  it('switches to In-flow RS tab and shows gateway teaching copy', async () => {
    render(<MemoryRouter><ResourceServerPage /></MemoryRouter>);
    await screen.findByRole('tab', { name: /Login RS/i });
    fireEvent.click(screen.getByRole('tab', { name: /In-flow RS/i }));
    expect(screen.getByRole('tab', { name: /In-flow RS/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/IN-FLOW GATEWAY PATH/i)).toBeInTheDocument();
    expect(screen.getByText(/No TX token yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No cached TX token yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/mcpgateway\.ping\.demo/).length).toBeGreaterThan(0);
  });

  it('highlights only banking: scopes in the login scope badges', async () => {
    render(<MemoryRouter><ResourceServerPage /></MemoryRouter>);
    await screen.findByText('banking:accounts');
    const banking = screen.getByText('banking:accounts');
    const openid = screen.getByText('openid');
    expect(banking.className).toMatch(/rsp-scope-banking/);
    expect(openid.className).not.toMatch(/rsp-scope-banking/);
  });

  it('shows auth gate when summary returns 401', async () => {
    bffAxios.get.mockRejectedValue({ response: { status: 401 } });
    render(<MemoryRouter><ResourceServerPage /></MemoryRouter>);
    expect(await screen.findByText(/Sign in required/i)).toBeInTheDocument();
    // Was a bare <a href="/api/auth/oauth/user/login"> — no return_to, so
    // signing in dropped the user somewhere else. SignInPrompt carries the path.
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeInTheDocument();
  });
});
