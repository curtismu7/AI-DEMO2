import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

import apiClient from '../../services/apiClient';
import AgentRegistryPage from '../AgentRegistryPage';

const PAYLOAD = {
  generatedAt: '2026-08-27T00:00:00.000Z',
  sources: { pingone: { up: true, rows: 1 }, demoRegistry: { up: true, rows: 1 } },
  rows: [
    {
      id: 'app-1', name: 'Super Banking AI Agent', identityType: 'agent', source: 'pingone',
      credentialType: 'AUTHORIZATION_CODE', status: 'active',
      grantedScopes: ['agent:invoke'], expectedScopes: ['agent:invoke', 'admin:read'],
      missingScopes: ['admin:read'], scopeStatus: 'drift', lifecycle: [],
    },
    {
      id: 'mcp-client-abc', name: 'Batch job', identityType: 'workload', source: 'demo-registry',
      credentialType: 'client_credentials', status: 'active',
      grantedScopes: ['read'], expectedScopes: [], missingScopes: [], scopeStatus: 'unverified',
      lifecycle: [],
    },
  ],
};

describe('AgentRegistryPage', () => {
  beforeEach(() => {
    apiClient.get.mockReset();
  });

  it('groups identities by type, so workload identities are visible as such', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    // The NHI half of the Workload IDP box is a filter over this registry, not
    // a separate inventory — so the grouping has to actually distinguish them.
    await waitFor(() => expect(screen.getByText(/Agents \(1\)/)).toBeTruthy());
    expect(screen.getByText(/Workload identities \(1\)/)).toBeTruthy();
  });

  it('reports how many identities have scope drift', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    await waitFor(() => expect(screen.getByText(/1 with scope drift/)).toBeTruthy());
  });

  it('distinguishes unverified from clean', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    // 1 row drifts; the other was never compared, so it must NOT be counted
    // as clean and must NOT be counted as drift.
    await waitFor(() => expect(screen.getByText(/1 with scope drift/)).toBeInTheDocument());
    expect(screen.getByText(/1 unverified/)).toBeInTheDocument();
  });

  // The reason the API degrades per source at all: a dead PingOne must not read
  // as "there are no PingOne agents". Hiding the failure would be worse than
  // showing nothing, because it looks like a complete answer.
  it('names a source that is down instead of silently showing fewer rows', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        ...PAYLOAD,
        sources: {
          pingone: { up: false, rows: 0, error: 'PingOne unreachable' },
          demoRegistry: { up: true, rows: 1 },
        },
        rows: [PAYLOAD.rows[1]],
      },
    });
    render(<AgentRegistryPage />);

    await waitFor(() => expect(screen.getByText(/source unavailable/i)).toBeTruthy());
    expect(screen.getByText(/PingOne unreachable/)).toBeTruthy();
    // ...and the surviving identity is still listed.
    expect(screen.getByText('Batch job')).toBeTruthy();
  });

  it('surfaces a registry-level failure rather than rendering an empty list as success', async () => {
    apiClient.get.mockRejectedValue({ response: { data: { error: 'registry_unavailable' } } });
    render(<AgentRegistryPage />);

    await waitFor(() => expect(screen.getByText(/registry unavailable/i)).toBeTruthy());
  });
});
