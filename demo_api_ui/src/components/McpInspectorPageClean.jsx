// MCP Inspector — Clean Design
// Modern minimal three-pane layout with movie reel history and expanded tabs
import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInspectorSource } from '../hooks/useInspectorSource';
import { useInspectorFields } from '../context/InspectorFieldContext';
import { useThemeOptional } from '../context/ThemeContext';
import useDividerDrag from '../hooks/useDividerDrag';
import JsonHighlight from './shared/JsonHighlight';
import JsonFormView from './shared/JsonFormView';
import apiClient from '../services/apiClient';
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
  {
    key: 'banking', label: 'AI Demo MCP',
    description: "This app's own banking MCP server — the tools the AI agent actually calls.",
  },
  {
    key: 'pingone', label: 'PingOne MCP',
    description: 'The hosted PingOne MCP server, reached with your PingOne admin sign-in.',
  },
  {
    key: 'api', label: 'API Calls',
    description: 'A live log of API calls already captured elsewhere in the app — a read-only history, nothing to execute here.',
  },
  {
    key: 'custom', label: 'Custom Server',
    description: 'Point this at any saved MCP server profile — the built-in Privilege gateway doors, or one you add yourself.',
  },
  {
    key: 'protocol', label: 'Protocol',
    description: 'Test raw MCP protocol methods that are not tools/call — resources, prompts, completion, and log level.',
  },
  // One tab for BOTH gateway-fronted third-party servers. They are the same
  // story told twice — PingGateway scoping a server it does not own — and
  // Brave exposes a single tool, which is a thin thing to give a tab of its own.
  {
    key: 'gateway', label: 'Gateway Showcase',
    description: 'Third-party MCP servers (Weather, Brave) reached through PingGateway, which scopes access to them at the edge.',
  },
];

const OUTPUT_TABS = [
  { key: 'response', label: 'Response' },
  { key: 'request', label: 'Request' },
  { key: 'schema', label: 'Schema' },
  { key: 'timing', label: 'Timing' },
  { key: 'headers', label: 'Headers' },
];

