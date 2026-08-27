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
    await waitFor(() => expect(screen.getByTestId('kpi-attention-value')).toHaveTextContent('2'));
    // declared structural facts are counted separately — nothing the reader
    // can action today — so this must be findings.length (2), never
    // findings.length + declared.length (3).
    expect(screen.getByTestId('kpi-attention-value')).not.toHaveTextContent('3');
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

  it('does not claim a scope comparison that never happened', async () => {
    apiClient.get.mockResolvedValue({ data: {
      ...PAYLOAD,
      zones: { ...PAYLOAD.zones, registry: { ...PAYLOAD.zones.registry, total: 33, drift: 0, unverified: 33 } },
    } });
    render(<ControlPlanePage />);

    // Live data: every identity is unverified, so asserting a match is false.
    await waitFor(() => expect(screen.getByText(/nothing verified/i)).toBeInTheDocument());
    expect(screen.queryByText(/granted matches scope-topology/i)).not.toBeInTheDocument();
  });

  // Finding 1 — the catalog is a static inventory, never probed. The caption
  // must not claim otherwise.
  it('does not claim MCP servers were probed live', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText(/MCP servers registered/)).toBeInTheDocument());
    expect(screen.queryByText(/probed live/i)).not.toBeInTheDocument();
  });

  // Finding 2 — a down registry source must not render as a healthy zero.
  it('does not render a confident zero when the registry source is down', async () => {
    // Mirrors what buildOverview actually ships when registry fails: sources
    // names the outage AND the zone falls back to its all-zero default.
    apiClient.get.mockResolvedValue({
      data: {
        ...PAYLOAD,
        sources: { ...PAYLOAD.sources, registry: { state: 'down', error: 'PingOne unreachable' } },
        zones: { ...PAYLOAD.zones, registry: { total: 0, bySource: {}, byType: {}, revoked: 0, drift: 0, unverified: 0, links: [] } },
      },
    });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getAllByText(/could not ask/i).length).toBeGreaterThan(0));
    expect(screen.getByTestId('kpi-identities')).not.toHaveTextContent('0');
    expect(screen.getByTestId('kpi-identities')).toHaveTextContent(/could not ask/i);
  });

  // Finding 4 — findings must render evidence and a domain-routed action, not
  // dead-end at title + detail.
  it('renders finding evidence and a domain action', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /Triage/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Triage/ }));

    const evidence = await screen.findAllByTestId('finding-evidence');
    expect(evidence[0]).toHaveTextContent(/agentId: default-agent/);
    expect(evidence[0]).toHaveTextContent(/count: 4/);
    // governance domain routes to the kill-switch roster
    expect(screen.getByRole('link', { name: /Kill-switch roster/ })).toHaveAttribute('href', '/ai-control-plane');
    // registry domain routes to the registry
    expect(screen.getByRole('link', { name: /Open registry/ })).toHaveAttribute('href', '/agent-registry');
  });

  // Finding 6 — the Identities KPI note must describe identity sources, not
  // every live subsystem (catalog/lifecycle included).
  it('describes the Identities KPI note as identity sources', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    // PAYLOAD.zones.registry.bySource has 3 keys; PAYLOAD.sources has 3 live-ish
    // entries too, so a wrong implementation could coincidentally read '3' —
    // assert the label names identity sources, not merely the number.
    await waitFor(() => expect(screen.getByTestId('kpi-identities')).toHaveTextContent(/identity source/i));
  });

  // Finding 8 — a failed Refresh on an already-loaded page must surface a
  // banner, not silently keep stale numbers under "cannot go stale" copy.
  it('surfaces a non-fatal refresh failure without dropping the loaded data', async () => {
    apiClient.get.mockResolvedValueOnce({ data: PAYLOAD });
    render(<ControlPlanePage />);
    await waitFor(() => expect(screen.getByTestId('kpi-identities')).toHaveTextContent('33'));

    apiClient.get.mockRejectedValueOnce({ response: { data: { error: 'network_error' } } });
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));

    await waitFor(() => expect(screen.getByTestId('refresh-error-banner')).toBeInTheDocument());
    expect(screen.getByTestId('refresh-error-banner')).toHaveTextContent(/network_error/);
    // stale data is still on screen, not blanked
    expect(screen.getByTestId('kpi-identities')).toHaveTextContent('33');
  });

  // Finding 8 — generatedAt is in the payload and must be checkable on screen.
  it('renders generatedAt in the topbar', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByTestId('generated-at')).not.toHaveTextContent(''));
  });

  // Finding 8 — the enforcement pill must be driven by state, not hardcoded,
  // so a Phase 2 card flipping to `live` reads correctly.
  it('drives the enforcement pill from state instead of hardcoding "not wired"', async () => {
    apiClient.get.mockResolvedValue({
      data: { ...PAYLOAD, enforcement: [
        { id: 'p1az', name: 'Fine-Grained Authorization', state: 'live',
          willShow: 'P1AZ decisions per agent', today: '/pingone-authorize' },
      ] },
    });
    render(<ControlPlanePage />);

    await waitFor(() => expect(screen.getByText('Fine-Grained Authorization')).toBeInTheDocument());
    expect(screen.getByText('live')).toBeInTheDocument();
    expect(screen.queryByText(/not wired/i)).not.toBeInTheDocument();
  });
});
