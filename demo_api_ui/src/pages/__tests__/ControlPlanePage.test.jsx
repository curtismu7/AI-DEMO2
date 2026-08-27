import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));

import apiClient from '../../services/apiClient';
import ControlPlanePage from '../ControlPlanePage';

const PAYLOAD = {
  generatedAt: '2026-08-27T12:00:00.000Z',
  sources: { registry: { state: 'live' }, discovery: { state: 'structural' }, p1az: { state: 'not-wired' } },
  zones: {
    catalog: { services: 22, mcpServers: 5, items: [{ key: 'mcp-server', name: 'MCP Server (OLB)', lang: 'Node' }], links: [] },
    registry: { total: 33, bySource: { pingone: 13, a2a: 12, runtime: 8 }, byType: { agent: 28, external: 5 },
                revoked: 2, drift: 0, unverified: 12, links: [{ label: 'Open registry', href: '/agent-registry' }] },
    discovery: { surfaces: ['Browsers', 'Endpoints', 'Workloads'], wired: 0 },
    governance: { totalEvents: 7, byEventType: { leaver: 6, mover: 1 }, recent: [], links: [] },
    observability: { backends: [{ name: 'Grafana', detail: 'dashboards' }], links: [] },
  },
  enforcement: [
    { id: 'p1az', name: 'Fine-Grained Authorization', state: 'not-wired',
      willShow: 'P1AZ decisions per agent', today: '/pingone-authorize' },
  ],
  findings: [
    { id: 'repeat-revocation:default-agent', rule: 'repeat-revocation', severity: 'critical',
      domain: 'governance', title: 'default-agent was revoked 4 times in the last 30 days',
      detail: 'Check whether it is currently active.', evidence: { agentId: 'default-agent', count: 4 } },
    { id: 'unverified-scopes', rule: 'unverified-scopes', severity: 'advisory', domain: 'registry',
      title: '12 identities have no scope expectation to check against', detail: '…', evidence: { count: 12 } },
  ],
  declared: [
    { id: 'discovery-has-no-source', severity: 'structural', domain: 'discovery',
      title: 'Discovery has no source', detail: '…', evidence: {} },
  ],
};

beforeEach(() => { vi.clearAllMocks(); });

describe('ControlPlanePage', () => {
  it('renders every zone from the payload, not from constants', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByTestId('kpi-identities')).toHaveTextContent('33'));
    expect(screen.getByText(/22 services/)).toBeInTheDocument();
    expect(screen.getByText(/Agent Discovery/)).toBeInTheDocument();
  });

  it('counts needs-attention from findings only, excluding declared facts', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    // 2 findings, 1 declared. Structural facts are counted separately because
    // nothing the reader does today can action them.
    await waitFor(() => expect(screen.getByTestId('kpi-attention')).toHaveTextContent('2'));
  });

  it('switches to triage and lists findings worst-first', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Triage/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Triage/ }));

    const items = await screen.findAllByTestId('finding-title');
    expect(items[0]).toHaveTextContent(/revoked 4 times/);
  });

  it('the needs-attention KPI is itself the way into triage', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByTestId('kpi-attention')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('kpi-attention'));

    expect(await screen.findAllByTestId('finding-title')).not.toHaveLength(0);
  });

  it('renders enforcement stubs with no numbers', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText('Fine-Grained Authorization')).toBeInTheDocument());
    expect(screen.getByText(/not wired/i)).toBeInTheDocument();
    expect(screen.getByText(/P1AZ decisions per agent/)).toBeInTheDocument();
  });

  it('names a dead source instead of blanking the page', async () => {
    apiClient.get.mockResolvedValue({
      data: { ...PAYLOAD, sources: { ...PAYLOAD.sources, registry: { state: 'down', error: 'PingOne unreachable' } } },
    });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText(/PingOne unreachable/)).toBeInTheDocument());
    // …and the rest of the board is still there.
    expect(screen.getByText(/22 services/)).toBeInTheDocument();
  });
});
