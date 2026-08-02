// ResourceServerJourneyPage.test.jsx
// Verifies each RS route renders the correct badge, panels, and vertical card.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import bffAxios from '../../services/bffAxios';

vi.mock('../../services/bffAxios', () => ({
  __esModule: true,
  default: { get: vi.fn() },
}));

vi.mock('../../components/ResourceServerInterstitial', () => ({
  __esModule: true,
  SERVERS: {
    olb: { id: 'olb', name: 'MCP Server (OLB)', port: 8080, protocol: 'WebSocket', auth: 'JWT', audience: 'mcpserver.ping.demo', color: '#2563eb' },
    invest: { id: 'invest', name: 'MCP Resource Server', port: 8081, protocol: 'WebSocket', auth: 'JWT', audience: 'mcp-resource-server.ping.demo', color: '#047857' },
    apikey: { id: 'apikey', name: 'API Resource Server', port: 8082, protocol: 'HTTP REST', auth: 'X-API-Key', audience: '(none)', color: '#d97706' },
  },
}));

// Lazy import so mocks are in place
const { default: ResourceServerJourneyPage } = await import('../ResourceServerJourneyPage');

const inflowData = {
  accessTokenClaims: { sub: 'user-1', aud: 'mcpserver.ping.demo', scope: 'openid banking:accounts', exp: 9999999999 },
  accounts: [{ id: 'a1', accountType: 'checking', accountNumber: '****1234', balance: 5000 }],
};

const mortgageVerticalData = {
  vertical: 'mortgage',
  noun: 'mortgage account',
  mortgage: {
    loanId: 'MTG-2024-77301',
    propertyAddress: '742 Evergreen Terrace',
    propertyType: 'Single-Family',
    loanAmount: 385000,
    currentBalance: 341280.44,
    interestRate: '6.25% fixed',
    termYears: 30,
    monthlyPayment: 2370.82,
    escrowBalance: 4812.30,
    currency: 'USD',
    nextPaymentDate: '2026-09-01',
    status: 'Current',
  },
};

const workOrderVerticalData = {
  vertical: 'workOrder',
  noun: 'work order record',
  workOrder: {
    orderId: 'WO-4001',
    product: 'Bracket Assembly',
    type: 'Assembly',
    line: 'Line 3',
    quantity: 500,
    completedQty: 320,
    value: 42500,
    currency: 'USD',
    status: 'In Production',
    dueDate: '2026-07-05',
  },
};

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/rs/olb" element={<ResourceServerJourneyPage />} />
        <Route path="/rs/invest" element={<ResourceServerJourneyPage />} />
        <Route path="/rs/api" element={<ResourceServerJourneyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  bffAxios.get.mockImplementation((url) => {
    if (url === '/api/resource-server/summary-inflow') return Promise.resolve({ data: inflowData });
    if (url.startsWith('/api/resource-server/vertical-record')) {
      if (url.includes('show_mortgage')) return Promise.resolve({ data: mortgageVerticalData });
      if (url.includes('show_work_order')) return Promise.resolve({ data: workOrderVerticalData });
      return Promise.resolve({ data: { note: 'unknown' } });
    }
    return Promise.reject(new Error(`unexpected: ${url}`));
  });
});

describe('ResourceServerJourneyPage', () => {
  describe('/rs/olb route', () => {
    it('shows OLB badge and account data', async () => {
      renderAt('/rs/olb?tool=get_my_accounts');
      expect(await screen.findByText('MCP SERVER (OLB)')).toBeInTheDocument();
      expect(screen.getByText(/Token Presented/i)).toBeInTheDocument();
      expect(screen.getByText('$5,000')).toBeInTheDocument();
    });

    it('displays token claims on the left panel', async () => {
      renderAt('/rs/olb');
      expect(await screen.findByText('sub')).toBeInTheDocument();
      expect(screen.getByText('user-1')).toBeInTheDocument();
      expect(screen.getByText('mcpserver.ping.demo')).toBeInTheDocument();
    });
  });

  describe('/rs/invest route', () => {
    it('shows MCP Resource Server badge', async () => {
      renderAt('/rs/invest?tool=get_portfolio_summary');
      expect(await screen.findByText('MCP RESOURCE SERVER')).toBeInTheDocument();
      expect(screen.getByText(/get_portfolio_summary/)).toBeInTheDocument();
    });
  });

  describe('/rs/api route', () => {
    it('renders MortgageCard for show_mortgage', async () => {
      renderAt('/rs/api?tool=show_mortgage&vertical=mortgage');
      expect(await screen.findByText('API RESOURCE SERVER')).toBeInTheDocument();
      expect(screen.getByText('Credential Swap')).toBeInTheDocument();
      expect(screen.getByText('742 Evergreen Terrace')).toBeInTheDocument();
      expect(screen.getByText('6.25% fixed')).toBeInTheDocument();
      expect(screen.getByText('Current')).toBeInTheDocument();
    });

    it('renders WorkOrderCard with progress bar for show_work_order', async () => {
      renderAt('/rs/api?tool=show_work_order&vertical=workOrder');
      expect(await screen.findByText('Work Order WO-4001')).toBeInTheDocument();
      expect(screen.getByText(/Bracket Assembly/)).toBeInTheDocument();
      expect(screen.getByText(/320\/500/)).toBeInTheDocument();
      expect(screen.getByText(/In Production/)).toBeInTheDocument();
    });

    it('shows credential swap proof on the left panel', async () => {
      renderAt('/rs/api?tool=show_mortgage&vertical=mortgage');
      expect(await screen.findByText('Credential Swap')).toBeInTheDocument();
      expect(screen.getAllByText(/X-API-Key/).length).toBeGreaterThan(0);
      expect(screen.getByText(/Gateway Proof/)).toBeInTheDocument();
    });
  });

  describe('light/dark mode toggle', () => {
    it('defaults to dark and toggles to light', async () => {
      localStorage.removeItem('rsj-theme');
      renderAt('/rs/olb');
      const page = (await screen.findByText('MCP SERVER (OLB)')).closest('.rsj-page');
      expect(page.classList.contains('rsj-page--dark')).toBe(true);

      const toggle = screen.getByTitle(/Switch to light mode/i);
      fireEvent.click(toggle);
      expect(page.classList.contains('rsj-page--light')).toBe(true);
      expect(localStorage.getItem('rsj-theme')).toBe('light');
    });
  });

  describe('navigation', () => {
    it('has a Back to Agent button', async () => {
      renderAt('/rs/olb');
      expect(await screen.findByText('MCP SERVER (OLB)')).toBeInTheDocument();
      const buttons = screen.getAllByText('Back to Agent');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('has a Full Token Details link', async () => {
      renderAt('/rs/olb');
      expect(await screen.findByText('Full Token Details')).toBeInTheDocument();
    });
  });
});
