import { beforeEach, describe, expect, test, vi } from 'vitest';
import apiClient from '../apiClient';
import { fetchMcpDiscoveryInventory, requestMcpDiscoveryScan } from '../mcpDiscoveryService';

vi.mock('../apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe('mcpDiscoveryService', () => {
  beforeEach(() => vi.clearAllMocks());

  test('fetches the BFF inventory endpoint', async () => {
    apiClient.get.mockResolvedValue({ data: { records: [] } });
    await expect(fetchMcpDiscoveryInventory()).resolves.toEqual({ records: [] });
    expect(apiClient.get).toHaveBeenCalledWith('/api/admin/mcp-discovery/inventory');
  });

  test('requests a scan without sending credentials or tool fields', async () => {
    apiClient.post.mockResolvedValue({ data: { scanId: 'scan-1' } });
    await expect(requestMcpDiscoveryScan()).resolves.toEqual({ scanId: 'scan-1' });
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/mcp-discovery/scan');
  });
});
