import apiClient from './apiClient';

export const fetchMcpDiscoveryInventory = () =>
  apiClient.get('/api/admin/mcp-discovery/inventory').then((response) => response.data);

export const requestMcpDiscoveryScan = () =>
  apiClient.post('/api/admin/mcp-discovery/scan').then((response) => response.data);
