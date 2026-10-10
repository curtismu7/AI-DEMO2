// SPIFFE/SVID identity card on the Agent Registry (coverage plan row — LINK/MOCK:
// the registry gains a workload-identity card fed by the bridge page's attestation
// data). The SPIRE stack is opt-in and usually down, so the card renders the
// bridge simulation's SVID shape and says so — it never claims a live attestation.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

import apiClient from '../../services/apiClient';
import AgentRegistryPage from '../AgentRegistryPage';

const PAYLOAD = {
  generatedAt: '2026-10-10T00:00:00.000Z',
  sources: { demoRegistry: { up: true, rows: 2 } },
  rows: [
    {
      id: 'mcp-client-abc', name: 'Batch job', identityType: 'workload', source: 'demo-registry',
      credentialType: 'client_credentials', status: 'active',
      grantedScopes: ['read'], expectedScopes: [], missingScopes: [], scopeStatus: 'unverified',
      lifecycle: [],
    },
    {
      id: 'app-1', name: 'Super Banking AI Agent', identityType: 'agent', source: 'pingone',
      credentialType: 'AUTHORIZATION_CODE', status: 'active',
      grantedScopes: ['agent:invoke'], expectedScopes: [], missingScopes: [], scopeStatus: 'unverified',
      lifecycle: [],
    },
  ],
};

const selectRow = async (name) => {
  // The tree button, not the detail-pane header that appears once selected.
  const item = await screen.findByRole('button', { name });
  item.click();
};

describe('AgentRegistryPage — SPIFFE/SVID identity card', () => {
  beforeEach(() => {
    apiClient.get.mockReset();
  });

  it('shows an SVID card for a workload identity under the Identity tab', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    await selectRow('Batch job');
    screen.getByText('Identity').click();

    // The card shows the demo SVID the bridge simulation mints, labeled as simulated.
    await waitFor(() => expect(screen.getByText('spiffe://demo.local/ns/orders/sa/worker')).toBeTruthy());
    expect(screen.getByText(/Simulated —/)).toBeTruthy();
    expect(screen.getByText(/SPIFFE\/SVID bridge/)).toBeTruthy();
    expect(screen.getByText('demo.local')).toBeTruthy(); // trust domain
  });

  it('says no SVID for a non-workload identity instead of faking one', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    await selectRow('Super Banking AI Agent');
    screen.getByText('Identity').click();

    await waitFor(() => expect(screen.getByText(/No SPIFFE workload identity/)).toBeTruthy());
    expect(screen.queryByText(/spiffe:\/\//)).toBeNull();
  });

  it('links the card to the SPIFFE/SVID bridge page', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AgentRegistryPage />);

    await selectRow('Batch job');
    screen.getByText('Identity').click();

    const link = await screen.findByRole('link', { name: /spiffe.*bridge/i });
    expect(link.getAttribute('href')).toBe('/spiffe-pingone-bridge');
  });
});
