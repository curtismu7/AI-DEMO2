// banking_api_ui/src/components/PingOneMcpInspector.js
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import apiClient from '../services/apiClient';
import { notifyError } from '../utils/appToast';
import { formatAxiosError } from '../utils/formatAxiosError';
import PageNav from './PageNav';
import JsonHighlight from './shared/JsonHighlight';
import '../styles/appShellPages.css';
import './McpInspector.css';
import './PingOneMcpInspector.css';

/**
 * PingOne MCP Inspector — calls the hosted PingOne MCP server over HTTP (via the BFF)
 * and shows the raw tools/list request + response. Live querying is gated by the
 * page-only mcp_inspector_pingone_live flag (default ON) and can be toggled
 * right on the page. The returned tools render as clickable chips; selecting a
 * chip opens a schema-driven form to invoke the tool and inspect the JSON-RPC
 * request/response pair.
 */

/** Collapsible page section backed by <details> (no extra state to manage). */
const Section = ({ title, hint, status, defaultOpen = true, children }) => (
  <details className="p1mcp-section" open={defaultOpen}>
    <summary>
      <span className="p1mcp-section__title">{title}</span>
      {status && <span className={`p1mcp-section__status p1mcp-section__status--${status}`}>{status === 'ok' ? '✓ received' : status === 'error' ? '✗ error' : status}</span>}
      {hint && <span className="p1mcp-section__hint">{hint}</span>}
    </summary>
    <div className="p1mcp-section__body">{children}</div>
  </details>
);

/**
 * Coerce a text-input value to the schema-declared type so booleans/numbers/
 * objects reach the server typed, not stringly. Empty inputs are omitted.
 */
const coerceParam = (raw, type) => {
  if (raw === '') return undefined;
  if (type === 'number' || type === 'integer') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'object' || type === 'array') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
};

const isDavinciTool = (name) => name.includes('Davinci') || name.includes('davinci');

const TABS = [
  { id: 'platform', label: 'PingOne' },
  { id: 'davinci', label: 'DaVinci' },
];

// Sub-tabs under the PingOne tab: tools are bucketed by the resource in their
// name (first match wins). Matching is case-sensitive on the PascalCase
// resource token (e.g. 'User' in manageUserMfa) so a lowercased substring
// inside an unrelated word can't mis-bucket a tool. 'Other' catches the rest.
const PLATFORM_GROUPS = [
  { id: 'environments', label: 'Environments', match: (n) => n.includes('Environment') },
  { id: 'applications', label: 'Applications', match: (n) => n.includes('Application') },
  { id: 'users', label: 'Users', match: (n) => n.includes('User') },
  { id: 'populations', label: 'Populations', match: (n) => n.includes('Population') },
  { id: 'other', label: 'Other', match: () => true },
];

// The trailing 'other' group always matches, so find() never returns undefined.
const platformGroupId = (name) => PLATFORM_GROUPS.find((g) => g.match(name)).id;

