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
      {status && <span className={`p1mcp-section__status p1mcp-section__status--${status}`}>{status === 'ok' ? '✓ received' : status === 'error' ? 'error' : status}</span>}
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

// Within a tab (or sub-tab) the chips are further split into collapsible groups
// so the wall of tools becomes scannable. Applications is the worst offender
// (~30 tools) so it fans out into its assignment/mapping/credential facets;
// DaVinci fans out by object type. Matching stays case-sensitive on PascalCase
// resource tokens, and order matters — an Application sub-facet must be tested
// before the plain 'Application' fallback so e.g. createApplicationGrant lands
// under Grants, not the core Applications group.
const chipGroupKey = (name) => {
  if (isDavinciTool(name)) {
    if (name.includes('Connector')) return 'dv-connectors';
    if (name.includes('Form')) return 'dv-forms';
    if (name.includes('Variable')) return 'dv-variables';
    if (name.includes('Application')) return 'dv-apps';
    if (name.includes('Flow')) return 'dv-flows';
    return 'dv-other';
  }
  if (name.includes('Environment')) return 'environments';
  if (name.includes('Population')) return 'populations';
  if (name.includes('User')) return 'users';
  if (name.includes('Application')) {
    if (name.includes('AttributeMapping')) return 'app-attrmap';
    if (name.includes('Grant')) return 'app-grants';
    if (name.includes('RoleAssignment')) return 'app-roles';
    if (name.includes('SignOnPolicyAssignment')) return 'app-signon';
    if (name.includes('FlowPolicyAssignment')) return 'app-flowpolicy';
    if (name.includes('PushCredential')) return 'app-push';
    return 'applications';
  }
  return 'other';
};

const CHIP_GROUP_META = {
  environments:     { label: 'Environments' },
  applications:     { label: 'Applications' },
  'app-attrmap':    { label: 'App · Attribute mappings' },
  'app-grants':     { label: 'App · Grants' },
  'app-roles':      { label: 'App · Role assignments' },
  'app-signon':     { label: 'App · Sign-on policy' },
  'app-flowpolicy': { label: 'App · Flow policy' },
  'app-push':       { label: 'App · Push credentials' },
  users:            { label: 'Users' },
  populations:      { label: 'Populations' },
  'dv-flows':       { label: 'DaVinci · Flows' },
  'dv-apps':        { label: 'DaVinci · Applications' },
  'dv-connectors':  { label: 'DaVinci · Connectors' },
  'dv-forms':       { label: 'DaVinci · Forms' },
  'dv-variables':   { label: 'DaVinci · Variables' },
  'dv-other':       { label: 'DaVinci · Other' },
  other:            { label: 'Other' },
};
const CHIP_GROUP_ORDER = [
  'environments', 'applications', 'app-attrmap', 'app-grants', 'app-roles',
  'app-signon', 'app-flowpolicy', 'app-push', 'users', 'populations',
  'dv-flows', 'dv-apps', 'dv-connectors', 'dv-forms', 'dv-variables', 'dv-other', 'other',
];
// Primary/top-level groups stay open; the noisier per-app-facet and secondary
// groups start collapsed so a broadly-scoped catalog doesn't reopen the wall.
const CHIP_GROUP_OPEN = new Set([
  'environments', 'applications', 'users', 'populations', 'dv-flows', 'dv-apps',
]);
// Ordered [groupKey, tools[]] pairs for a tool list (empty groups dropped).
const groupChips = (toolList) => {
  const buckets = {};
  for (const t of toolList) {
    const key = chipGroupKey(t.name);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(t);
  }
  return CHIP_GROUP_ORDER.filter((k) => buckets[k]?.length).map((k) => [k, buckets[k]]);
};

