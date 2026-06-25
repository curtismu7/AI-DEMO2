// demo_api_ui/src/services/agentBuilderService.js
// Thin bffAxios wrappers for /api/agent-builder (AgentBuilderPage).
import bffAxios from './bffAxios';

export async function fetchState() {
  const { data } = await bffAxios.get('/api/agent-builder/state');
  return data;
}

export async function buildAgent(config) {
  const { data } = await bffAxios.post('/api/agent-builder/agent', config || {});
  return data;
}

export async function upgradeAgent() {
  const { data } = await bffAxios.post('/api/agent-builder/agent/upgrade');
  return data;
}

export async function listAgents() {
  const { data } = await bffAxios.get('/api/agent-builder/agents');
  return data.agents;
}

export async function agentSetup(id) {
  const { data } = await bffAxios.get(`/api/agent-builder/agents/${id}/setup`);
  return data;
}

export async function deleteAgent() {
  const { data } = await bffAxios.delete('/api/agent-builder/agent');
  return data;
}

export async function applyGrants(grants) {
  const { data } = await bffAxios.put('/api/agent-builder/grants', { grants });
  return data;
}

export async function createResource({ name, audience, scopes }) {
  const { data } = await bffAxios.post('/api/agent-builder/resources', { name, audience, scopes });
  return data;
}

export async function deleteResource(id) {
  const { data } = await bffAxios.delete(`/api/agent-builder/resources/${id}`);
  return data;
}

/** Normalize axios errors to the BFF's { error, message } body. */
export function errorMessage(err) {
  return err?.response?.data?.message || err?.message || 'Request failed';
}