const PingOneMcpInspector = ({ user, onLogout }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [activeTab, setActiveTab] = useState('platform');
  // 'all' shows every PingOne tool; the rest filter by resource group.
  const [platformGroup, setPlatformGroup] = useState('all');

  // Tool invocation state
  const [selectedTool, setSelectedTool] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [calling, setCalling] = useState(false);
  const [lastCall, setLastCall] = useState(null);
  // Client-side required-param message; blocks the call before any network.
  const [formError, setFormError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/mcp/inspector/pingone-tools');
      setData(res.data);
      // The catalog may have changed shape — drop any group/tool selection that
      // could now point at a group with no tools (empty chip list).
      setPlatformGroup('all');
      setSelectedTool(null);
      setLastCall(null);
      setFormError(null);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to query the PingOne MCP server'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabled = data?.enabled;
  const hasError = data?.error;
  const tools = data?.tools || [];

  // Split the catalog and pre-compute sub-tabs once per tools change rather
  // than on every render (selecting a tool / typing a param re-renders often).
  const { platformTools, davinciTools, platformSubTabs } = useMemo(() => {
    const platform = tools.filter((t) => !isDavinciTool(t.name));
    const davinci = tools.filter((t) => isDavinciTool(t.name));
    const counts = platform.reduce((acc, t) => {
      const id = platformGroupId(t.name);
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});
    // 'All' first, then only the resource groups that actually have tools.
    const subTabs = [
      { id: 'all', label: 'All', count: platform.length },
      ...PLATFORM_GROUPS.filter((g) => counts[g.id]).map((g) => ({
        id: g.id,
        label: g.label,
        count: counts[g.id],
      })),
    ];
    return { platformTools: platform, davinciTools: davinci, platformSubTabs: subTabs };
  }, [tools]);

  const visibleTools =
    activeTab === 'davinci'
      ? davinciTools
      : platformGroup === 'all'
      ? platformTools
      : platformTools.filter((t) => platformGroupId(t.name) === platformGroup);

  // Flip the page-only mcp_inspector_pingone_live flag, then re-query so the
  // catalog reflects the new state immediately.
  const toggleLiveQuery = useCallback(async () => {
    setToggling(true);
    try {
      await apiClient.patch('/api/admin/feature-flags', {
        updates: { mcp_inspector_pingone_live: !enabled },
      });
      await refresh();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to toggle live querying'));
    } finally {
      setToggling(false);
    }
  }, [enabled, refresh]);

  const switchTab = (tabId) => {
    setActiveTab(tabId);
    setPlatformGroup('all');
    setSelectedTool(null);
    setLastCall(null);
    setFormError(null);
  };

  const switchPlatformGroup = (groupId) => {
    setPlatformGroup(groupId);
    setSelectedTool(null);
    setLastCall(null);
    setFormError(null);
  };

  const selectTool = (tool) => {
    setSelectedTool(tool);
    // Seed inputs with values the BFF already knows (e.g. the demo's
    // environmentId) so required UUIDs don't have to be pasted by hand.
    const defaults = data?.paramDefaults || {};
    const props = tool.inputSchema?.properties || {};
    const seeded = {};
    for (const key of Object.keys(props)) {
      if (defaults[key]) seeded[key] = defaults[key];
    }
    setParamValues(seeded);
    setFormError(null);
    setLastCall(null);
  };

  const callTool = useCallback(async () => {
    if (!selectedTool) return;
    const props = selectedTool.inputSchema?.properties || {};
    const required = selectedTool.inputSchema?.required || [];
    const missing = required.filter((key) => !(paramValues[key] ?? '').trim());
    if (missing.length > 0) {
      setFormError(`Required: ${missing.join(', ')}`);
      return;
    }
    setFormError(null);
    const params = {};
    for (const [key, schema] of Object.entries(props)) {
      const coerced = coerceParam(paramValues[key] ?? '', schema?.type);
      if (coerced !== undefined) params[key] = coerced;
    }
    setCalling(true);
    try {
      const res = await apiClient.post('/api/mcp/inspector/pingone-invoke', {
        tool: selectedTool.name,
        params,
      });
      setLastCall(res.data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'tools/call failed'));
      setLastCall(null);
    } finally {
      setCalling(false);
    }
  }, [selectedTool, paramValues]);

  const schemaProps = selectedTool?.inputSchema?.properties || {};
  const requiredParams = new Set(selectedTool?.inputSchema?.required || []);

  const tabCounts = { platform: platformTools.length, davinci: davinciTools.length };

  // Single source of truth for the invoke button so it can render both above
  // the tool chips and inside the tool card without drifting.
  const callButton = selectedTool ? (
    <button
      type="button"
      className="mcp-inspector__btn"
      onClick={callTool}
      disabled={calling || !enabled}
      title={enabled ? `Invoke ${selectedTool.name}` : 'Enable live querying first'}
    >
      {calling ? 'Calling…' : `Call ${selectedTool.name}`}
    </button>
  ) : null;

  return (
    <div className="mcp-inspector-page app-page-shell">
      <PageNav user={user} onLogout={onLogout} title="PingOne MCP Inspector" />
      <header className="app-page-shell__hero">
        <div className="app-page-shell__hero-top">
          <div>
            <h1 className="app-page-shell__title">PingOne MCP Inspector</h1>
            <div className="app-page-shell__lead">
              Calls the hosted <strong>PingOne MCP server</strong> over HTTP through the
              Backend-for-Frontend (BFF) and returns its <code>tools/list</code>. Live querying is on
              by default (<code>mcp_inspector_pingone_live</code> flag, page-only). Click a tool chip
              below to invoke it.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {data && (
              <button
                type="button"
                className="mcp-inspector__btn"
                onClick={toggleLiveQuery}
                disabled={toggling || loading}
                aria-pressed={!!enabled}
                title="Turns live querying of the PingOne MCP server on or off for this page only"
              >
                {toggling ? 'Switching…' : `Live query: ${enabled ? 'On' : 'Off'}`}
              </button>
            )}
            <button type="button" className="mcp-inspector__btn" onClick={refresh} disabled={loading}>
              {loading ? 'Querying…' : 'Refresh tools/list'}
            </button>
          </div>
        </div>
      </header>

      {data && !enabled && (
        <section className="mcp-inspector__notice mcp-inspector__notice--warn">
          <strong>Live querying is off.</strong> {data.reason}
        </section>
      )}
      {data && enabled && hasError && (
        <section className="mcp-inspector__notice mcp-inspector__notice--error">
          <strong>PingOne MCP server unreachable.</strong> {data.reason}
        </section>
      )}

      <Section
        title={`Tools (${tools.length})`}
        hint="Click a chip to inspect and invoke a tool"
      >
        {tools.length === 0 ? (
          <p className="mcp-inspector__muted">No tools returned yet — enable live querying and refresh.</p>
        ) : (
          <>
            <div className="p1mcp-tabs" role="tablist">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={activeTab === tab.id}
                  className={`p1mcp-tab ${activeTab === tab.id ? 'p1mcp-tab--active' : ''}`}
                  onClick={() => switchTab(tab.id)}
                >
                  {tab.label}
                  <span className="p1mcp-tab__count">{tabCounts[tab.id]}</span>
                </button>
              ))}
            </div>

            {activeTab === 'platform' && platformSubTabs.length > 1 && (
              <div className="p1mcp-subtabs" role="tablist">
                {platformSubTabs.map((sub) => (
                  <button
                    key={sub.id}
                    role="tab"
                    type="button"
                    aria-selected={platformGroup === sub.id}
                    className={`p1mcp-subtab ${platformGroup === sub.id ? 'p1mcp-subtab--active' : ''}`}
                    onClick={() => switchPlatformGroup(sub.id)}
                  >
                    {sub.label}
                    <span className="p1mcp-tab__count">{sub.count}</span>
                  </button>
                ))}
              </div>
            )}

            {callButton && (
              <div className="p1mcp-chips-callbar">{callButton}</div>
            )}

            <div className="p1mcp-chips">
              {visibleTools.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`p1mcp-chip ${selectedTool?.name === t.name ? 'p1mcp-chip--active' : ''}`}
                  title={t.description || t.name}
                  onClick={() => selectTool(t)}
                >
                  {t.name}
                </button>
              ))}
              {visibleTools.length === 0 && (
                <p className="mcp-inspector__muted">
                  No {activeTab === 'davinci' ? 'DaVinci' : 'platform'} tools returned.
                  {activeTab === 'davinci' && ' DaVinci Admin role required.'}
                </p>
              )}
            </div>

            {selectedTool && (
              <div className="p1mcp-tool-card">
                <div className="p1mcp-tool-card__name">{selectedTool.name}</div>
                {selectedTool.description && (
                  <p className="p1mcp-tool-card__desc">{selectedTool.description}</p>
                )}

                {Object.keys(schemaProps).length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    {Object.entries(schemaProps).map(([key, schema]) => (
                      <div className="p1mcp-param-row" key={key}>
                        <label htmlFor={`p1mcp-param-${key}`}>
                          {key}
                          {requiredParams.has(key) && <span className="p1mcp-required"> *</span>}
                        </label>
                        <input
                          id={`p1mcp-param-${key}`}
                          type="text"
                          placeholder={schema?.description || schema?.type || 'value'}
                          value={paramValues[key] ?? ''}
                          onChange={(e) =>
                            setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                        />
                        <span className="p1mcp-param-type">{schema?.type || ''}</span>
                      </div>
                    ))}
                  </div>
                )}

                {callButton}
                {formError && (
                  <div className="p1mcp-call-status p1mcp-call-status--error">{formError}</div>
                )}

                {lastCall && (
                  <>
                    <div className={`p1mcp-call-status ${lastCall.error ? 'p1mcp-call-status--error' : ''}`}>
                      {lastCall.error
                        ? lastCall.reason
                        : `Completed in ${lastCall.timingsMs?.roundTrip ?? '?'} ms`}
                    </div>
                    <Section title="Call request" hint="JSON-RPC tools/call sent over HTTP" status="ok" defaultOpen>
                      <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={lastCall.request} deep /></pre>
                    </Section>
                    <Section title="Call response" status={lastCall.error ? 'error' : 'ok'} defaultOpen>
                      {lastCall.response ? (
                        <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={lastCall.response} deep /></pre>
                      ) : (
                        <p className="mcp-inspector__muted">No JSON-RPC response (transport-level failure).</p>
                      )}
                    </Section>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Discovery request" hint="JSON-RPC tools/list sent over HTTP" status={data ? 'ok' : undefined} defaultOpen={false}>
        <pre className="mcp-inspector__code jh-dark">
          <JsonHighlight value={data?.request || { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }} deep />
        </pre>
      </Section>

      <Section title="Discovery response" status={data?.response ? (data.error ? 'error' : 'ok') : undefined} defaultOpen={false}>
        {data?.response ? (
          <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={data.response} deep /></pre>
        ) : (
          <p className="mcp-inspector__muted">
            No response yet{enabled === false ? ' — enable live querying and refresh.' : '.'}
          </p>
        )}
      </Section>
    </div>
  );
};

export default PingOneMcpInspector;
