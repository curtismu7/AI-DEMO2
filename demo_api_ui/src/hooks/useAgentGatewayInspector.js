import { useState, useEffect, useCallback, useMemo } from 'react';
import bffAxios from '../services/bffAxios';

export function useAgentGatewayInspector({ gatewayId } = {}) {
  // Gateway/capability selection
  const [selectedGateway, setSelectedGateway] = useState(gatewayId || '');
  const [selectedCapabilities, setSelectedCapabilities] = useState({});
  const [availableCapabilities, setAvailableCapabilities] = useState([]);

  // Tool invocation
  const [selectedTool, setSelectedTool] = useState('');
  const [isChainMode, setIsChainMode] = useState(false);
  const [parameters, setParameters] = useState({});

  // Execution state
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastParameters, setLastParameters] = useState(null);
  const [lastTrace, setLastTrace] = useState(null);

  // Output tabs
  const [outputTab, setOutputTab] = useState('response');

  // Movie reel history
  const [invocationHistory, setInvocationHistory] = useState([]);
  const [activeReelId, setActiveReelId] = useState(null);

  // Fetch capabilities when gateway changes
  useEffect(() => {
    if (!selectedGateway) {
      setAvailableCapabilities([]);
      return;
    }
    (async () => {
      try {
        const { data } = await bffAxios.get('/api/agent-gateway/capabilities', {
          params: { gatewayId: selectedGateway },
        });
        setAvailableCapabilities(data.capabilities || []);
      } catch (err) {
        console.error('Failed to fetch capabilities:', err);
        setAvailableCapabilities([]);
      }
    })();
  }, [selectedGateway]);

  // Toggle capability filter
  const toggleCapability = useCallback((toolName) => {
    setSelectedCapabilities((prev) => ({
      ...prev,
      [toolName]: !prev[toolName],
    }));
  }, []);

  // Update parameter value
  const updateParameter = useCallback((key, value) => {
    setParameters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  // Build invocation payload
  const buildParameters = useCallback(() => {
    return {
      gatewayId: selectedGateway,
      tool: selectedTool,
      parameters,
      isChainMode,
      timestamp: new Date().toISOString(),
    };
  }, [selectedGateway, selectedTool, parameters, isChainMode]);

  // Execute tool invocation
  const run = useCallback(async () => {
    if (!selectedGateway || !selectedTool) {
      setError('Gateway and tool must be selected');
      return;
    }

    setRunning(true);
    setError(null);
    setResult(null);
    setLastTrace(null);

    const payload = buildParameters();
    setLastParameters(payload);

    try {
      const { data } = await bffAxios.post('/api/agent-gateway/invoke', payload);

      setResult(data);
      setLastTrace(data.trace || {});

      // Add to history reel
      const entry = {
        id: `invocation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        tool: selectedTool,
        outcome: data.status === 'success' ? 'success' : 'error',
        durationMs: data.durationMs || 0,
        timestamp: new Date().toISOString(),
        parameters: payload,
        result: data,
      };
      setInvocationHistory((prev) => [...prev, entry]);
      setActiveReelId(entry.id);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Unknown error';
      setError(errMsg);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }, [selectedGateway, selectedTool, buildParameters]);

  // Restore state from reel entry
  const selectReelEntry = useCallback((entry) => {
    setActiveReelId(entry.id);
    setResult(entry.result);
    setLastParameters(entry.parameters);
    setLastTrace(entry.result?.trace || {});
    setParameters(entry.parameters?.parameters || {});
    setSelectedTool(entry.tool);
  }, []);

  return {
    // Gateway/capability
    selectedGateway,
    setSelectedGateway,
    selectedCapabilities,
    toggleCapability,
    availableCapabilities,

    // Tool invocation
    selectedTool,
    setSelectedTool,
    isChainMode,
    setIsChainMode,
    parameters,
    updateParameter,

    // Execution
    running,
    result,
    error,
    lastParameters,
    lastTrace,

    // Output tabs
    outputTab,
    setOutputTab,

    // Movie reel
    invocationHistory,
    activeReelId,
    selectReelEntry,

    // Execution function
    run,
    buildParameters,
  };
}
