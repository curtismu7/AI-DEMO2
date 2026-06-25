import apiClient from './apiClient';

// AI Control Plane API. Any authenticated user; demo stops operate on the
// caller's own session-scoped roster.
const BASE = '/api/control-plane';

export const getAgents = () => apiClient.get(`${BASE}/agents`).then((r) => r.data);
export const stopAgent = (id, reason = 'manual_safety') =>
  apiClient.post(`${BASE}/agents/${id}/stop`, { reason }).then((r) => r.data);
export const stopAll = (reason = 'manual_safety') =>
  apiClient.post(`${BASE}/stop-all`, { reason }).then((r) => r.data);
export const resetRoster = () => apiClient.post(`${BASE}/reset`, {}).then((r) => r.data);