// Management operations the hosted PingOne MCP server does NOT expose, so the app
// and tests fall back to the PingOne Management API (or DaVinci API) directly.
// Verified against the live tools/list — keep in sync if PingOne adds tools.
const MCP_GAPS = [
  {
    group: 'Used by this demo — must call direct API',
    items: [
      ['Resource servers', 'No resource* tools — custom API resources (mcpserver.ping.demo, mcpgateway.ping.demo, banking) are created directly.'],
      ['Scopes', 'No scope tools — custom scopes (banking:read/write, mirrored scopes) are created directly.'],
      ['User → admin role assignments', 'MCP only assigns roles to worker apps; granting admin roles to persona users is direct.'],
      ['MFA / FIDO2 policies', 'MCP has per-user manageUserMfa only; device-auth / FIDO2 RP policies are direct.'],
      ['Sign-on policy objects', 'MCP only assigns an existing sign-on policy to an app; creating/editing the policy + rules is direct.'],
    ],
  },
  {
    group: 'Lifecycle verbs missing on supported resources',
    items: [
      ['createEnvironment / deleteEnvironment', 'Only get / list / update + services.'],
      ['deletePopulation', 'create / update / get / list only.'],
      ['deleteUser', 'create / update / get / list / manage* only.'],
    ],
  },
  {
    group: 'No MCP coverage at all',
    items: [
      ['DaVinci authoring', 'All DaVinci tools are read-only (list/get) — creating/updating/deploying flows, connectors, forms, variables is direct.'],
      ['Groups & memberships', 'No MCP tools — demo provisions via Management API (GET /users/{id}/memberOfGroups). See Vertical group membership panel below.'],
      ['Identity providers / social login', ''],
      ['Keys & certificates', 'signing/encryption, rotation'],
      ['Directory schema / custom attributes', 'MCP maps attributes on apps; it does not define directory schema.'],
      ['Branding / themes / custom domains', ''],
      ['Gateways (LDAP/RADIUS) & agents', ''],
      ['Notifications (SMTP / templates)', ''],
      ['Universal services config', 'Protect, Verify, Credentials, Authorize, MFA service settings.'],
      ['Worker client_credentials token', 'Auth endpoint, not a management tool.'],
    ],
  },
];

/**
 * CIMD (draft-ietf-oauth-client-id-metadata-document) demo section. The
 * client_id IS an https URL; the AS fetches the client's metadata document
 * from it instead of requiring pre-registration. PingOne does not support
 * CIMD, so the BFF mocks the AS side (engine:'mock') — badged as such.
 */
const CIMD_STEP_LABELS = {
  fetch: 'Fetch client metadata document',
  validate: 'Validate document (client_id = URL, grant types, scopes)',
  register: 'Register client in the mock AS',
};

