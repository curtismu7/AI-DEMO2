// Server-facing routing state shared by the Cursor page and the footprint
// skins: which path (MCP mode or LLM lane), which door, and the optimistic
// /config switch with rollback. Page-only follow-ups (sign-in modal, overlay,
// silent re-auth) stay with the caller; this returns what they need.
import { useCallback, useState } from 'react';
import { doorName } from './privilegeRouting';

const DEFAULT_CONFIG = {
  mcpUrl: '',
  clientId: '',
  scopes: 'openid profile email offline_access',
  llmUrl: 'http://127.0.0.1:11434',
  llmModel: 'llama3.2:1b',
};
const EMPTY_GATEWAY_CONFIGS = { direct: {}, privilege: {}, facade: {} };

export function usePrivilegeRouting({ request }) {
  const [gatewayMode, setGatewayMode] = useState('privilege');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [gatewayConfigs, setGatewayConfigs] = useState(EMPTY_GATEWAY_CONFIGS);
  const [presets, setPresets] = useState([]);
  // '' = an MCP path is active; non-empty = chat goes to that LLM lane.
  const [llmPath, setLlmPath] = useState('');
  const [llmGatewayUrl, setLlmGatewayUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [gatewaySession, setGatewaySession] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [preflightError, setPreflightError] = useState('');
  const [preflightBusy, setPreflightBusy] = useState(false);

  const hydrate = useCallback((s) => {
    setGatewaySession(s.gatewaySession || null);
    setGatewayMode(s.gatewayMode || 'privilege');
    if (s.config) setConfig(s.config);
    setGatewayConfigs(s.gatewayConfigs || EMPTY_GATEWAY_CONFIGS);
    setPresets(Array.isArray(s.presets) ? s.presets : []);
    setLoaded(true);
  }, []);

  const selectPath = useCallback(async (key) => {
    if (key.startsWith('llm:')) {
      setLlmPath(key.slice(4));
      return { ok: true, llm: true };
    }
    // Keep the selected app across paths when the destination has a matching
    // door; otherwise a path switch silently lands on a different app's policy.
    const selectedDoor = doorName(config.mcpUrl);
    const matchingDoor = selectedDoor && presets.find(
      (p) => p.mode === key && doorName(p.url) === selectedDoor,
    );
    const nextConfig = {
      ...config,
      ...(gatewayConfigs[key] || {}),
      ...(matchingDoor ? { mcpUrl: matchingDoor.url, clientId: matchingDoor.clientId || '' } : {}),
    };
    const prevMode = gatewayMode;
    const prevConfig = config;
    setLlmPath('');
    setGatewayMode(key);
    setConfig(nextConfig);
    try {
      const saved = await request('/config', { method: 'POST', body: { ...nextConfig, gatewayMode: key } });
      setGatewayConfigs(saved?.gatewayConfigs || gatewayConfigs);
      return { ok: true, saved, nextConfig };
    } catch (error) {
      // The mode was set optimistically; leaving it would claim a mode the
      // server never accepted.
      setGatewayMode(prevMode);
      setConfig(prevConfig);
      return { ok: false, error };
    }
  }, [config, gatewayConfigs, gatewayMode, presets, request]);

  const selectDoor = useCallback(async (mcpUrl) => {
    const preset = presets.find((p) => p.url === mcpUrl);
    const next = { ...config, mcpUrl, ...(preset ? { clientId: preset.clientId || '' } : {}) };
    try {
      const saved = await request('/config', { method: 'POST', body: next });
      setConfig(next);
      return { ok: true, saved, next };
    } catch (error) {
      return { ok: false, error };
    }
  }, [config, presets, request]);

  // Probes the OTHER configured doors with this identity (/doors/probe skips the
  // selected door and caps the fan-out). /doors/probe already initializes an MCP
  // session per URL with the operator's token and returns a tool count, which is the
  // only honest proof a door works for a real caller. Goes through `request` so a 401 arrives as
  // an Error carrying the server's message instead of a body with no `results` that
  // would render as an empty list — a failed preflight that looks like a clean one.
  const probePresetDoors = useCallback(async () => {
    setPreflightBusy(true);
    setPreflightError('');
    setPreflight(null);
    try {
      const urls = presets.map((p) => p.url).filter(Boolean);
      const data = await request('/doors/probe', { method: 'POST', body: { urls } });
      setPreflight(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      setPreflightError(err?.response?.data?.error || err?.message || 'Preflight failed');
    } finally {
      setPreflightBusy(false);
    }
  }, [presets, request]);

  return {
    gatewaySession, setGatewaySession,
    preflight, setPreflight,
    preflightError, setPreflightError,
    preflightBusy, setPreflightBusy,
    probePresetDoors,
    gatewayMode, setGatewayMode,
    config, setConfig,
    gatewayConfigs, setGatewayConfigs,
    presets, setPresets,
    llmPath, setLlmPath,
    llmGatewayUrl, setLlmGatewayUrl,
    loaded, hydrate, selectPath, selectDoor,
  };
}
