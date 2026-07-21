import { useState, useEffect, useCallback } from 'react';

// `API_BASE` is NOT exported by services/apiClient.js — that module only
// exports the shared axios singleton. McpGatewayConfig.jsx and
// AuthorizeConfigPage.jsx each define this same local constant for their raw
// `fetch()` calls; this hook follows that existing convention rather than
// importing a non-existent named export.
const API_BASE = process.env.REACT_APP_API_BASE || '';

/**
 * Shared fetch of GET /api/admin/mcp-gateway/config (BFF proxy to the
 * gateway's GET /admin/config safe view). Extracted from McpGatewayConfig.jsx
 * so other surfaces (e.g. UnifiedTokenFlowInspector's Token Transform tab)
 * can read the same live gateway config without duplicating the fetch.
 */
export function useGatewayLiveConfig() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/mcp-gateway/config`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, loading, error, refetch };
}
