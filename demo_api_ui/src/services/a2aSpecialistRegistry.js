'use strict';

const REGISTRY_URL = '/a2a/specialists/registry';

/** Normalize the public server directory without exposing implementation IDs as labels. */
export function normalizeA2aSpecialists(payload) {
  const entries = Array.isArray(payload?.specialists) ? payload.specialists : [];
  return entries
    .filter((entry) => entry && entry.vertical && entry.specialistName)
    .map((entry) => ({
      vertical: entry.vertical,
      canonicalVertical: entry.canonicalVertical || entry.vertical,
      appKey: entry.appKey || null,
      appName: entry.appName || null,
      specialistName: entry.specialistName,
      tools: Array.isArray(entry.tools) ? entry.tools : [],
      subtaskHint: entry.subtaskHint || null,
    }));
}

export async function fetchA2aSpecialistRegistry(fetchImpl = fetch) {
  const response = await fetchImpl(REGISTRY_URL, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`A2A specialist registry unavailable (${response.status})`);
  return normalizeA2aSpecialists(await response.json());
}

export function specialistRoleLabel(specialist) {
  if (!specialist?.specialistName) return 'Specialist agent';
  if (specialist.specialistName === 'Specialist agent') return 'Specialist agent';
  return `${specialist.specialistName} · Specialist agent`;
}

export function specialistOptionLabel(specialist) {
  if (!specialist) return 'Specialist agent';
  return `${specialist.appName || specialist.specialistName} · Specialist agent`;
}

export { REGISTRY_URL };
