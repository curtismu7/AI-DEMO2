// demo_api_ui/src/components/PingOneMcpInspector.js
// Redesign: Dark IDE three-column layout (Mock B)
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import JsonHighlight from './shared/JsonHighlight';
import './PingOneMcpInspector.css';

/**
 * Coerce text input → typed value for the JSON-RPC params object.
 */
const coerceParam = (raw, type) => {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') { const n = Number(raw); return Number.isNaN(n) ? raw : n; }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') { try { return JSON.parse(raw); } catch { return raw; } }
  return raw;
};

const isDavinciTool = (name) => name.includes('Davinci') || name.includes('davinci');

/** Group tools by resource type for the tree. */
const groupKey = (name) => {
  if (isDavinciTool(name)) return 'DaVinci';
  if (name.includes('Environment')) return 'Environments';
  if (name.includes('Application')) return 'Applications';
  if (name.includes('User')) return 'Users';
  if (name.includes('Population')) return 'Populations';
  return 'Other';
};

const GROUP_ORDER = ['Environments', 'Users', 'Applications', 'Populations', 'DaVinci', 'Other'];

const PingOneMcpInspector = ({ user, onLogout }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [calling, setCalling] = useState(false);
  const [lastCall, setLastCall] = useState(null);
  const [formError, setFormError] = useState(null);
  const [outputTab, setOutputTab] = useState('response');
  const [outputFontSize, setOutputFontSize] = useState(13);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/mcp/inspector/pingone-tools');
      setData(res.data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to query the PingOne MCP server'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabled = data?.enabled;
  const tools = data?.tools || [];

  // Group tools for the tree
  const groupedTools = useMemo(() => {
    const searchQ = toolSearch.trim().toLowerCase();
    const filtered = searchQ
      ? tools.filter(t => t.name.toLowerCase().includes(searchQ) || (t.description || '').toLowerCase().includes(searchQ))
      : tools;
    const groups = {};
    for (const t of filtered) {
      const g = groupKey(t.name);
      if (!groups[g]) groups[g] = [];
      groups[g].push(t);
    }
    return GROUP_ORDER.filter(g => groups[g]?.length).map(g => ({ label: g, tools: groups[g] }));
  }, [tools, toolSearch]);

  const toggleLiveQuery = useCallback(async () => {
    setToggling(true);
    try {
      await apiClient.patch('/api/admin/feature-flags', { updates: { mcp_inspector_pingone_live: !enabled } });
      await refresh();
    } catch (e) { notifyError(formatAxiosError(e, 'Failed to toggle live querying')); }
    finally { setToggling(false); }
  }, [enabled, refresh]);

  const selectTool = (tool) => {
    setSelectedTool(tool);
    const defaults = data?.paramDefaults || {};
    const props = tool.inputSchema?.properties || {};
    const seeded = {};
    for (const key of Object.keys(props)) { if (defaults[key]) seeded[key] = defaults[key]; }
    setParamValues(seeded);
    setFormError(null);
    setLastCall(null);
    setOutputTab('response');
  };

  const callTool = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter(k => !(paramValues[k] ?? '').trim());
    if (missing.length > 0) { setFormError(`Required: ${missing.join(', ')}`); return; }
    setFormError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setCalling(true);
    try {
      const res = await apiClient.post('/api/mcp/inspector/pingone-invoke', { tool: selectedTool.name, params });
      setLastCall(res.data);
      setOutputTab('response');
    } catch (e) { notifyError(formatAxiosError(e, 'tools/call failed')); setLastCall(null); }
    finally { setCalling(false); }
  }, [selectedTool, paramValues]);

  const clearForm = () => { setParamValues({}); setFormError(null); setLastCall(null); };

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  // Determine tool "type" for dot color
  const toolDotClass = (name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('create') || lower.startsWith('update') || lower.startsWith('delete') || lower.startsWith('manage')) return 'p1mcp-tree-item__dot--write';
    return '';
  };

  return (
    <div className="p1mcp-page">
      {/* Top bar */}
      <div className="p1mcp-topbar">
        <span className={`p1mcp-topbar__dot ${enabled ? '' : 'p1mcp-topbar__dot--off'}`} />
        <h1>PingOne MCP Inspector</h1>
        <span className="p1mcp-topbar__status">
          {enabled ? `Connected — ${tools.length} tools` : 'Disconnected'}
        </span>
        <div className="p1mcp-topbar__right">
          <button className="p1mcp-topbar__btn" onClick={refresh} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            className={`p1mcp-topbar__btn ${enabled ? 'p1mcp-topbar__btn--active' : ''}`}
            onClick={toggleLiveQuery}
            disabled={toggling}
          >
            {toggling ? 'Switching…' : enabled ? 'Live: ON' : 'Live: OFF'}
          </button>
        </div>
      </div>

      {/* Three-column grid */}
      <div className="p1mcp-grid">
        {/* Column 1: Tree */}
        <div className="p1mcp-col-tree">
          <div className="p1mcp-tree-header">
            <span>Tools ({tools.length})</span>
          </div>
          <div className="p1mcp-tree-search">
            <input
              type="search"
              placeholder="Filter tools…"
              value={toolSearch}
              onChange={e => setToolSearch(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="p1mcp-tree-body">
            {groupedTools.map(group => (
              <div className="p1mcp-tree-group" key={group.label}>
                <div className="p1mcp-tree-group__label">{group.label} ({group.tools.length})</div>
                {group.tools.map(t => (
                  <div
                    key={t.name}
                    className={`p1mcp-tree-item ${selectedTool?.name === t.name ? 'p1mcp-tree-item--active' : ''}`}
                    onClick={() => selectTool(t)}
                  >
                    <span className={`p1mcp-tree-item__dot ${toolDotClass(t.name)}`} />
                    <span>{t.name}</span>
                    {toolDotClass(t.name).includes('write') && (
                      <span className="p1mcp-tree-item__badge p1mcp-tree-item__badge--write">W</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {groupedTools.length === 0 && (
              <div style={{ padding: '20px 16px', color: '#64748b', fontSize: 13 }}>
                {tools.length === 0 ? 'No tools loaded.' : `No tools match "${toolSearch}".`}
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Form */}
        <div className="p1mcp-col-form">
          {selectedTool ? (
            <>
              <div className="p1mcp-form-header">
                <div className="p1mcp-form-header__name">{selectedTool.name}</div>
                {selectedTool.description && (
                  <div className="p1mcp-form-header__desc">{selectedTool.description}</div>
                )}
              </div>
              <div className="p1mcp-form-actions p1mcp-form-actions--top">
                <button className="p1mcp-btn-call" onClick={callTool} disabled={calling || !enabled}>
                  {calling ? 'Calling…' : 'Execute'}
                </button>
                <button className="p1mcp-btn-clear" onClick={clearForm}>Clear</button>
              </div>
              <div className="p1mcp-form-body">
                {Object.entries(schemaProps).map(([key, schema]) => (
                  <div className="p1mcp-field" key={key}>
                    <label>
                      {key}
                      {requiredParams.has(key) && <span className="req"> *</span>}
                      <span className="type">{schema?.type || ''}</span>
                    </label>
                    <input
                      type="text"
                      placeholder={schema?.description || schema?.type || 'value'}
                      value={paramValues[key] ?? ''}
                      onChange={e => setParamValues(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                {Object.keys(schemaProps).length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 13 }}>No parameters required.</div>
                )}
              </div>
              <div className="p1mcp-form-actions">
                <button className="p1mcp-btn-call" onClick={callTool} disabled={calling || !enabled}>
                  {calling ? 'Calling…' : 'Execute'}
                </button>
                <button className="p1mcp-btn-clear" onClick={clearForm}>Clear</button>
                {formError && <span className="p1mcp-form-error">{formError}</span>}
              </div>
            </>
          ) : (
            <div className="p1mcp-form-empty">
              Select a tool from the tree to inspect and invoke it.
            </div>
          )}
        </div>

        {/* Column 3: Output */}
        <div className="p1mcp-col-output">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333' }}>
            <div className="p1mcp-output-tabs">
              <button
                className={`p1mcp-output-tab ${outputTab === 'response' ? 'p1mcp-output-tab--active' : ''}`}
                onClick={() => setOutputTab('response')}
              >Response</button>
              <button
                className={`p1mcp-output-tab ${outputTab === 'request' ? 'p1mcp-output-tab--active' : ''}`}
                onClick={() => setOutputTab('request')}
              >Request</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', padding: '8px 12px' }}>
              <button onClick={() => setOutputFontSize(Math.max(10, outputFontSize - 1))} style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', border: '1px solid #555', background: '#222', borderRadius: '4px', color: '#ccc' }}>−</button>
              <span style={{ fontSize: '12px', minWidth: '30px', textAlign: 'center', lineHeight: '1.5', color: '#ccc' }}>{outputFontSize}px</span>
              <button onClick={() => setOutputFontSize(Math.min(20, outputFontSize + 1))} style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', border: '1px solid #555', background: '#222', borderRadius: '4px', color: '#ccc' }}>+</button>
            </div>
          </div>
          {lastCall ? (
            <>
              <div className="p1mcp-output-body" style={{ fontSize: `${outputFontSize}px` }}>
                <pre className="p1mcp-output-code">
                  <JsonHighlight
                    value={outputTab === 'response' ? lastCall.response : lastCall.request}
                    deep
                  />
                </pre>
              </div>
              <div className="p1mcp-output-footer">
                <span><strong>Status:</strong> {lastCall.error ? 'Error' : '200 OK'}</span>
                <span><strong>Duration:</strong> {lastCall.timingsMs?.roundTrip ?? '?'}ms</span>
                <span><strong>Transport:</strong> HTTP/SSE</span>
              </div>
            </>
          ) : (
            <div className="p1mcp-output-empty">
              {selectedTool ? 'Click Execute to call the tool and see the response here.' : 'Select a tool and execute it to see results.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PingOneMcpInspector;