/** Live PingOne directory membership for the active vertical (Management API, not MCP). */
const VerticalGroupMembershipSection = ({ isAdmin = false }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/groups/membership');
      setData(res.data);
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to load vertical group membership'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleProvision = useCallback(async () => {
    if (!isAdmin) return;
    setProvisioning(true);
    setProvisionResult(null);
    try {
      const res = await apiClient.post('/api/groups/provision', {
        verticalId: data?.verticalId || null,
      });
      setProvisionResult(res.data);
      await refresh();
    } catch (e) {
      notifyError(formatAxiosError(e, 'Failed to provision vertical groups'));
    } finally {
      setProvisioning(false);
    }
  }, [isAdmin, data?.verticalId, refresh]);

  const categories = data?.categories ? Object.entries(data.categories) : [];
  const restricted = data?.restrictedTools ? Object.entries(data.restrictedTools) : [];

  return (
    <Section
      title="Vertical group membership"
      hint="Management API — active vertical only"
      defaultOpen
    >
      <p className="mcp-inspector__muted">
        Each vertical owns its own PingOne groups (e.g. <code>Healthcare_Privileged</code>, not
        banking names). The hosted PingOne MCP server has <strong>no group tools</strong> — groups
        are created via the Management API (<code>POST /groups</code>,{' '}
        <code>POST /users/&#123;id&#125;/memberOfGroups</code>) using worker creds from{' '}
        <code>.env</code>.
      </p>
      <div className="p1mcp-toolbar">
        <button type="button" className="mcp-inspector__btn" onClick={refresh} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh membership'}
        </button>
        {isAdmin && (
          <button
            type="button"
            className="mcp-inspector__btn"
            onClick={handleProvision}
            disabled={provisioning}
            title="Create groups for active vertical via Management API (no bootstrap)"
          >
            {provisioning ? 'Provisioning…' : 'Provision groups (API)'}
          </button>
        )}
        {data?.source && (
          <span className="p1mcp-cimd-badge" title="pingone = live directory; manifest = demo JSON fallback">
            Source: {data.source}
          </span>
        )}
      </div>
      {provisionResult && (
        <p className="mcp-inspector__muted">
          Provisioned via {provisionResult.transport}: {provisionResult.summary?.groupsEnsured ?? 0}{' '}
          group step(s)
          {provisionResult.summary?.warnings ? `, ${provisionResult.summary.warnings} warning(s)` : ''}.
        </p>
      )}
      {data && (
        <>
          <div className="p1mcp-gap-group">
            <div className="p1mcp-gap-group__title">
              {data.displayName || data.verticalId}
              {data.policyEnabled ? ' — policy ON' : ' — policy OFF'}
            </div>
            <ul className="p1mcp-gap-list">
              <li className="p1mcp-gap-item">
                <span className="p1mcp-gap-item__name">User</span>
                <span className="p1mcp-gap-item__why">
                  {data.username || '—'}
                  {data.userTier ? ` · tier ${data.userTier}` : ''}
                </span>
              </li>
              <li className="p1mcp-gap-item">
                <span className="p1mcp-gap-item__name">Member of</span>
                <span className="p1mcp-gap-item__why">
                  {data.groups?.length ? data.groups.join(', ') : '(none)'}
                </span>
              </li>
            </ul>
          </div>
          {categories.length > 0 && (
            <div className="p1mcp-gap-group">
              <div className="p1mcp-gap-group__title">Categories (this vertical)</div>
              <ul className="p1mcp-gap-list">
                {categories.map(([key, cat]) => (
                  <li className="p1mcp-gap-item" key={key}>
                    <span className="p1mcp-gap-item__name">{key}</span>
                    <span className="p1mcp-gap-item__why">{cat.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {restricted.length > 0 && (
            <div className="p1mcp-gap-group">
              <div className="p1mcp-gap-group__title">Restricted tools</div>
              <ul className="p1mcp-gap-list">
                {restricted.map(([tool, group]) => (
                  <li className="p1mcp-gap-item" key={tool}>
                    <span className="p1mcp-gap-item__name">{tool}</span>
                    <span className="p1mcp-gap-item__why">requires {group}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Section>
  );
};

const CimdRegistrationSection = () => {
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/cimd/agents')
      .then((res) => { if (!cancelled) setAgents(res.data?.agents || []); })
      .catch((e) => notifyError(formatAxiosError(e, 'Failed to load CIMD agent metadata list')));
    return () => { cancelled = true; };
  }, []);

  const selectAgent = (agent) => {
    setSelected(agent);
    setResult(null);
  };

  const registerViaCimd = useCallback(async () => {
    if (!selected) return;
    setRegistering(true);
    try {
      const res = await apiClient.post('/api/oauth/clients/register-cimd', {
        client_id: selected.client_id,
      });
      setResult(res.data);
    } catch (e) {
      // Validation rejections (400) still carry the step breakdown — show them.
      if (e.response?.data?.steps) {
        setResult(e.response.data);
      } else {
        notifyError(formatAxiosError(e, 'CIMD registration failed'));
        setResult(null);
      }
    } finally {
      setRegistering(false);
    }
  }, [selected]);

  return (
    <Section
      title="CIMD registration — client_id as a URL"
      hint="draft-ietf-oauth-client-id-metadata-document"
      defaultOpen={false}
    >
      <div className="p1mcp-cimd-badge" title="The AS side of CIMD runs in the demo BFF (engine: mock), not in PingOne">
        Mocked — PingOne does not yet support CIMD
      </div>
      <p className="mcp-inspector__muted">
        With <strong>Client ID Metadata Documents</strong> the client&apos;s <code>client_id</code>{' '}
        IS an HTTPS URL: at first use the authorization server fetches the client&apos;s metadata
        JSON from that URL instead of requiring pre-registration. Each agent&apos;s document is
        derived live from <code>scope-topology.json</code>. Pick an agent, then run the mocked
        fetch → validate → register flow.
      </p>

      <div className="p1mcp-chips">
        {agents.map((a) => (
          <button
            key={a.slug}
            type="button"
            className={`p1mcp-chip ${selected?.slug === a.slug ? 'p1mcp-chip--active' : ''}`}
            title={a.client_name}
            onClick={() => selectAgent(a)}
          >
            {a.app}
          </button>
        ))}
        {agents.length === 0 && <p className="mcp-inspector__muted">No agents published yet.</p>}
      </div>

      {selected && (
        <div className="p1mcp-tool-card">
          <div className="p1mcp-tool-card__name">{selected.client_name}</div>
          <p className="p1mcp-tool-card__desc">
            <code>client_id</code> (also the metadata document URL):{' '}
            <a href={selected.metadata_path} target="_blank" rel="noopener noreferrer">
              <code>{selected.client_id}</code>
            </a>
            <br />
            Requested scopes: <code>{selected.granted_scopes.join(' ') || '(none)'}</code>
          </p>
          <button
            type="button"
            className="mcp-inspector__btn"
            onClick={registerViaCimd}
            disabled={registering}
            title="Runs the mocked CIMD registration in the demo BFF"
          >
            {registering ? 'Registering…' : 'Register via CIMD (mocked)'}
          </button>

          {result && (
            <>
              <div className={`p1mcp-call-status ${result.client ? '' : 'p1mcp-call-status--error'}`}>
                {result.client
                  ? `Registered — client_id is the document URL (engine: ${result.engine})`
                  : `Rejected by the mock AS: ${(result.errors || []).join('; ')}`}
              </div>
              {(result.steps || []).map((step) => (
                <Section
                  key={step.step}
                  title={CIMD_STEP_LABELS[step.step] || step.step}
                  status={step.status === 'success' ? 'ok' : 'error'}
                  hint={`engine: ${step.engine}`}
                  defaultOpen={step.status !== 'success'}
                >
                  <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={step.detail} deep /></pre>
                </Section>
              ))}
              {result.client && (
                <Section title="Registered client" status="ok" defaultOpen={false}>
                  <pre className="mcp-inspector__code jh-dark"><JsonHighlight value={result.client} deep /></pre>
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </Section>
  );
};

const PingOneMcpInspector = ({ user, onLogout }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [activeTab, setActiveTab] = useState('platform');
  // 'all' shows every PingOne tool; the rest filter by resource group.
  const [platformGroup, setPlatformGroup] = useState('all');
  // Client-side filter over the visible chip list (name + description).
  const [toolSearch, setToolSearch] = useState('');

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

  const tabTools =
    activeTab === 'davinci'
      ? davinciTools
      : platformGroup === 'all'
      ? platformTools
      : platformTools.filter((t) => platformGroupId(t.name) === platformGroup);

  const searchQuery = toolSearch.trim().toLowerCase();
  const visibleTools = searchQuery
    ? tabTools.filter((t) => {
        const name = (t.name || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        return name.includes(searchQuery) || desc.includes(searchQuery);
      })
    : tabTools;

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

  const callButton = selectedTool ? (
    <button
      type="button"
      className="app-page-toolbar-btn app-page-toolbar-btn--theme p1mcp-call-btn"
      onClick={callTool}
      disabled={calling || !enabled}
      title={enabled ? `Invoke ${selectedTool.name}` : 'Enable live querying first'}
    >
      {calling ? 'Calling…' : `Call ${selectedTool.name}`}
    </button>
  ) : null;

  const catalogBody = tools.length === 0 ? (
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

      <div className="p1mcp-tool-search">
        <label htmlFor="p1mcp-tool-search" className="p1mcp-tool-search__label">
          Search tools
        </label>
        <input
          id="p1mcp-tool-search"
          type="search"
          className="p1mcp-tool-search__input"
          placeholder="Filter by name or description…"
          value={toolSearch}
          onChange={(e) => setToolSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {searchQuery && (
          <span className="p1mcp-tool-search__count" aria-live="polite">
            {visibleTools.length} of {tabTools.length}
          </span>
        )}
      </div>

      <div className="p1mcp-catalog-scroll">
        {visibleTools.length === 0 ? (
          <p className="mcp-inspector__muted">
            {searchQuery
              ? `No tools match "${toolSearch.trim()}".`
              : `No ${activeTab === 'davinci' ? 'DaVinci' : 'platform'} tools returned.${
                  activeTab === 'davinci' ? ' DaVinci Admin role required.' : ''
                }`}
          </p>
        ) : (
          groupChips(visibleTools).map(([key, groupTools]) => {
            const meta = CHIP_GROUP_META[key];
            return (
              <details
                className="p1mcp-chip-group"
                key={key}
                open={!!searchQuery || CHIP_GROUP_OPEN.has(key)}
              >
                <summary className="p1mcp-chip-group__head">
                  <span className="p1mcp-chip-group__label">{meta.label}</span>
                  <span className="p1mcp-chip-group__count">{groupTools.length}</span>
                </summary>
                <div className="p1mcp-chips">
                  {groupTools.map((t) => (
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
                </div>
              </details>
            );
          })
        )}
      </div>
    </>
  );

  const detailBody = !selectedTool ? (
    <div className="p1mcp-empty" data-testid="p1mcp-empty-state">
      <div className="p1mcp-empty__glyph" aria-hidden="true">{'</>'}</div>
      <h3 className="p1mcp-empty__title">Select a tool to inspect schema and call</h3>
      <p className="p1mcp-empty__hint">
        Choose a tool from the catalog to view its input schema, run tools/call, and inspect the JSON-RPC frames.
      </p>
    </div>
  ) : (
    <div className="p1mcp-tool-card p1mcp-tool-card--panel">
      <div className="p1mcp-tool-card__name">{selectedTool.name}</div>
      {selectedTool.description && (
        <p className="p1mcp-tool-card__desc">{selectedTool.description}</p>
      )}

      {Object.keys(schemaProps).length > 0 && (
        <div className="p1mcp-param-block">
          <div className="p1mcp-param-block__label">Parameters</div>
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

      <div className="p1mcp-detail-actions">{callButton}</div>
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
  );

  return (
    <div className="mcp-inspector-page app-page-shell p1mcp-page">
      <PageNav user={user} onLogout={onLogout} title="PingOne MCP Inspector" />
      <header className="app-page-shell__hero">
        <div className="app-page-shell__hero-top">
          <div>
            <h1 className="app-page-shell__title">PingOne MCP Inspector</h1>
            <div className="app-page-shell__lead">
              Explore hosted <strong>PingOne MCP</strong> tools over HTTP via the Backend-for-Frontend (BFF).
              Browse the catalog, inspect schemas, and run live <code>tools/call</code>.
            </div>
          </div>
          <div className="app-page-shell__actions p1mcp-hero-actions">
            {data && (
              <button
                type="button"
                className={`app-page-toolbar-btn ${enabled ? 'app-page-toolbar-btn--theme' : ''}`}
                onClick={toggleLiveQuery}
                disabled={toggling || loading}
                aria-pressed={!!enabled}
                title="Turns live querying of the PingOne MCP server on or off for this page only"
              >
                {toggling ? 'Switching…' : `Live query: ${enabled ? 'On' : 'Off'}`}
              </button>
            )}
            <button
              type="button"
              className="app-page-toolbar-btn app-page-toolbar-btn--theme"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? 'Querying…' : 'Refresh tools/list'}
            </button>
            <a
              className="app-page-toolbar-btn p1mcp-hero-link"
              href="/pingone-mcp-tools.html"
              target="_blank"
              rel="noopener noreferrer"
              title="Full catalog of PingOne MCP tools"
            >
              Tools reference
            </a>
          </div>
        </div>
      </header>

      <div className="app-page-shell__body">
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

        <div className="p1mcp-split">
          <section className="p1mcp-pane p1mcp-pane--catalog" aria-label="Tool catalog">
            <div className="p1mcp-pane__head">
              <h2 className="p1mcp-pane__title">Tools ({tools.length})</h2>
              <span className="p1mcp-pane__hint">Browse and select</span>
            </div>
            {catalogBody}
          </section>

          <section className="p1mcp-pane p1mcp-pane--detail" aria-label="Tool detail">
            <div className="p1mcp-pane__head">
              <h2 className="p1mcp-pane__title">Inspect &amp; call</h2>
              <span className="p1mcp-pane__hint">Schema, invoke, JSON-RPC</span>
            </div>
            {detailBody}
          </section>
        </div>

        <VerticalGroupMembershipSection isAdmin={user?.role === 'admin'} />

        <CimdRegistrationSection />

        <Section
          title="Not in the MCP server — use direct API"
          hint="Operations the hosted PingOne MCP server doesn't expose"
          defaultOpen={false}
        >
          <p className="mcp-inspector__muted">
            The hosted PingOne MCP server is preview software with a limited tool set. The
            operations below have no MCP tool, so the app and tests call the PingOne
            Management API (or DaVinci API) directly. Verified against the live{' '}
            <code>tools/list</code> ({tools.length} tools).
          </p>
          {MCP_GAPS.map((cat) => (
            <div className="p1mcp-gap-group" key={cat.group}>
              <div className="p1mcp-gap-group__title">{cat.group}</div>
              <ul className="p1mcp-gap-list">
                {cat.items.map(([name, why]) => (
                  <li className="p1mcp-gap-item" key={name}>
                    <span className="p1mcp-gap-item__name">{name}</span>
                    {why && <span className="p1mcp-gap-item__why">{why}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="mcp-inspector__muted p1mcp-gap-foot">
            Recently added to MCP (no longer direct-only): users (create/update/list/get),
            passwords (<code>manageUserPassword</code>), account lock (<code>manageUserAccount</code>),
            per-user MFA (<code>manageUserMfa</code>).
          </p>
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
    </div>
  );
};

export default PingOneMcpInspector;
