import apiClient from '../services/apiClient';

// The active vertical's names for the Privilege A2A steps (BFF: GET /api/privilege-a2a/profile).
// `null` = the vertical has no specialist, or the call failed: keep the generic names.
export async function loadPrivilegeA2aProfile() {
  try {
    const res = await apiClient.get('/api/privilege-a2a/profile');
    const profile = res?.data?.profile;
    return profile && typeof profile === 'object' ? profile : null;
  } catch {
    return null;
  }
}

/**
 * Display name for a trace actor key (`main`, `analyst`, `mcp`, `refunds`,
 * `restricted`, `langchainagent`), or undefined when the profile names none.
 * Display only: lane keys stay the generic actor names.
 */
export function profileLabel(profile, key) {
  if (!profile) return undefined;
  const { agentName, specialistName } = profile;
  if (key === 'main') return agentName || undefined;
  if (!specialistName) return undefined;
  if (key === 'analyst' || key === 'refunds') return specialistName;
  if (key === 'mcp') return `${specialistName} data tools`;
  if (key === 'restricted') return `Ungranted ${specialistName}`;
  return undefined;
}
