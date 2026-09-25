import apiClient from './apiClient';

// AI Control Plane API. Any authenticated user; the only real identity is the
// live agent. The demo stop/reset endpoints remain server-side but the UI no
// longer offers simulated platform stops.
const BASE = '/api/control-plane';

export const getAgents = () => apiClient.get(`${BASE}/agents`).then((r) => r.data);
// Full-scope kill + PingOne SSO session termination in one call. The server
// answers 401 agent_killed by design (the session is destroyed) — resolve
// rather than reject so the caller can show the step report; `_noAuthBanner`
// because this 401 IS the success signal, the same shape confirmLiveKill
// already handles.
export const comprehensiveShutdown = (reason = 'comprehensive_shutdown') =>
  apiClient
    .post(`${BASE}/comprehensive-shutdown`, { reason }, { _noAuthBanner: true })
    .then((r) => r.data)
    .catch((err) => {
      if (err?.response?.data?.error === 'agent_killed') return err.response.data;
      throw err;
    });
