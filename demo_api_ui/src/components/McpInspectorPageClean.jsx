// MCP Inspector — Clean Design
// Modern minimal three-pane layout with movie reel history and expanded tabs
import React, { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInspectorSource } from '../hooks/useInspectorSource';
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

function McpInspectorPageClean() {
  const [searchParams] = useSearchParams();
  const [activeSource, setActiveSource] = useState(searchParams.get('source') || 'banking');
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [outputFontSize, setOutputFontSize] = useState(13);
  const highlightJSON = (json) => json.replace(/"([^"]+)":/g, '<span style="color: #6ba3ff;">\"$1\"</span>:').replace(/: "([^"]+)"/g, ': <span style="color: #51b552;">\"$1\"</span>').replace(/: (\d+)/g, ': <span style="color: #d4a574;">$1</span>').replace(/: (true|false)/g, ': <span style="color: #ce7edb;">$1</span>').replace(/: null/g, ': <span style="color: #888;">null</span>');

  // Use unified hook for current source
  const source = useInspectorSource(activeSource);

  // Handle source switch
  const handleSourceChange = useCallback((newSource) => {
    setActiveSource(newSource);
    setActiveHistoryId(null);
  }, []);

  const selectHistoryEntry = useCallback((entry) => {
    const tool = source.tools.find(t => t[source.config.toolKey] === entry.tool);
    if (tool) {
      source.setSelectedTool(tool);
      setActiveHistoryId(entry.id);
      source.setOutputTab('response');
    }
  }, [source]);

  return (
    <div className="inspector-clean-page">
      <div className="inspector-clean-header">
        <h1 className="inspector-clean-title">MCP Inspector</h1>
        <div className="inspector-clean-tabs">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              className={`inspector-clean-tab ${activeSource === s.key ? 'active' : ''}`}
              onClick={() => handleSourceChange(s.key)}
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
              <div className="inspector-clean-panel-label">Tools ({source.tools.length})</div>
            </div>
            <div className="inspector-clean-panel-body">
              {source.loadingTools ? (
                <div style={{ color: 'var(--inspector-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                  Loading tools...
                </div>
              ) : source.tools.length === 0 ? (
                <div style={{ color: 'var(--inspector-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                  No tools available
                </div>
              ) : (
                source.tools.map((tool) => (
                  <div
                    key={tool[source.config.toolKey]}
                    className={`inspector-clean-item ${source.selectedTool?.[source.config.toolKey] === tool[source.config.toolKey] ? 'active' : ''}`}
                    onClick={() => {
                      source.setSelectedTool(tool);
                      source.setParamValues({});
                    }}
                  >
                    {tool[source.config.toolKey]}
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
              {source.selectedTool ? (
                <div className="inspector-clean-form">
                  <div className="inspector-clean-form-section">
                    <div className="inspector-clean-section-title">{source.selectedTool[source.config.toolKey]}</div>
                    {source.selectedTool.description && (
                      <div style={{ fontSize: '12px', color: 'var(--inspector-text-secondary)', marginBottom: '12px' }}>
                        {source.selectedTool.description}
                      </div>
                    )}
                    {Object.entries(source.schemaProps).map(([key, schema]) => (
                      <div key={key} className="inspector-clean-field">
                        <div className="inspector-clean-field-label">
                          <span>{key}{source.requiredParams.has(key) ? ' *' : ''}</span>
                          <span className="inspector-clean-field-type">{schema?.type || ''}</span>
                        </div>
                        <input
                          type="text"
                          placeholder={schema?.description || schema?.type || 'value'}
                          value={source.paramValues[key] || ''}
                          onChange={(e) => source.setParamValues(prev => ({
                            ...prev,
                            [key]: e.target.value,
                          }))}
                        />
                      </div>
                    ))}
                    {Object.keys(source.schemaProps).length === 0 && (
                      <div style={{ color: 'var(--inspector-text-tertiary)', fontSize: '12px' }}>
                        No parameters required
                      </div>
                    )}
                  </div>
                  <button
                    className="inspector-clean-button"
                    onClick={source.handleExecute}
                    disabled={source.busy}
                  >
                    {source.busy ? 'Calling...' : 'Execute Call'}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--th-border)' }}>
                  <div className="inspector-clean-output-tabs">
                    {OUTPUT_TABS.map((t) => (
                      <button
                        key={t.key}
                        className={`inspector-clean-output-tab ${source.outputTab === t.key ? 'active' : ''}`}
                        onClick={() => source.setOutputTab(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', padding: '8px 12px' }}>
                    <button onClick={() => setOutputFontSize(Math.max(10, outputFontSize - 1))} style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', border: '1px solid var(--th-border)', background: 'var(--th-bg-inset)', borderRadius: '4px' }}>−</button>
                    <span style={{ fontSize: '12px', minWidth: '30px', textAlign: 'center', lineHeight: '1.5' }}>{outputFontSize}px</span>
                    <button onClick={() => setOutputFontSize(Math.min(20, outputFontSize + 1))} style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer', border: '1px solid var(--th-border)', background: 'var(--th-bg-inset)', borderRadius: '4px' }}>+</button>
                  </div>
                </div>
                {source.outputContent ? (
                  <>
                    <pre className="inspector-clean-code" style={{ fontSize: `${outputFontSize}px` }}>{source.outputContent}</pre>
                    <div className="inspector-clean-meta">
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Status</div>
                        <div className="inspector-clean-meta-value">
                          {source.lastTiming?.error ? 'Error' : source.lastTiming ? '200 OK' : '-'}
                        </div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Duration</div>
                        <div className="inspector-clean-meta-value">
                          {source.lastTiming?.ms != null ? `${source.lastTiming.ms}ms` : '-'}
                        </div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Transport</div>
                        <div className="inspector-clean-meta-value">WebSocket JSON-RPC</div>
                      </div>
                      <div className="inspector-clean-meta-item">
                        <div className="inspector-clean-meta-label">Size</div>
                        <div className="inspector-clean-meta-value">
                          {source.outputContent ? Math.ceil(source.outputContent.length / 10) * 10 + 'B' : '-'}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--inspector-text-secondary)', padding: '20px', textAlign: 'center' }}>
                    {source.selectedTool ? 'Click Execute to see the response' : 'Select and execute a tool'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Movie Reel */}
        <div className="inspector-clean-reel">
          <div className="inspector-clean-reel-label">History</div>
          {source.mcpHistory.length === 0 ? (
            <div style={{ color: 'var(--inspector-text-tertiary)', fontSize: '11px' }}>No calls yet</div>
          ) : (
            source.mcpHistory.slice(-20).reverse().map((entry) => (
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
