// Unified inspector source hook — abstracts Banking, PingOne, API Calls, Custom, Protocol
// Returns a normalized interface that McpInspectorPageClean can consume
import { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';

const coerceParam = (raw, type) => {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
};

// Source-specific endpoints and transformers
const SOURCE_CONFIG = {
  banking: {
    endpoint: '/api/mcp/inspector/tools',
    invokeEndpoint: '/api/mcp/inspector/invoke',
    toolKey: 'name',
    paramsKey: 'tool',
  },
  pingone: {
    endpoint: '/api/mcp/inspector/pingone-tools',
    invokeEndpoint: '/api/mcp/inspector/pingone-invoke',
    toolKey: 'name',
    paramsKey: 'tool',
  },
  api: {
    endpoint: '/api/mcp/inspector/api-methods',
    invokeEndpoint: '/api/mcp/inspector/api-invoke',
    toolKey: 'method',
    paramsKey: 'method',
  },
  custom: {
    endpoint: '/api/mcp/inspector/custom-tools',
    invokeEndpoint: '/api/mcp/inspector/custom-invoke',
    toolKey: 'name',
    paramsKey: 'tool',
  },
  protocol: {
    endpoint: '/api/mcp/inspector/protocol-methods',
    invokeEndpoint: '/api/mcp/inspector/protocol-call',
    toolKey: 'method',
    paramsKey: 'method',
  },
};

export function useInspectorSource(sourceKey) {
  const config = SOURCE_CONFIG[sourceKey];
  if (!config) throw new Error(`Unknown source: ${sourceKey}`);

  const [tools, setTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [outputTab, setOutputTab] = useState('response');
  const [busy, setBusy] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);
  const [mcpHistory, setMcpHistory] = useState(getCalls());

  // Subscribe to call history
  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  // Load tools for this source
  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const { data } = await apiClient.get(config.endpoint);
      const toolsList = data.tools || data.methods || data.items || [];
      setTools(toolsList);
      setSelectedTool(null);
      setLastInvoke(null);
      setParamValues({});
    } catch (e) {
      notifyError(formatAxiosError(e, `Failed to load ${sourceKey} tools`));
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }, [sourceKey, config]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return;

    const toolKey = config.toolKey;
    const toolName = selectedTool[toolKey];
    const props = selectedTool.inputSchema?.properties || selectedTool.schema?.properties || {};
    const required = selectedTool.inputSchema?.required || selectedTool.schema?.required || [];
    const missing = required.filter((key) => !String(paramValues[key] ?? '').trim());

    if (missing.length > 0) {
      notifyError(`Required: ${missing.join(', ')}`);
      return;
    }

    setBusy(true);
    const t0 = Date.now();

    try {
      const params = {};
      for (const [key, schema] of Object.entries(props)) {
        const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
        if (coerced !== undefined) params[key] = coerced;
      }

      const payload = {
        [config.paramsKey]: toolName,
        params,
      };

      const { data } = await apiClient.post(config.invokeEndpoint, payload);
      const ms = Date.now() - t0;

      appendMcpCall(toolName, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      const toolName = selectedTool[config.toolKey];
      appendMcpCall(toolName, e.response?.status ?? 0, ms, null, formatAxiosError(e));
      setLastInvoke(e.response?.data || { error: formatAxiosError(e) });
      setLastTiming({ ms, error: true });
      notifyError(formatAxiosError(e, 'Invoke failed'));
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues, config]);

  const schemaProps = useMemo(() => {
    if (!selectedTool) return {};
    return selectedTool.inputSchema?.properties || selectedTool.schema?.properties || {};
  }, [selectedTool]);

  const requiredParams = useMemo(() => {
    if (!selectedTool) return new Set();
    return new Set(selectedTool.inputSchema?.required || selectedTool.schema?.required || []);
  }, [selectedTool]);

  const outputContent = useMemo(() => {
    switch (outputTab) {
      case 'response':
        return lastInvoke ? JSON.stringify(lastInvoke, null, 2) : null;
      case 'request':
        return selectedTool ? JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: selectedTool[config.toolKey], arguments: paramValues },
        }, null, 2) : null;
      case 'schema':
        return selectedTool?.inputSchema
          ? JSON.stringify(selectedTool.inputSchema, null, 2)
          : selectedTool?.schema
            ? JSON.stringify(selectedTool.schema, null, 2)
            : null;
      case 'timing':
        return lastTiming ? `Duration: ${lastTiming.ms}ms` : null;
      case 'headers':
        return JSON.stringify({ 'Protocol-Version': '2.0', 'Transport': 'WebSocket JSON-RPC' }, null, 2);
      default:
        return null;
    }
  }, [outputTab, lastInvoke, selectedTool, paramValues, lastTiming, config]);

  return {
    // Data
    tools,
    selectedTool,
    paramValues,
    outputTab,
    busy,
    loadingTools,
    lastInvoke,
    lastTiming,
    mcpHistory,
    schemaProps,
    requiredParams,
    outputContent,
    config,

    // Actions
    setSelectedTool,
    setParamValues,
    setOutputTab,
    handleExecute,
    loadTools,
  };
}
