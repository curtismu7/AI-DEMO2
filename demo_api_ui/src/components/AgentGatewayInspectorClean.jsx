import React, { useEffect, useMemo, useState } from 'react';
import { useThemeOptional } from '../context/ThemeContext';
import { useAgentGatewayInspector } from '../hooks/useAgentGatewayInspector';
import './AgentGatewayInspectorClean.css';

export default function AgentGatewayInspectorClean({ gatewayId = '' }) {
  const theme = useThemeOptional();
  const {
    selectedGateway,
    setSelectedGateway,
    selectedCapabilities,
    toggleCapability,
    availableCapabilities,
    selectedTool,
    setSelectedTool,
    isChainMode,
    setIsChainMode,
    parameters,
    setParameters,
    availablePolicies,
    selectedPolicy,
    setSelectedPolicy,
    running,
    result,
    error,
    outputTab,
    setOutputTab,
    invocationHistory,
    activeReelId,
    selectReelEntry,
    run,
  } = useAgentGatewayInspector({ gatewayId });

  const filteredTools = useMemo(
    () =>
      availableCapabilities.filter((cap) => {
        const allSelected = Object.keys(selectedCapabilities).length === 0;
        const isSelected = selectedCapabilities[cap.name];
        return allSelected || isSelected;
      }),
    [availableCapabilities, selectedCapabilities],
  );

  // The textarea holds raw text so invalid intermediate JSON doesn't snap back
  // to the last valid state mid-keystroke; paramsError surfaces bad syntax
  // instead of silently discarding the input.
  const [paramsText, setParamsText] = useState(() => JSON.stringify(parameters, null, 2));
  const [paramsError, setParamsError] = useState(false);

  // Re-sync the text only when parameters change from outside the textarea
  // (tool switch, reel restore) — not on every keystroke's parse round-trip.
  useEffect(() => {
    setParamsText(JSON.stringify(parameters, null, 2));
    setParamsError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool, activeReelId]);

  return (
    <div className="inspector-clean-page">
      {/* Header */}
      <div className="inspector-clean-header">
        <div className="inspector-clean-title">Agent Gateway Inspector</div>
        <div className="inspector-clean-header-controls">
          <button className="inspector-clean-theme-toggle" onClick={theme.toggleDarkMode} title="Toggle dark mode">
            {theme.darkMode ? 'Light' : 'Dark'}
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="inspector-clean-statusbar">
        <div className="inspector-clean-statusbar-item">
          <span className="inspector-clean-statusbar-badge">LIVE</span>
        </div>
        <div className="inspector-clean-statusbar-item">
          Environment: <strong>01d89b06</strong>
        </div>
        <div className="inspector-clean-statusbar-item">
          Worker: demo-bff-mcp-client
        </div>
      </div>

      {/* Main Content */}
      <div className="inspector-clean-content">
        <div className="inspector-clean-main">
          {/* Left Panel: Gateway & Capability Filters */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Gateway & Filters</div>
            </div>
            <div className="inspector-clean-panel-body">
              <div className="inspector-clean-field">
                <label className="inspector-clean-field-label">Gateway</label>
                <select
                  value={selectedGateway}
                  onChange={(e) => {
                    setSelectedGateway(e.target.value);
                    setSelectedTool('');
                  }}
                >
                  <option value="">Select a gateway...</option>
                  <option value="demo-mcp-gateway">Demo MCP Gateway (01d89b06)</option>
                </select>
              </div>

              <div className="inspector-clean-field" style={{ marginTop: '16px' }}>
                <label className="inspector-clean-field-label">Policy</label>
                <select
                  value={selectedPolicy}
                  onChange={(e) => setSelectedPolicy(e.target.value)}
                >
                  <option value="">Default policy</option>
                  {availablePolicies.map((policy) => (
                    <option key={policy.id || policy.name} value={policy.id || policy.name}>
                      {policy.name || policy.id}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginTop: '16px' }}>
                <div className="inspector-clean-field-label" style={{ marginBottom: '8px' }}>
                  Capabilities
                </div>
                <div style={{ fontSize: '12px', maxHeight: '200px', overflowY: 'auto' }}>
                  {availableCapabilities.length === 0 ? (
                    <div style={{ color: 'var(--th-text-muted)', padding: '8px' }}>Select a gateway first</div>
                  ) : (
                    availableCapabilities.map((cap) => (
                      <div key={cap.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedCapabilities[cap.name] || false}
                          onChange={() => toggleCapability(cap.name)}
                        />
                        <label style={{ flex: 1, cursor: 'pointer' }}>{cap.name}</label>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Middle Panel: Tool Invocation Form */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="inspector-clean-panel-label">Tool Invocation</div>
              </div>
            </div>
            <div className="inspector-clean-panel-body">
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <button
                  className={`inspector-clean-toggle-btn ${!isChainMode ? 'active' : ''}`}
                  onClick={() => setIsChainMode(false)}
                >
                  Single Tool
                </button>
                <button
                  className={`inspector-clean-toggle-btn ${isChainMode ? 'active' : ''}`}
                  onClick={() => setIsChainMode(true)}
                >
                  Tool Chain
                </button>
              </div>

              <div className="inspector-clean-field">
                <label className="inspector-clean-field-label">Select Tool</label>
                <select value={selectedTool} onChange={(e) => setSelectedTool(e.target.value)}>
                  <option value="">Choose a tool...</option>
                  {filteredTools.map((tool) => (
                    <option key={tool.name} value={tool.name}>
                      {tool.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="inspector-clean-form">
                {selectedTool && (
                  <>
                    <div className="inspector-clean-field">
                      <label className="inspector-clean-field-label">Custom Parameters (JSON)</label>
                      <textarea
                        rows="4"
                        placeholder='{"key": "value"}'
                        className="inspector-clean-json-input"
                        value={paramsText}
                        onChange={(e) => {
                          setParamsText(e.target.value);
                          try {
                            setParameters(JSON.parse(e.target.value));
                            setParamsError(false);
                          } catch {
                            setParamsError(true);
                          }
                        }}
                      />
                      {paramsError && (
                        <div className="inspector-clean-json-error">Invalid JSON — fix the syntax to apply changes</div>
                      )}
                    </div>

                    <div className="inspector-clean-field">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500' }}>
                        <input type="checkbox" disabled />
                        Run in chain (add more tools below)
                      </label>
                    </div>
                  </>
                )}

                <button className="inspector-clean-button" onClick={run} disabled={running || !selectedGateway || !selectedTool}>
                  {running ? 'Executing…' : 'Execute Tool'}
                </button>
              </div>

              {error && <div className="inspector-clean-error-banner">❌ Error: {error}</div>}
            </div>
          </div>

          {/* Right Panel: Output Tabs */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">Output</div>
            </div>
            <div className="inspector-clean-output">
              <div className="inspector-clean-output-tabs">
                {['Response', 'Request', 'Trace', 'Logs', 'Performance', 'Diff'].map((tab) => (
                  <div
                    key={tab}
                    className={`inspector-clean-output-tab ${outputTab === tab.toLowerCase() ? 'active' : ''}`}
                    onClick={() => setOutputTab(tab.toLowerCase())}
                  >
                    {tab}
                  </div>
                ))}
              </div>

              <div className="inspector-clean-output-content">
                {!result && !error && <div style={{ color: 'var(--th-text-muted)', fontSize: '12px' }}>Execute a tool to see results</div>}

                {result && outputTab === 'response' && (
                  <pre>{JSON.stringify(result.response || result, null, 2)}</pre>
                )}

                {result && outputTab === 'request' && (
                  <pre>
                    {JSON.stringify(
                      {
                        method: 'POST',
                        url: '/api/agent-gateway/invoke',
                        body: result.request || { tool: selectedTool, parameters },
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}

                {result && outputTab === 'trace' && (
                  <pre>{JSON.stringify(result.trace || {}, null, 2)}</pre>
                )}

                {result && outputTab === 'logs' && (
                  <pre>{result.logs || 'No logs available'}</pre>
                )}

                {result && outputTab === 'performance' && (
                  <pre>
                    {JSON.stringify(
                      {
                        durationMs: result.durationMs || 0,
                        gatewayTime: result.gatewayTime || 0,
                        toolTime: result.toolTime || 0,
                        parseTime: result.parseTime || 0,
                      },
                      null,
                      2,
                    )}
                  </pre>
                )}

                {result && outputTab === 'diff' && (
                  <div style={{ fontSize: '11px' }}>
                    {invocationHistory.length < 2 ? (
                      <div style={{ color: 'var(--th-text-muted)' }}>Need at least 2 invocations to compare</div>
                    ) : (
                      <pre>
                        {JSON.stringify(
                          {
                            previous: invocationHistory[invocationHistory.length - 2],
                            current: invocationHistory[invocationHistory.length - 1],
                          },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Movie Reel */}
        <div className="inspector-clean-reel">
          <div className="inspector-clean-reel-label">Recent Invocations</div>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
            {invocationHistory.slice(-4).map((entry) => (
              <div
                key={entry.id}
                className={`inspector-clean-reel-frame ${activeReelId === entry.id ? 'active' : ''}`}
                onClick={() => selectReelEntry(entry)}
                style={{ cursor: 'pointer' }}
              >
                {entry.tool} → {entry.outcome} ({entry.durationMs}ms)
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
