import apiClient from './apiClient';

/**
 * Guest-safe: the server resolves which flags `useCaseId` needs and enables
 * only those (demo_api_server/routes/demoFlags.js). No session required.
 */
export async function enableUseCaseFlags(useCaseId) {
  const { data } = await apiClient.post('/api/demo-flags/enable', { useCaseId });
  return data;
}

/**
 * Guest-safe: the server resolves which flags `useCaseId` needs and disables
 * only those. No session required.
 */
export async function disableUseCaseFlags(useCaseId) {
  const { data } = await apiClient.post('/api/demo-flags/disable', { useCaseId });
  return data;
}
