// MCP Inspector — Clean Design
// Modern minimal three-pane layout with movie reel history and expanded tabs
// TODO: This is currently a mock. Real implementation needs to integrate with
// the actual useBankingSource/usePingOneSource/useApiCallsSource hooks from the
// parent McpInspectorPage. The clean design is ready; data source integration
// requires substantial refactoring of those hooks to work with the new layout.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import { getCalls, subscribe as subscribeMcpCalls, appendMcpCall } from '../services/mcpCallStore';
import JsonHighlight from './shared/JsonHighlight';
import './McpInspectorPage.clean.css';

const SOURCES = [
  { key: 'banking', label: 'AI Demo MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
  { key: 'custom', label: 'Custom Server' },
  { key: 'protocol', label: 'Protocol' },
];

const OUTPUT_TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'schema', label: 'Schema' },
  { key: 'timing', label: 'Timing' },
  { key: 'headers', label: 'Headers' },
];

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

function McpInspectorPageClean() {
  const [searchParams] = useSearchParams();
  const [activeSource, setActiveSource] = useState(searchParams.get('source') || 'banking');

  // Tool/Method state
  const [tools, setTools] = useState([]);
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [outputTab, setOutputTab] = useState('response');
  const [busy, setBusy] = useState(false);
  const [loadingTools, setLoadingTools] = useState(false);

  // Output state
  const [lastInvoke, setLastInvoke] = useState(null);
  const [lastTiming, setLastTiming] = useState(null);

  // Call history (movie reel)
  const [mcpHistory, setMcpHistory] = useState(getCalls());
  const [activeHistoryId, setActiveHistoryId] = useState(null);

  // Subscribe to call history updates
  useEffect(() => {
    const unsub = subscribeMcpCalls(setMcpHistory);
    return unsub;
  }, []);

  // Load tools on source change
  useEffect(() => {
    const loadTools = async () => {
      if (activeSource !== 'banking') {
        setTools([]);
        return;
      }

      setLoadingTools(true);
      try {
        const { data } = await apiClient.get('/api/mcp/inspector/tools');
        setTools(data.tools || []);
      } catch (e) {
        notifyError(formatAxiosError(e, 'Failed to load tools'));
        setTools([]);
      } finally {
        setLoadingTools(false);
      }
    };

    loadTools();
  }, [activeSource]);

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return;

    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
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

      const { data } = await apiClient.post('/api/mcp/inspector/invoke', {
        tool: selectedTool.name,
        params,
      });

      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, 200, ms, data.result ?? data);
      setLastInvoke(data);
      setLastTiming({ ms, error: false });
      setOutputTab('response');
    } catch (e) {
      const ms = Date.now() - t0;
      appendMcpCall(selectedTool.name, e.response?.status ?? 0, ms, null, formatAxiosError(e));
      setLastInvoke(e.response?.data || { error: formatAxiosError(e) });
      setLastTiming({ ms, error: true });
      notifyError(formatAxiosError(e, 'Invoke failed'));
    } finally {
      setBusy(false);
    }
  }, [selectedTool, paramValues]);

  const selectHistoryEntry = useCallback((entry) => {
    const tool = tools.find(t => t.name === entry.tool);
    if (tool) {
      setSelectedTool(tool);
      setActiveHistoryId(entry.id);
      setOutputTab('response');
    }
  }, [tools]);

  const outputContent = useMemo(() => {
    switch (outputTab) {
      case 'response':
        return lastInvoke ? JSON.stringify(lastInvoke, null, 2) : null;
      case 'request':
        return selectedTool ? JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: selectedTool.name, arguments: paramValues },
        }, null, 2) : null;
      case 'schema':
        return selectedTool?.inputSchema ? JSON.stringify(selectedTool.inputSchema, null, 2) : null;
      case 'timing':
        return lastTiming ? `Duration: ${lastTiming.ms}ms` : null;
      case 'headers':
        return JSON.stringify({ 'Protocol-Version': '2.0', 'Transport': 'WebSocket JSON-RPC' }, null, 2);
      default:
        return null;
    }
  }, [outputTab, lastInvoke, selectedTool, paramValues, lastTiming]);

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  return (
    <div className="inspector-clean-page">
      <div className="inspector-clean-header">
        <h1 className="inspector-clean-title">MCP Inspector</h1>
        <div className="inspector-clean-tabs">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`inspector-clean-tab ${activeSource === s.key ? 'active' : ''}`}
              onClick={() => setActiveSource(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector-clean-content">
        <div className="inspector-clean-main">
          {/* Left: Tools Tree */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Tools ({tools.length})</div>
            </div>
            <div className="inspector-clean-panel-body">
              {loadingTools ? (
                <div style={{ color: 'var(--inspector-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                  Loading tools...
                </div>
              ) : tools.length === 0 ? (
                <div style={{ color: 'var(--inspector-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                  No tools available
                </div>
              ) : (
                tools.map((tool) => (
                  <div
                    key={tool.name}
                    className={`inspector-clean-item ${selectedTool?.name === tool.name ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedTool(tool);
                      setParamValues({});
                      setLastInvoke(null);
                    }}
                  >
                    {tool.name}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Middle: Form */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Parameters</div>
            </div>
            <div className="inspector-clean-panel-body">
              {selectedTool ? (
                <div className="inspector-clean-form">
                  <div className="inspector-clean-form-section">
                    <div className="inspector-clean-section-title">{selectedTool.name}</div>
                    {selectedTool.description && (
                      <div style={{ fontSize: '12px', color: 'var(--inspector-text-secondary)', marginBottom: '12px' }}>
                        {selectedTool.description}
                      </div>
                    )}
                    {Object.entries(schemaProps).map(([key, schema]) => (
                      <div key={key} className="inspector-clean-field">
                        <div className="inspector-clean-field-label">
                          <span>{key}{requiredParams.has(key) ? ' *' : ''}</span>
                          <span className="inspector-clean-field-type">{schema?.type || ''}</span>
                        </div>
                        <input
                          type="text"
                          placeholder={schema?.description || schema?.type || 'value'}
                          value={paramValues[key] || ''}
                          onChange={(e) => setParamValues(prev => ({
                            ...prev,
                            [key]: e.target.value,
                          }))}
                        />
                      </div>
                    ))}
                    {Object.keys(schemaProps).length === 0 && (
                      <div style={{ color: 'var(--inspector-text-tertiary)', fontSize: '12px' }}>
                        No parameters required
                      </div>
                    )}
                  </div>
                  <button
                    className="inspector-clean-button"
                    onClick={handleExecute}
                    disabled={busy}
                  >
                    {busy ? 'Calling...' : 'Execute Call'}
                  </button>
                </div>
              ) : (
                <div style={{ color: 'var(--inspector-text-secondary)', padding: '20px', textAlign: 'center' }}>
                  Select a tool to see parameters
                </div>
              )}
            </div>
          </div>

          {/* Right: Output */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Output</div>
            </div>
            <div className="inspector-clean-panel-body">
              <div className="inspector-clean-output">
                <div className="inspector-clean-output-tabs">
                  {OUTPUT_TABS.map((t) => (
                    <button
                      key={t.key}
                      className={`inspector-clean-output-tab ${outputTab === t.key ? 'active' : ''}`}
                      onClick={() => setOutputTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {outputContent ? (
                  <>
                    <pre className="inspector-clean-code">{outputContent}</pre>
                    <div className="inspector-clean-meta">
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Status</div>
                        <div className="inspector-clean-meta-value">
                          {lastTiming?.error ? 'Error' : lastTiming ? '200 OK' : '-'}
                        </div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Duration</div>
                        <div className="inspector-clean-meta-value">
                          {lastTiming?.ms != null ? `${lastTiming.ms}ms` : '-'}
                        </div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Transport</div>
                        <div className="inspector-clean-meta-value">WebSocket JSON-RPC</div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Size</div>
                        <div className="inspector-clean-meta-value">
                          {outputContent ? Math.ceil(outputContent.length / 10) * 10 + 'B' : '-'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--inspector-text-secondary)', padding: '20px', textAlign: 'center' }}>
                    {selectedTool ? 'Click Execute to see the response' : 'Select and execute a tool'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Movie Reel */}
        <div className="inspector-clean-reel">
          <div className="inspector-clean-reel-label">History</div>
          {mcpHistory.length === 0 ? (
            <div style={{ color: 'var(--inspector-text-tertiary)', fontSize: '11px' }}>No calls yet</div>
          ) : (
            mcpHistory.slice(-20).reverse().map((entry) => (
              <button
                key={entry.id}
                className={`inspector-clean-reel-frame ${activeHistoryId === entry.id ? 'active' : ''}`}
                onClick={() => selectHistoryEntry(entry)}
              >
                {entry.tool} ({entry.duration}ms)
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default McpInspectorPageClean;