// What the left pane is a list OF. 'calls' mode browses a log, not a toolbox.
const LIST_LABEL = { calls: 'Calls', profiles: 'Tools', tools: 'Tools' };

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
  // Form reads the response as labelled fields; JSON keeps the raw payload.
  // Per-page, not per-source — switching tabs should not reset how you read.
  const [outputView, setOutputView] = useState('json');
  const { registerFields, getMatchingFields } = useInspectorFields();

  // The middle column is the 1fr remainder, so resizing the outer two resizes
  // all three. `invert` on the right handle because that pane sits to the
  // divider's right — dragging toward the start grows it.
  const { size: leftWidth, handleProps: leftHandleProps } = useDividerDrag({
    min: 180, max: 520, initial: 260, storageKey: 'mcp-inspector-col-left',
  });
  const { size: rightWidth, handleProps: rightHandleProps } = useDividerDrag({
    min: 240, max: 720, initial: 350, storageKey: 'mcp-inspector-col-right', invert: true,
  });

  // Use unified hook for current source
  const source = useInspectorSource(activeSource);
  const mode = source.mode || 'tools';

  // Custom Server: adding a new saved profile (websocket/http/stdio). The
  // known Privilege-gateway doors and the built-in PingOne/banking profiles
  // are already seeded server-side (mcpProfileStore.js) and need no form —
  // this is only for a server not already on that list.
  const [showAddServer, setShowAddServer] = useState(false);
  const [newProfile, setNewProfile] = useState(NEW_PROFILE_DEFAULTS);
  const [addProfileError, setAddProfileError] = useState(null);
  const [addProfileBusy, setAddProfileBusy] = useState(false);

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
      await source.loadProfiles(data.profile.id);
      setShowAddServer(false);
      setNewProfile(NEW_PROFILE_DEFAULTS);
    } catch (e) {
      setAddProfileError(formatAxiosError(e, 'Failed to add server'));
    } finally {
      setAddProfileBusy(false);
    }
  }, [newProfile, source]);

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

  // Register result fields for other inspectors to use. This read `source.result`,
  // which the hook has never returned — so smart field propagation (#2650) never
  // fired from this page. `lastInvoke` is the result.
  useEffect(() => {
    const result = source.lastInvoke?.result ?? source.lastInvoke;
    if (result && typeof result === 'object') {
      registerFields(`mcp-${activeSource}`, result);
    }
  }, [source.lastInvoke, activeSource, registerFields]);

  // Auto-populate parameters from other inspector results
  useEffect(() => {
    if (!source.selectedTool) return;
    const paramNames = source.selectedTool.parameters ? Object.keys(source.selectedTool.parameters) : [];
    const matches = getMatchingFields(paramNames);
    Object.entries(matches).forEach(([key, value]) => {
      if (!source.paramValues?.[key]) {
        source.setParamValues((prev) => ({ ...prev, [key]: String(value) }));
      }
    });
  }, [source.selectedTool, getMatchingFields, source.paramValues, source.setParamValues]);

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
              title={s.description}
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

      {/* Why a source is empty or refusing, with the sign-in that fixes it when
          there is one. Without this the tab just renders "No tools available"
          and the real cause (an un-completed PingOne admin login) is invisible. */}
      {source.banner && (
        <div className="inspector-clean-banner" role="status">
          <span className="inspector-clean-banner-icon" aria-hidden="true">⚠️</span>
          <span className="inspector-clean-banner-text">{source.banner.message}</span>
          {source.banner.loginUrl && (
            <a className="inspector-clean-banner-action" href={source.banner.loginUrl}>Sign in</a>
          )}
          <button type="button" className="inspector-clean-banner-action" onClick={source.loadTools}>
            Retry
          </button>
        </div>
      )}

      <div className="inspector-clean-content">
        {/* Widths ride as CSS vars on the inline style so the mobile stacking
            media query (which drops to a single column) still wins over them. */}
        <div
          className="inspector-clean-main"
          style={{ '--inspector-col-left': `${leftWidth}px`, '--inspector-col-right': `${rightWidth}px` }}
        >
          {/* Left: Tools Tree */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header">
              <div className="inspector-clean-panel-label">
                {LIST_LABEL[mode] || 'Tools'} ({source.tools.length})
              </div>
            </div>
            {/* Custom Server dispatches to a chosen MCP server profile, so the
                profile has to be pickable before the tool tree means anything. */}
            {mode === 'profiles' && source.profiles.length > 0 && (
              <div className="inspector-clean-panel-subhead">
                <label className="inspector-clean-field-label" htmlFor="inspector-profile">Server profile</label>
                <select
                  id="inspector-profile"
                  value={source.selectedProfileId}
                  onChange={(e) => source.setSelectedProfileId(e.target.value)}
                >
                  {source.profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.label || p.id}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="inspector-clean-button inspector-clean-addserver-toggle"
                  onClick={() => setShowAddServer((v) => !v)}
                >
                  {showAddServer ? 'Cancel' : '+ Add server'}
                </button>
              </div>
            )}
            {mode === 'profiles' && showAddServer && (
              <div className="inspector-clean-panel-subhead inspector-clean-addserver-form">
                <div className="inspector-clean-field">
                  <div className="inspector-clean-field-label"><span>Label</span></div>
                  <input
                    type="text"
                    value={newProfile.label}
                    onChange={(e) => setNewProfile((p) => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. Staging MCP server"
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
                        placeholder="https://example.test/mcp"
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
                {addProfileError && <div className="inspector-clean-addserver-error">{addProfileError}</div>}
              </div>
            )}
            {/* Gateway Showcase fronts two servers; one can 401 while the other
                serves. Per-server status keeps a half-working tab honest. */}
            {source.servers.length > 0 && (
              <div className="inspector-clean-panel-subhead">
                {source.servers.map((s) => (
                  <div key={s.key} className="inspector-clean-server-status">
                    <span className={`inspector-clean-dot ${s.error ? 'error' : 'ok'}`} aria-hidden="true" />
                    <span>{s.label}</span>
                    <span className="inspector-clean-server-detail">{s.error ? s.error : `${s.count} tools`}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="inspector-clean-panel-body">
              {source.loadingTools ? (
                <div style={{ color: 'var(--inspector-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                  Loading tools...
                </div>
              ) : source.tools.length === 0 ? (
                <div style={{ color: 'var(--inspector-text-tertiary)', padding: '20px', textAlign: 'center' }}>
                  {mode === 'calls'
                    ? 'No API calls captured yet. Use the AI agent or a demo page to generate some.'
                    : 'No tools available'}
                </div>
              ) : (
                // A source may declare groupBy (Gateway Showcase groups by
                // server). Without it the list renders flat exactly as before —
                // groupsFor() returns a single unlabelled group.
                groupsFor(source).map(({ label, tools }) => (
                  <div key={label || '_flat'}>
                    {label && <div className="inspector-clean-group-label">{label}</div>}
                    {tools.map((tool, i) => (
                      <div
                        key={`${label || ''}:${tool[source.config.toolKey]}:${i}`}
                        className={`inspector-clean-item ${source.selectedTool === tool ? 'active' : ''}`}
                        onClick={() => {
                          source.setSelectedTool(tool);
                          source.setParamValues({});
                        }}
                      >
                        {tool[source.config.toolKey]}
                        {tool.description && mode === 'calls' && (
                          <span className="inspector-clean-item-detail">{tool.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            className="divider-drag-handle inspector-clean-divider"
            aria-label="Resize tool list column"
            {...leftHandleProps}
          />

          {/* Middle: Form */}
          <div className="inspector-clean-panel">
            <div className="inspector-clean-panel-header inspector-clean-panel-header--action">
              <div className="inspector-clean-panel-label">{mode === 'calls' ? 'Call' : 'Parameters'}</div>
              {/* Sticky header, so this stays visible without scrolling past a
                  long parameter list — a second copy of the same button below
                  the form, not a replacement for it. */}
              {mode !== 'calls' && source.selectedTool && (
                <button
                  className="inspector-clean-button inspector-clean-button--compact"
                  onClick={source.handleExecute}
                  disabled={source.busy}
                >
                  {source.busy ? 'Calling...' : 'Execute Call'}
                </button>
              )}
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
                    {mode === 'calls' ? (
                      // A captured call already happened — there is nothing to
                      // fill in and nothing to execute. Read it on the right.
                      <div style={{ color: 'var(--inspector-text-tertiary)', fontSize: '12px' }}>
                        Already executed. Its request, response and headers are on the right.
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}
                  </div>
                  {mode !== 'calls' && (
                    <button
                      className="inspector-clean-button"
                      onClick={source.handleExecute}
                      disabled={source.busy}
                    >
                      {source.busy ? 'Calling...' : 'Execute Call'}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ color: 'var(--inspector-text-secondary)', padding: '20px', textAlign: 'center' }}>
                  {mode === 'calls' ? 'Select a call to inspect it' : 'Select a tool to see parameters'}
                </div>
              )}
            </div>
          </div>

          <div
            className="divider-drag-handle inspector-clean-divider"
            aria-label="Resize output column"
            {...rightHandleProps}
          />

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
                  <div className="inspector-clean-output-controls">
                    <div className="inspector-clean-viewtoggle" role="group" aria-label="Output view">
                      <button
                        type="button"
                        className={outputView === 'form' ? 'active' : ''}
                        aria-pressed={outputView === 'form'}
                        onClick={() => setOutputView('form')}
                      >
                        Form
                      </button>
                      <button
                        type="button"
                        className={outputView === 'json' ? 'active' : ''}
                        aria-pressed={outputView === 'json'}
                        onClick={() => setOutputView('json')}
                      >
                        JSON
                      </button>
                    </div>
                    <button className="inspector-clean-fontstep" onClick={() => setOutputFontSize(Math.max(10, outputFontSize - 1))} aria-label="Smaller text">−</button>
                    <span className="inspector-clean-fontsize">{outputFontSize}px</span>
                    <button className="inspector-clean-fontstep" onClick={() => setOutputFontSize(Math.min(20, outputFontSize + 1))} aria-label="Larger text">+</button>
                  </div>
                </div>
                {source.outputContent ? (
                  <>
                    {outputView === 'form' ? (
                      <div className="inspector-clean-formview" style={{ fontSize: `${outputFontSize}px` }}>
                        <JsonFormView value={source.outputValue} />
                      </div>
                    ) : (
                      <pre className={`inspector-clean-code${darkMode ? ' jh-dark' : ''}`} style={{ fontSize: `${outputFontSize}px` }}>
                        <JsonHighlight value={source.outputValue} deep copyable />
                      </pre>
                    )}
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
