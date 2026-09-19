import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import McpDiscoveryPage from '../McpDiscoveryPage';
import { fetchMcpDiscoveryInventory, requestMcpDiscoveryScan } from '../../services/mcpDiscoveryService';

vi.mock('../McpDiscoveryPage.css', () => ({}), { virtual: true });
vi.mock('../../services/mcpDiscoveryService', () => ({
  fetchMcpDiscoveryInventory: vi.fn(),
  requestMcpDiscoveryScan: vi.fn(),
}));

const inventory = {
  scanId: 'scan-1',
  scannedAt: '2026-09-18T15:00:00.000Z',
  records: [
    { id: 'healthy', displayName: 'Banking MCP', source: 'compose-service', sources: ['compose-service'], location: 'local', transport: 'streamable-http', endpoint: 'http://127.0.0.1:8080/mcp', status: 'healthy', protocolVersion: '2026-07-28', tools: [{ name: 'get_balance' }], securityFindings: [], probe: { latencyMs: 22 } },
    { id: 'candidate', displayName: 'Local stdio candidate', source: 'host-process', sources: ['host-process'], location: 'local', transport: 'stdio', endpoint: null, status: 'candidate', protocolVersion: null, tools: [], securityFindings: [{ kind: 'hidden-instruction', tool: 'bad_tool', detail: 'hidden instruction' }], probe: { latencyMs: null } },
    { id: 'listener', displayName: 'Local listener', source: 'listener', sources: ['listener'], location: 'local', transport: 'streamable-http', endpoint: 'http://127.0.0.1:3910/mcp', status: 'offline', protocolVersion: null, tools: [], securityFindings: [], probe: { latencyMs: null } },
    { id: 'remote', displayName: 'Remote MCP', source: 'remote-url', sources: ['remote-url'], location: 'remote', transport: 'streamable-http', endpoint: 'https://example.test/mcp', status: 'candidate', protocolVersion: null, tools: [], securityFindings: [], probe: { latencyMs: null } },
  ],
};

beforeEach(() => {
  fetchMcpDiscoveryInventory.mockResolvedValue(inventory);
  requestMcpDiscoveryScan.mockResolvedValue({ scanId: 'scan-2' });
});

test('renders operational inventory and security findings without tool actions', async () => {
  render(<McpDiscoveryPage />);
  await waitFor(() => expect(screen.getByText('Banking MCP')).toBeInTheDocument());
  expect(screen.getByText('Runtime inventory')).toBeInTheDocument();
  expect(screen.getByText('healthy MCP endpoints')).toBeInTheDocument();
  expect(screen.getByText('observed but unprobed')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Runtime type' })).toBeInTheDocument();
  expect(screen.getByText('Compose service')).toBeInTheDocument();
  expect(screen.getByText('Host process')).toBeInTheDocument();
  expect(screen.getByText('MCP endpoint')).toBeInTheDocument();
  expect(screen.getByText('Process candidate')).toBeInTheDocument();
  expect(screen.getByText('HTTP listener')).toBeInTheDocument();
  expect(screen.getByText('Remote endpoint')).toBeInTheDocument();
  expect(screen.getByText('hidden instruction')).toBeInTheDocument();
  expect(screen.getByText(/These are heuristic signals/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /call|invoke|execute/i })).not.toBeInTheDocument();
});

test('requests a manual rescan and reports the new scan id', async () => {
  render(<McpDiscoveryPage />);
  await waitFor(() => expect(screen.getByText('Banking MCP')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Scan now' }));
  await waitFor(() => expect(requestMcpDiscoveryScan).toHaveBeenCalledOnce());
  expect(await screen.findByText(/scan-2/)).toBeInTheDocument();
});
