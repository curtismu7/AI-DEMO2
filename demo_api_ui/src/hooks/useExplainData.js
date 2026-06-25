import { useState, useEffect } from 'react';
import apiClient from '../services/apiClient';

/**
 * Fetches live Authorize rules + gateway topology for a UC's primaryTool.
 * @param {{ primaryTool: string|null } | null} uc
 * @returns {{ rules: object|null, topology: object|null, loading: boolean, error: string|null }}
 */
export function useExplainData(uc) {
  const [rules, setRules] = useState(null);
  const [topology, setTopology] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uc) {
      setRules(null);
      setTopology(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchRules = apiClient.get('/api/authorize/mock-authz-rules', { _silent: true }).catch(() => ({ data: null }));
    const fetchTopo = uc.primaryTool
      ? apiClient.get(`/api/mcp/tool-topology?tool=${encodeURIComponent(uc.primaryTool)}`, { _silent: true }).catch(() => ({ data: null }))
      : Promise.resolve({ data: null });

    Promise.all([fetchRules, fetchTopo]).then(([rulesRes, topoRes]) => {
      if (cancelled) return;
      setRules(rulesRes?.data ?? null);
      setTopology(topoRes?.data ?? null);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError('Failed to load live data');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [uc?.primaryTool, uc]);

  return { rules, topology, loading, error };
}
