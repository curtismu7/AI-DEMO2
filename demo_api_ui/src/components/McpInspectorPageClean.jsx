// MCP Inspector — Clean Design
// Modern minimal three-pane layout with movie reel history and expanded tabs
import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInspectorSource } from '../hooks/useInspectorSource';
import { useInspectorFields } from '../context/InspectorFieldContext';
import { useThemeOptional } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import './McpInspectorPage.clean.css';

const NEW_PROFILE_DEFAULTS = {
  label: '',
  transport: 'http',
  url: '',
  authHeader: 'Authorization',
  authValue: '',
  command: '',
  argsText: '',
};

const SOURCES = [
  { key: 'banking', label: 'AI Demo MCP' },
  { key: 'pingone', label: 'PingOne MCP' },
  { key: 'api', label: 'API Calls' },
  { key: 'custom', label: 'Custom Server' },
  { key: 'protocol', label: 'Protocol' },
  // One tab for BOTH gateway-fronted third-party servers. They are the same
  // story told twice — PingGateway scoping a server it does not own — and
  // Brave exposes a single tool, which is a thin thing to give a tab of its own.
  { key: 'gateway', label: 'Gateway Showcase' },
];

const OUTPUT_TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'schema', label: 'Schema' },
  { key: 'timing', label: 'Timing' },
  { key: 'headers', label: 'Headers' },
];

/**
 * Tools bucketed by `config.groupBy`, preserving first-seen order so the tree
 * matches the order the BFF returned the servers in. A source without groupBy
 * gets one unlabelled group, which renders identically to the old flat list.
 */
function groupsFor(source) {
  const key = source.config.groupBy;
  if (!key) return [{ label: null, tools: source.tools }];
  const order = [];
  const byLabel = new Map();
  for (const t of source.tools) {
    const label = t[key] || 'Other';
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label).push(t);
  }
  return order.map((label) => ({ label, tools: byLabel.get(label) }));
}

