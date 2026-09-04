import React, { useEffect, useMemo, useState } from 'react';
import { useThemeOptional } from '../context/ThemeContext';
import { useAgentGatewayInspector } from '../hooks/useAgentGatewayInspector';
import { useInspectorFields } from '../context/InspectorFieldContext';
import './AgentGatewayInspectorClean.css';

export default function AgentGatewayInspectorClean({ gatewayId = '' }) {
  const theme = useThemeOptional();
  const { registerFields, getMatchingFields } = useInspectorFields();
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

  // Register result fields for other inspectors to use
  useEffect(() => {
    if (result?.data) {
      registerFields('agent-gateway', result.data);
    }
  }, [result, registerFields]);

  // Auto-populate parameters from other inspector results
  useEffect(() => {
    if (!selectedTool) return;
    const paramNames = selectedTool.parameters ? Object.keys(selectedTool.parameters) : [];
    const matches = getMatchingFields(paramNames);
    Object.entries(matches).forEach(([key, value]) => {
      if (!parameters[key]) {
        updateParameter(key, String(value));
      }
    });
  }, [selectedTool, getMatchingFields, parameters, updateParameter]);

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
  const [outputFontSize, setOutputFontSize] = useState(13);

  // Re-sync the text only when parameters change from outside the textarea
  // (tool switch, reel restore) — not on every keystroke's parse round-trip.
  useEffect(() => {
    setParamsText(JSON.stringify(parameters, null, 2));
    setParamsError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool, activeReelId]);

  const highlightJSON = (json) => json.replace(/"([^"]+)":/g, '<span style="color: #0066cc;">\"$1\"</span>:').replace(/: "([^"]+)"/g, ': <span style="color: #009900;">\"$1\"</span>').replace(/: (\d+)/g, ': <span style="color: #cc6600;">$1</span>').replace(/: (true|false)/g, ': <span style="color: #993399;">$1</span>').replace(/: null/g, ': <span style="color: #666666;">null</span>');

  return (
    <div className="inspector-clean-page">
      {/* Header */}
      <div className="inspector-clean-header">
        <div className="inspector-clean-title">Agent Gateway Inspector</div>
        <div className="inspector-clean-header-controls">
          <button className="inspector-clean-theme-toggle" onClick={theme.toggleDarkMode} title="Toggle dark mode">
            {theme.darkMode ? '☀️ Light' : '🌙 Dark'}
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

              {selectedTool && (
                <div style={{ padding: '8px 10px', background: 'var(--th-bg-inset)', borderRadius: '6px', fontSize: '12px', color: 'var(--th-text-muted)', lineHeight: 1.4 }}>
                  {filteredTools.find((t) => t.name === selectedTool)?.description || 'No description available'}
                </div>
              )}

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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--th-border)' }}>
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
                <div style={{ display: 'flex', gap: '6px', padding: '8px 12px' }}>
                  <button onClick={() => setOutputFontSize(Math.max(10, outputFontSize - 1))} style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', border: '1px solid var(--th-border)', background: 'var(--th-bg-inset)', borderRadius: '4px' }}>−</button>
                  <span style={{ fontSize: '12px', minWidth: '30px', textAlign: 'center', lineHeight: '1.5' }}>{outputFontSize}px</span>
                  <button onClick={() => setOutputFontSize(Math.min(20, outputFontSize + 1))} style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', border: '1px solid var(--th-border)', background: 'var(--th-bg-inset)', borderRadius: '4px' }}>+</button>
                </div>
              </div>

              <div className="inspector-clean-output-content" style={{ fontSize: `${outputFontSize}px` }}>
                {!result && !error && <div style={{ color: 'var(--th-text-muted)', fontSize: '12px' }}>Execute a tool to see results</div>}

                {result && outputTab === 'response' && (
                  <pre dangerouslySetInnerHTML={{ __html: highlightJSON(JSON.stringify(result.response || result, null, 2)) }} />
                )}

                {result && outputTab === 'request' && (
                  <pre dangerouslySetInnerHTML={{ __html: highlightJSON(JSON.stringify({
                        method: 'POST',
                        url: '/api/agent-gateway/invoke',
                        body: result.request || { tool: selectedTool, parameters },
                      }, null, 2)) }} />
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