function McpInspectorPageClean() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [searchParams] = useSearchParams();
  const [activeSource, setActiveSource] = useState(searchParams.get('source') || 'banking');
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [outputFontSize, setOutputFontSize] = useState(13);
  const highlightJSON = (json) => json.replace(/"([^"]+)":/g, '<span style="color: #0066cc;">\"$1\"</span>:').replace(/: "([^"]+)"/g, ': <span style="color: #009900;">\"$1\"</span>').replace(/: (\d+)/g, ': <span style="color: #cc6600;">$1</span>').replace(/: (true|false)/g, ': <span style="color: #993399;">$1</span>').replace(/: null/g, ': <span style="color: #666666;">null</span>');
  const { registerFields, getMatchingFields } = useInspectorFields();

  // Custom Server tab: saved MCP server profiles (see mcpProfileStore.js).
  // Loaded regardless of activeSource (cheap, unauthenticated GET) so the
  // picker is ready the moment the user switches to the Custom tab.
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [showAddServer, setShowAddServer] = useState(false);
  const [newProfile, setNewProfile] = useState(NEW_PROFILE_DEFAULTS);
  const [addProfileError, setAddProfileError] = useState(null);
  const [addProfileBusy, setAddProfileBusy] = useState(false);

  const loadProfiles = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/mcp/inspector/profiles');
      setProfiles(data.profiles || []);
      setSelectedProfileId((prev) => prev || data.defaultProfileId || '');
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to load MCP server profiles'));
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const handleAddProfile = useCallback(async () => {
    setAddProfileError(null);
    const { label, transport, url, authHeader, authValue, command, argsText } = newProfile;
    const body = { label: label.trim(), transport };
    if (transport === 'stdio') {
      if (!command.trim()) {
        setAddProfileError('Command is required.');
        return;
      }
      body.command = command.trim();
      body.args = argsText.trim() ? argsText.trim().split(/\s+/) : [];
    } else {
      if (!url.trim()) {
        setAddProfileError('Server URL is required.');
        return;
      }
      body.url = url.trim();
      if (authHeader.trim() && authValue.trim()) {
        body.authHeader = authHeader.trim();
        body.authValue = authValue.trim();
      }
    }
    setAddProfileBusy(true);
    try {
      const { data } = await apiClient.post('/api/mcp/inspector/profiles', body);
      await loadProfiles();
      setSelectedProfileId(data.profile.id);
      setShowAddServer(false);
      setNewProfile(NEW_PROFILE_DEFAULTS);
    } catch (e) {
      setAddProfileError(formatAxiosError(e, 'Failed to add server'));
    } finally {
      setAddProfileBusy(false);
    }
  }, [newProfile, loadProfiles]);

  const handleDeleteProfile = useCallback(async (profileId) => {
    try {
      await apiClient.delete(`/api/mcp/inspector/profiles/${profileId}`);
      setSelectedProfileId((prev) => (prev === profileId ? '' : prev));
      await loadProfiles();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to delete server'));
    }
  }, [loadProfiles]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) || null;

  // Use unified hook for current source
  const source = useInspectorSource(
    activeSource,
    activeSource === 'custom' ? { profileId: selectedProfileId } : undefined,
  );

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

  // Register result fields for other inspectors to use
  useEffect(() => {
    if (source.result?.data) {
      registerFields(`mcp-${activeSource}`, source.result.data);
    }
  }, [source.result, activeSource, registerFields]);

  // Auto-populate parameters from other inspector results
  useEffect(() => {
    if (!source.selectedTool) return;
    const paramNames = source.selectedTool.parameters ? Object.keys(source.selectedTool.parameters) : [];
    const matches = getMatchingFields(paramNames);
    Object.entries(matches).forEach(([key, value]) => {
      if (!source.parameters[key]) {
        source.updateParameter(key, String(value));
      }
    });
  }, [source.selectedTool, getMatchingFields, source.parameters, source.updateParameter]);

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
        <button
          type="button"
          onClick={toggleDarkMode}
          className="inspector-clean-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
      </div>

      {activeSource === 'custom' && (
        <div className="inspector-clean-custom-bar">
          <label htmlFor="custom-profile-select" style={{ fontSize: '12px', color: 'var(--inspector-text-secondary)' }}>
            Server:
          </label>
          <select
            id="custom-profile-select"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
          >
            {profiles.length === 0 && <option value="">No servers yet</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="inspector-clean-button"
            style={{ padding: '6px 12px' }}
            onClick={() => setShowAddServer((v) => !v)}
          >
            {showAddServer ? 'Cancel' : '+ Add server'}
          </button>
          {selectedProfile && !selectedProfile.isBuiltIn && (
            <button
              type="button"
              className="inspector-clean-button"
              style={{ padding: '6px 12px', background: 'var(--th-status-error-text)' }}
              onClick={() => handleDeleteProfile(selectedProfile.id)}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {activeSource === 'custom' && showAddServer && (
        <div className="inspector-clean-custom-add">
          <div className="inspector-clean-field">
            <div className="inspector-clean-field-label"><span>Label</span></div>
            <input
              type="text"
              value={newProfile.label}
              onChange={(e) => setNewProfile((p) => ({ ...p, label: e.target.value }))}
              placeholder="e.g. banking-rest2 (Privilege)"
            />
          </div>
          <div className="inspector-clean-field">
            <div className="inspector-clean-field-label"><span>Transport</span></div>
            <select
              value={newProfile.transport}
              onChange={(e) => setNewProfile((p) => ({ ...p, transport: e.target.value }))}
            >
              <option value="http">http</option>
              <option value="websocket">websocket</option>
              <option value="stdio">stdio</option>
            </select>
          </div>
          {newProfile.transport === 'stdio' ? (
            <>
              <div className="inspector-clean-field">
                <div className="inspector-clean-field-label"><span>Command</span></div>
                <input
                  type="text"
                  value={newProfile.command}
                  onChange={(e) => setNewProfile((p) => ({ ...p, command: e.target.value }))}
                  placeholder="node"
                />
              </div>
              <div className="inspector-clean-field">
                <div className="inspector-clean-field-label"><span>Args</span></div>
                <input
                  type="text"
                  value={newProfile.argsText}
                  onChange={(e) => setNewProfile((p) => ({ ...p, argsText: e.target.value }))}
                  placeholder="server.js --stdio"
                />
              </div>
            </>
          ) : (
            <>
              <div className="inspector-clean-field">
                <div className="inspector-clean-field-label"><span>Server URL</span></div>
                <input
                  type="text"
                  value={newProfile.url}
                  onChange={(e) => setNewProfile((p) => ({ ...p, url: e.target.value }))}
                  placeholder="https://mcpgw.ai-demo.ping-devops.com/banking-rest2/mcp"
                />
              </div>
              <div className="inspector-clean-field">
                <div className="inspector-clean-field-label"><span>Auth header</span></div>
                <input
                  type="text"
                  value={newProfile.authHeader}
                  onChange={(e) => setNewProfile((p) => ({ ...p, authHeader: e.target.value }))}
                  placeholder="Authorization"
                />
              </div>
              <div className="inspector-clean-field">
                <div className="inspector-clean-field-label"><span>Auth value</span></div>
                <input
                  type="password"
                  value={newProfile.authValue}
                  onChange={(e) => setNewProfile((p) => ({ ...p, authValue: e.target.value }))}
                  placeholder="Bearer ..."
                />
              </div>
            </>
          )}
          <button
            type="button"
            className="inspector-clean-button"
            onClick={handleAddProfile}
            disabled={addProfileBusy}
          >
            {addProfileBusy ? 'Saving...' : 'Save'}
          </button>
          {addProfileError && <div className="inspector-clean-custom-error">{addProfileError}</div>}
        </div>
      )}

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
                // A source may declare groupBy (Gateway Showcase groups by
                // server). Without it the list renders flat exactly as before —
                // groupsFor() returns a single unlabelled group.
                groupsFor(source).map(({ label, tools }) => (
                  <div key={label || '_flat'}>
                    {label && <div className="inspector-clean-group-label">{label}</div>}
                    {tools.map((tool) => (
                      <div
                        key={`${label || ''}:${tool[source.config.toolKey]}`}
                        className={`inspector-clean-item ${source.selectedTool?.[source.config.toolKey] === tool[source.config.toolKey] ? 'active' : ''}`}
                        onClick={() => {
                          source.setSelectedTool(tool);
                          source.setParamValues({});
                        }}
                      >
                        {tool[source.config.toolKey]}
                      </div>
                    ))}
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
