// banking_api_ui/src/components/DemoDataPage.js
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '../utils/appToast';
import axios from 'axios';
import apiClient from '../services/apiClient';
import { fetchDemoScenario, saveDemoScenario } from '../services/demoScenarioService';
import { AGENT_MCP_SCOPE_CATALOG, DEFAULT_AGENT_MCP_ALLOWED_SCOPES } from '../config/agentMcpScopes';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import { useIndustryBranding } from '../context/IndustryBrandingContext';
import { useVertical } from '../vertical/useVertical';
import VerticalSwitcher from './VerticalSwitcher';
import PingOneAudit from './PingOneAudit';
import './UserDashboard.css';
import './DemoDataPage.css';

/** Persisted choice for which agent/auth story the presenter is demonstrating (demo-data UI only). */
const AGENT_AUTH_DEMO_STORAGE_KEY = 'bx-agent-auth-demo-mode';
const AGENT_AUTH_DEMO = {
  OAUTH_PKCE: 'oauth_pkce',
  /** PingOne pi.flow from the `/` landing slide panel (hosted login UI), not a password grant. */
  PI_FLOW_MARKETING: 'pi_flow_marketing',
  BEARER_PASTE: 'bearer_paste',
};

/** @returns {string} one of AGENT_AUTH_DEMO */
function readStoredAgentAuthDemoMode() {
  try {
    const v = localStorage.getItem(AGENT_AUTH_DEMO_STORAGE_KEY);
    if (v === AGENT_AUTH_DEMO.BEARER_PASTE || v === AGENT_AUTH_DEMO.PI_FLOW_MARKETING) return v;
    if (v === 'credential_story') return AGENT_AUTH_DEMO.PI_FLOW_MARKETING;
  } catch (_) {
    /* ignore */
  }
  return AGENT_AUTH_DEMO.OAUTH_PKCE;
}

/** Account types — each type gets exactly one slot; accountType is the stable key. */
const ACCOUNT_TYPE_SLOTS = [
  { type: 'checking',     label: 'Checking',            icon: '', defaultName: 'Checking Account' },
  { type: 'savings',     label: 'Savings',             icon: '', defaultName: 'Savings Account' },
  { type: 'investment',  label: 'Investment',          icon: '', defaultName: 'Investment Account' },
  { type: 'money_market',label: 'Money market',        icon: '', defaultName: 'Money Market Account' },
  { type: 'credit',      label: 'Credit card',         icon: '', defaultName: 'Credit Card' },
  { type: 'car_loan',    label: 'Car loan',            icon: '', defaultName: 'Car Loan' },
  { type: 'mortgage',    label: 'Mortgage (home loan)',icon: '', defaultName: 'Mortgage (Home Loan)' },
];

/** Build an initial typeSlots map — all disabled, default names. */
function defaultTypeSlots(accountTypes = ACCOUNT_TYPE_SLOTS) {
  const m = {};
  for (const s of accountTypes) {
    m[s.type] = { enabled: false, name: s.defaultName, balance: '0', id: null, accountNumber: '' };
  }
  return m;
}

/** Default profile fields for a given account type slot. */
function defaultAccountProfile(type, accountHolderName) {
  return {
    swiftCode: 'CHASUS33',
    iban: type === 'savings' ? 'US98CHAS0987654321098' : 'US12CHAS0123456789012',
    branchName: 'Super Banking Main Branch',
    branchCode: '001',
    openedDate: '2022-01-15',
    accountHolderName: accountHolderName || '',
    routingNumber: '021000021',
    accountNumberFull: '',
    includeRoutingNumber: true,
    includeAccountNumberFull: false,
  };
}

/**
 * Lets demo users edit account labels, balances, and MFA step-up threshold for their sandbox data.
 */
export default function DemoDataPage({ user, onLogout }) {
  const { preset: industryPreset } = useIndustryBranding();
  const { activeId: vertical } = useVertical();
  const navigate = useNavigate();
  const { open } = useEducationUI();
  const dashboardPath = user?.role === 'admin' ? '/admin' : '/dashboard';
  const dashboardCrumbLabel = user?.role === 'admin' ? 'Admin' : 'Dashboard';

  // Build account type slots dynamically based on vertical
  const getAccountTypeSlots = () => {
    if (vertical?.terminology?.accountTypes?.length) {
      return vertical.terminology.accountTypes.map((name, idx) => ({
        type: `type_${idx}`,
        label: name,
        icon: '',
        defaultName: name
      }));
    }
    return ACCOUNT_TYPE_SLOTS;
  };

  const ACCOUNT_TYPES = getAccountTypeSlots();




  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [storageBackend, setStorageBackend] = useState(null);
  // One slot per account type — keyed by accountType string.
  const [typeSlots, setTypeSlots] = useState(() => defaultTypeSlots(ACCOUNT_TYPES));
  const [accountProfiles, setAccountProfiles] = useState({});
  const [accountProfileSaving, setAccountProfileSaving] = useState(false);
  /** Global thresholds — synced with Demo Controls widget via /api/config/thresholds */
  /** confirmThreshUsd: HITL consent gate (default $250); mfaThreshUsd: step-up MFA (default $500) */
  const [confirmThreshUsd, setConfirmThreshUsd] = useState('250');
  const [mfaThreshUsd, setMfaThreshUsd] = useState('500');
  const [threshLoading, setThreshLoading] = useState(false);
  const [threshSaving, setThreshSaving] = useState(false);
  const [threshStatus, setThreshStatus] = useState(null); // 'saved' | 'error'

  /** Token endpoint auth method overrides (Phase 110) */
  const [agentTokenEndpointAuth, setAgentTokenEndpointAuth] = useState('');
  const [mcpTokenEndpointAuth, setMcpTokenEndpointAuth] = useState('');
  const [tokenAuthSaving, setTokenAuthSaving] = useState(false);

  /** Sticky section nav active state (Phase 110) */
  const [activeNav, setActiveNav] = useState(null);
  /** Editable profile fields (persisted as userData on save). */
  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    isActive: true,
  });
  /** Read-only metadata from the server (not sent as editable JSON). */
  const [userMeta, setUserMeta] = useState({ id: '', role: '', createdAt: '' });
  const [defaults, setDefaults] = useState(null);
  const [persistenceNote, setPersistenceNote] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({ accountProfile: true });

  /** Agent MCP scope toggles — loaded from admin config, saved separately */
  const [allowedScopes, setAllowedScopes] = useState(() => {
    const raw = DEFAULT_AGENT_MCP_ALLOWED_SCOPES;
    return new Set(raw.split(/\s+/).filter(Boolean));
  });
  const [scopeSaving, setScopeSaving] = useState(false);

  /** Marketing home sign-in mode + demo hints (persisted in admin config). */
  const [marketingLoginMode, setMarketingLoginMode] = useState('redirect');
  const [marketingUserHint, setMarketingUserHint] = useState('');
  const [marketingPassHint, setMarketingPassHint] = useState('');
  const [marketingSaving, setMarketingSaving] = useState(false);

  /** Load current scope config from server */
  const loadScopes = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/admin/config');
      const cfg = data?.config || data;
      const raw = cfg?.agent_mcp_allowed_scopes || DEFAULT_AGENT_MCP_ALLOWED_SCOPES;
      setAllowedScopes(new Set(raw.split(/\s+/).filter(Boolean)));
      setMarketingLoginMode(cfg?.marketing_customer_login_mode === 'slide_pi_flow' ? 'slide_pi_flow' : 'redirect');
      setMarketingUserHint(String(cfg?.marketing_demo_username_hint ?? ''));
      setMarketingPassHint(String(cfg?.marketing_demo_password_hint ?? ''));
    } catch {
      // silently keep client default
    }
  }, []);

  const handleScopeToggle = (scope, checked) => {
    setAllowedScopes((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(scope);
      } else {
        if (next.size === 1) {
          notifyError('Select at least one Agent MCP scope.');
          return prev;
        }
        next.delete(scope);
      }
      return next;
    });
  };

  const handleSaveScopes = async () => {
    setScopeSaving(true);
    try {
      await axios.post('/api/admin/config', {
        agent_mcp_allowed_scopes: [...allowedScopes].join(' '),
      });
      notifySuccess('Scope permissions saved');
    } catch (err) {
      notifyError(err?.response?.data?.message || 'Failed to save scopes');
    } finally {
      setScopeSaving(false);
    }
  };

  const handleSaveMarketingLogin = async () => {
    setMarketingSaving(true);
    try {
      await axios.post('/api/admin/config', {
        marketing_customer_login_mode: marketingLoginMode,
        marketing_demo_username_hint: marketingUserHint.trim(),
        marketing_demo_password_hint: marketingPassHint.trim(),
      });
      notifySuccess('Marketing sign-in settings saved');
    } catch (err) {
      notifyError(err?.response?.data?.message || err.message || 'Failed to save marketing sign-in settings');
    } finally {
      setMarketingSaving(false);
    }
  };

  /** PingOne Authorize feature flags — same registry as /feature-flags; admin-only on this page. */
  const [p1azFlags, setP1azFlags] = useState([]);
  const [p1azFlagsLoading, setP1azFlagsLoading] = useState(false);
  const [p1azFlagsError, setP1azFlagsError] = useState(null);
  const [p1azFlagSaving, setP1azFlagSaving] = useState(null);

  /** PingOne Authorize — bootstrap decision endpoints via worker + Platform API */
  const [p1azBootstrapPolicyId, setP1azBootstrapPolicyId] = useState('');
  const [p1azBootstrapAuthVer, setP1azBootstrapAuthVer] = useState('');
  const [p1azBootstrapEnableLive, setP1azBootstrapEnableLive] = useState(true);
  const [p1azBootstrapEnableMcp, setP1azBootstrapEnableMcp] = useState(false);
  const [p1azBootstrapBusy, setP1azBootstrapBusy] = useState(false);

  /** act claim check on AI-Agent resource (demo-data setup verification). */
  const [actClaimStatus, setActClaimStatus] = useState(null); // null | { status, detail, ... }
  const [actClaimChecking, setActClaimChecking] = useState(false);
  const [actClaimFixing, setActClaimFixing] = useState(false);

  /** Demo reset — clears all in-memory server state + browser localStorage history. */
  const [demoResetting, setDemoResetting] = useState(false);
  const handleResetDemo = useCallback(async () => {
    if (!window.confirm('Reset demo? This clears all agent history, token chain events, and MCP audit logs from the server. You will stay signed in.')) return;
    setDemoResetting(true);
    try { await axios.post('/api/admin/reset-demo'); } catch (_) {}
    try { localStorage.removeItem('tokenChainHistory'); } catch (_) {}
    try { localStorage.removeItem('api-traffic-store'); } catch (_) {}
    window.location.reload();
  }, []);

  const handleCheckActClaim = useCallback(async () => {
    setActClaimChecking(true);
    setActClaimStatus(null);
    try {
      const { data } = await axios.get('/api/pingone-test/check-ai-agent-act');
      setActClaimStatus(data);
    } catch (err) {
      setActClaimStatus({ status: 'error', detail: err?.response?.data?.detail || err.message });
      notifyError('act claim check failed');
    } finally {
      setActClaimChecking(false);
    }
  }, []);

  const handleFixActClaim = useCallback(async () => {
    setActClaimFixing(true);
    try {
      const { data } = await axios.post('/api/pingone-test/fix-ai-agent-act');
      if (data.success) {
        notifySuccess(`act claim ${data.action} on ${data.audience}`);
        setActClaimStatus({ status: 'ok', value: data.value, resourceId: data.resourceId, audience: data.audience });
      } else {
        notifyError(data.error || 'Fix failed');
        setActClaimStatus({ status: 'error', detail: data.error });
      }
    } catch (err) {
      notifyError(err?.response?.data?.error || err.message || 'Fix failed');
      setActClaimStatus({ status: 'error', detail: err?.response?.data?.error || err.message });
    } finally {
      setActClaimFixing(false);
    }
  }, []);

  /** Which agent authentication story is highlighted for demos (saved in localStorage). */
  const [agentAuthDemoMode, setAgentAuthDemoMode] = useState(readStoredAgentAuthDemoMode);
  const [bearerPasteToken, setBearerPasteToken] = useState('');
  const [bearerProbe, setBearerProbe] = useState(null);
  const [bearerBusy, setBearerBusy] = useState(false);

  const handleAgentAuthDemoModeChange = useCallback((mode) => {
    setAgentAuthDemoMode(mode);
    try {
      localStorage.setItem(AGENT_AUTH_DEMO_STORAGE_KEY, mode);
      window.dispatchEvent(new CustomEvent('bx-agent-auth-demo-mode', { detail: { mode } }));
    } catch (_) {
      /* ignore */
    }
  }, []);

  const handleBearerProbeAccounts = useCallback(async () => {
    const t = bearerPasteToken.trim();
    if (!t) {
      notifyWarning('Paste an access token first.');
      return;
    }
    setBearerBusy(true);
    setBearerProbe(null);
    try {
      const r = await fetch('/api/accounts', {
        method: 'GET',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
      });
      const text = await r.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.length > 400 ? `${text.slice(0, 400)}…` : text;
      }
      setBearerProbe({ ok: r.ok, status: r.status, body });
      if (r.ok) notifySuccess('Bearer token accepted by the API');
      else notifyError(`Accounts request returned HTTP ${r.status}`);
    } catch (e) {
      setBearerProbe({ ok: false, status: 0, body: e.message || 'Request failed' });
      notifyError(e.message || 'Probe failed');
    } finally {
      setBearerBusy(false);
    }
  }, [bearerPasteToken]);

  const loadP1azFlags = useCallback(async () => {
    setP1azFlagsLoading(true);
    setP1azFlagsError(null);
    try {
      const { data } = await axios.get('/api/admin/feature-flags');
      const list = (data.flags || []).filter(
        (f) => f.category === 'PingOne Authorize' || f.category === 'Token Exchange'
      );
      setP1azFlags(list);
    } catch (err) {
      setP1azFlagsError(err?.response?.data?.error || err.message || 'Failed to load feature flags');
    } finally {
      setP1azFlagsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadP1azFlags();
  }, [loadP1azFlags]);

  /** Global thresholds — same endpoint as Demo Controls widget */
  const loadGlobalThresholds = useCallback(async () => {
    setThreshLoading(true);
    try {
      const { data } = await axios.get('/api/config/thresholds');
      setConfirmThreshUsd(String(data.confirm_threshold_usd ?? 250));
      setMfaThreshUsd(String(data.mfa_threshold_usd ?? 500));
    } catch (_) {
      // non-critical; fields keep their default
    } finally {
      setThreshLoading(false);
    }
  }, []);

  useEffect(() => { loadGlobalThresholds(); }, [loadGlobalThresholds]);

  const handleSaveGlobalThresholds = async () => {
    setThreshSaving(true);
    setThreshStatus(null);
    try {
      const body = {};
      const cn = Number(confirmThreshUsd);
      const mn = Number(mfaThreshUsd);
      if (confirmThreshUsd && cn > 0) body.confirm_threshold_usd = cn;
      if (mfaThreshUsd && mn > 0) body.mfa_threshold_usd = mn;
      if (!Object.keys(body).length) { setThreshStatus('error'); return; }
      const { data } = await axios.post('/api/config/thresholds', body);
      setConfirmThreshUsd(String(data.confirm_threshold_usd));
      setMfaThreshUsd(String(data.mfa_threshold_usd));
      setThreshStatus('saved');
      setTimeout(() => setThreshStatus(null), 2500);
    } catch (_) {
      setThreshStatus('error');
    } finally {
      setThreshSaving(false);
    }
  };

  /** Token endpoint auth method save handler (Phase 110) */
  const handleTokenAuthSave = async () => {
    setTokenAuthSaving(true);
    try {
      await apiClient.patch('/api/demo-scenario/token-endpoint-auth', {
        ai_agent_token_endpoint_auth_method: agentTokenEndpointAuth || '',
        mcp_exchanger_token_endpoint_auth_method: mcpTokenEndpointAuth || '',
      });
      notifySuccess('Token endpoint auth method saved.', { autoClose: 2500 });
    } catch (err) {
      notifyWarning('Could not save token endpoint auth method.', { autoClose: 4000 });
    } finally {
      setTokenAuthSaving(false);
    }
  };

  const handleP1azFlagToggle = async (flagId, nextBool) => {
    setP1azFlagSaving(flagId);
    const flagLabel = p1azFlags.find((f) => f.id === flagId)?.label || flagId;
    try {
      const { data } = await axios.patch('/api/admin/feature-flags', {
        updates: { [flagId]: nextBool },
      });
      const updatedMap = new Map((data.flags || []).map((f) => [f.id, f]));
      setP1azFlags((prev) => prev.map((f) => (updatedMap.has(f.id) ? updatedMap.get(f.id) : f)));
      notifySuccess(`${flagLabel}: ${nextBool ? 'ON' : 'OFF'}`);
    } catch (err) {
      notifyError(err?.response?.data?.error || err.message || 'Failed to save flag');
    } finally {
      setP1azFlagSaving(null);
    }
  };

  const handleP1azAuthorizeBootstrap = async () => {
    setP1azBootstrapBusy(true);
    try {
      const { data } = await apiClient.post('/api/authorize/bootstrap-demo-endpoints', {
        policyId: p1azBootstrapPolicyId.trim() || undefined,
        authorizationVersionId: p1azBootstrapAuthVer.trim() || undefined,
        enableLiveAuthorize: p1azBootstrapEnableLive,
        enableMcpFirstTool: p1azBootstrapEnableMcp,
      });
      notifySuccess(data.message || 'PingOne Authorize demo endpoints ready.');
      if (data.copyEnvHint) {
        notifyInfo(data.copyEnvHint, { autoClose: 12000 });
      }
      await loadP1azFlags();
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        err.message ||
        'Authorize bootstrap failed';
      notifyError(msg);
    } finally {
      setP1azBootstrapBusy(false);
    }
  };

  /** Update a single field in a type slot. */
  const handleSlotChange = (type, field, value) => {
    setTypeSlots((prev) => ({ ...prev, [type]: { ...prev[type], [field]: value } }));
  };

  const handleSaveAccountProfiles = async () => {
    setAccountProfileSaving(true);
    try {
      await saveDemoScenario({ accountProfileFields: accountProfiles });
      notifySuccess('Account profile fields saved');
    } catch (err) {
      notifyError(err.message || 'Save failed');
    } finally {
      setAccountProfileSaving(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDemoScenario();
      if (data === null) { setLoading(false); return; } // unauthenticated — skip silently
      // Map server accounts into type slots (first account per type wins).
      const fresh = defaultTypeSlots(ACCOUNT_TYPES);
      for (const a of (data.accounts || [])) {
        const t = (a.accountType || '').toLowerCase();
        if (fresh[t] && !fresh[t].enabled) {
          fresh[t] = {
            enabled: true,
            id: a.id || null,
            name: a.name || ACCOUNT_TYPES.find(s => s.type === t)?.defaultName || t,
            balance: String(a.balance ?? '0'),
            accountNumber: a.accountNumber || '',
          };
        }
      }
      setTypeSlots(fresh);
      // Populate account profile fields from stored scenario, falling back to defaults.
      const storedProfs = data.accountProfileFields || {};
      const profilesInit = {};
      for (const a of (data.accounts || [])) {
        const t = (a.accountType || '').toLowerCase();
        profilesInit[t] = { ...defaultAccountProfile(t, ''), ...storedProfs[t] };
      }
      setAccountProfiles(profilesInit);
      const u = data.userData || {};
      setProfile({
        firstName: u.firstName != null ? String(u.firstName) : '',
        lastName: u.lastName != null ? String(u.lastName) : '',
        email: u.email != null ? String(u.email) : '',
        username: u.username != null ? String(u.username) : '',
        isActive: u.isActive !== false,
      });
      setUserMeta({
        id: u.id != null ? String(u.id) : '',
        role: u.role != null ? String(u.role) : '',
        createdAt: u.createdAt != null ? String(u.createdAt) : '',
      });
      setDefaults(data.defaults || null);
      setPersistenceNote(data.persistenceNote || null);
      // Fetch storage backend info
      try {
        const backendRes = await fetch('/api/demo-scenario/accounts', { credentials: 'include' });
        if (backendRes.ok) {
          const backendData = await backendRes.json();
          setStorageBackend({
            backend: backendData.backend || 'unknown',
            accountCount: backendData.accountCount || 0,
          });
        }
      } catch { /* non-critical */ }
    } catch (e) {
      if (e.status === 401) {
        // Not logged in — demo config flags still work, account section needs a session
        setLoading(false);
        return;
      }
      notifyError(e.message || 'Failed to load demo data');
    } finally {
      setLoading(false);
    }
  }, [ACCOUNT_TYPES]);

  useEffect(() => {
    load();
    loadScopes();
    // Timeout: force loading to end after 10s if still pending
    const timeout = setTimeout(() => setLoading(false), 10000);
    // Load token endpoint auth method overrides (Phase 110)
    apiClient.get('/api/demo-scenario/token-endpoint-auth').then(({ data }) => {
      if (data) {
        setAgentTokenEndpointAuth(data.ai_agent_token_endpoint_auth_method || '');
        setMcpTokenEndpointAuth(data.mcp_exchanger_token_endpoint_auth_method || '');
      }
    }).catch(() => {});
    return () => clearTimeout(timeout);
  }, [load, loadScopes]);

  // Sticky section nav — highlight active section as user scrolls (Phase 110)
  const NAV_SECTIONS = [
    { id: 'demo-data-storage-heading',       label: 'Storage' },
    { id: 'demo-data-vertical-heading',      label: 'Demo vertical' },
    { id: 'demo-data-pingone-audit-heading', label: 'PingOne audit' },
    { id: 'demo-agent-auth-demo-heading',    label: 'Agent auth' },
    { id: 'demo-acct-profile-heading',       label: 'User profile' },
    { id: 'demo-scope-heading',              label: 'Scope' },
    { id: 'demo-marketing-login-heading',    label: 'Marketing login' },
    { id: 'demo-p1az-flags-heading',         label: 'PingOne Authorize' },
  ];

  useEffect(() => {
    const observers = NAV_SECTIONS.map(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveNav(id); },
        { rootMargin: '-10% 0px -70% 0px', threshold: 0 }
      );
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        // Only include enabled type slots; each slot maps to one account row.
        accounts: ACCOUNT_TYPES
          .filter(s => typeSlots[s.type]?.enabled)
          .map(s => {
            const slot = typeSlots[s.type];
            const row = {
              name: slot.name,
              balance: slot.balance === '' ? undefined : parseFloat(slot.balance),
            };
            if (slot.id) {
              row.id = slot.id;
            } else {
              // No existing account for this type — create one.
              row.accountType = s.type;
            }
            return row;
          }),
        userData: {
          firstName: profile.firstName.trim(),
          lastName: profile.lastName.trim(),
          email: profile.email.trim(),
          username: profile.username.trim(),
          isActive: profile.isActive,
        },
      };
      await saveDemoScenario(body);
      notifySuccess('Demo data saved');
      await load();
      try {
        window.dispatchEvent(new CustomEvent('demoScenarioUpdated'));
      } catch {
        // ignore
      }
    } catch (err) {
      if (err.code === 'stale_demo_accounts') {
        await load();
        notifyWarning(
          err.message ||
            'These account IDs are no longer on this server (common after a deploy or new instance). The form was reloaded — review accounts and save again.',
        );
      } else {
        const msg =
          err.code === 'invalid_token'
            ? 'Could not validate your sign-in token. Use Refresh access token in the Banking Agent, or sign in again.'
            : err.message || 'Save failed';
        notifyError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (!defaults) return;
    if (defaults.profileForm) {
      const pf = defaults.profileForm;
      setProfile({
        firstName: pf.firstName != null ? String(pf.firstName) : '',
        lastName: pf.lastName != null ? String(pf.lastName) : '',
        email: pf.email != null ? String(pf.email) : '',
        username: pf.username != null ? String(pf.username) : '',
        isActive: true,
      });
    }
    setTypeSlots((prev) => {
      const next = { ...prev };
      // Reset every slot: only checking and savings are on by default.
      for (const s of ACCOUNT_TYPES) {
        const t = s.type;
        if (!next[t]) continue;
        next[t] = { ...next[t], enabled: false, name: s.defaultName, balance: '0' };
      }
      if (next.checking) {
        next.checking = {
          ...next.checking,
          enabled: true,
          name: defaults.checkingName ?? 'Checking Account',
          balance: String(defaults.checkingBalance ?? 5000),
        };
      }
      if (next.savings) {
        next.savings = {
          ...next.savings,
          enabled: true,
          name: defaults.savingsName ?? 'Savings Account',
          balance: String(defaults.savingsBalance ?? 5000),
        };
      }
      return next;
    });
    notifyInfo('Form reset to defaults — click Save to apply');
  };

  return (
    <div className="user-dashboard user-dashboard--2026 demo-data-page">
      <a href="#demo-data-main" className="dash-skip-link">
        Skip to main content
      </a>

      <div className="dashboard-header-stack">
        <div className="dashboard-header dashboard-header--surface">
          <div className="bank-branding">
            <div className="bank-logo">
              <div className="logo-icon">
                <div className="logo-square" />
                <div className="logo-square" />
                <div className="logo-square" />
                <div className="logo-square" />
              </div>
              <span className="bank-name">{industryPreset.shortName}</span>
            </div>
            <div>
              <h1 className="dashboard-header__title">Demo config</h1>
              <div className="dashboard-header__crumbs">
                <Link to="/" className="dashboard-header__crumb-link">
                  Home
                </Link>
                <span className="dashboard-header__crumb-sep" aria-hidden="true">
                  ›
                </span>
                <Link to={dashboardPath} className="dashboard-header__crumb-link">
                  {dashboardCrumbLabel}
                </Link>
                <span className="dashboard-header__crumb-sep" aria-hidden="true">
                  ›
                </span>
                <span className="dashboard-header__crumb-link dashboard-header__crumb-link--current">
                  Demo config
                </span>
              </div>
            </div>
          </div>
          <div className="header-right">
            <div className="user-info">
              <span className="user-greeting">
                Hello,{' '}
                {user?.firstName || user?.lastName
                  ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                  : user?.name || user?.username || user?.email?.split('@')[0] || 'there'}
              </span>
              <span className="user-email">{user?.email || user?.username}</span>
            </div>
          </div>
        </div>

        <div className="dashboard-toolbar" role="toolbar" aria-label="Demo config actions">
          <button type="button" className="dashboard-toolbar-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <Link to={dashboardPath} className="dashboard-toolbar-btn">
            ⌂ {dashboardCrumbLabel}
          </Link>
          <span className="demo-data-toolbar-current" aria-current="page">
            Demo config
          </span>
        </div>
      </div>

      <div className="dashboard-content demo-data-page__body">
        {/* Sticky section jump-to nav (Phase 110) */}
        <nav className="demo-data-page__nav" aria-label="Jump to section">
          <ul>
            {NAV_SECTIONS.map(({ id, label }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className={`demo-data-page__nav-link${activeNav === id ? ' demo-data-page__nav-link--active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
                    setActiveNav(id);
                  }}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="demo-data-page__main" id="demo-data-main" tabIndex={-1}>
          <div className="section ud-hero demo-data-page__hero">
            <div className="ud-hero__top">
              <p className="ud-hero__eyebrow">{format(new Date(), 'EEEE, MMM d')}</p>
              <p className="ud-hero__insight" role="status">
                This whole app is a <strong>teaching sandbox</strong>: safe fake banking data plus lessons on sign-in,
                tokens, and how AI assistants should (and should not) use them. Here you can rename accounts, tweak balances,
                update your profile, and set when extra verification is required — only for your signed-in demo user.
              </p>
            </div>
          </div>

          {persistenceNote && (
            <div className="demo-data-banner" role="status">
              {persistenceNote}
            </div>
          )}

          {storageBackend && (
            <section className="section demo-data-section" aria-labelledby="demo-data-storage-heading">
              <h2 id="demo-data-storage-heading">Storage backend</h2>
              <div className="demo-data-readonly-meta">
                <span><strong>Backend:</strong>{' '}
                  {storageBackend.backend === 'lmdb' && 'LMDB (local)'}
                  {storageBackend.backend === 'env_var' && '☁️ Vercel environment variable'}
                  {storageBackend.backend === 'unknown' && '❓ Unknown'}
                </span>
                <span><strong>Persisted accounts:</strong> <code>{storageBackend.accountCount}</code></span>
              </div>
              <p className="demo-data-hint">
                {storageBackend.backend === 'lmdb'
                  ? 'Demo accounts are stored in a local LMDB database (data/persistent/lmdb/). They survive server restarts but not Vercel deploys.'
                  : storageBackend.backend === 'env_var'
                  ? 'Demo accounts are stored in the DEMO_ACCOUNTS environment variable on Vercel. They persist across deploys.'
                  : 'Storage backend could not be determined.'}
              </p>
            </section>
          )}

          <section className="section demo-data-section" aria-labelledby="demo-data-vertical-heading">
            <h2 id="demo-data-vertical-heading">Demo vertical</h2>
            <p className="demo-data-hint">
              Switch the demo between Banking, Retail, and Workforce (HR) modes. The same PingOne + MCP architecture
              is reused — only terminology, theme, and account types change.
            </p>
            <VerticalSwitcher variant="config" />
          </section>

          <section className="section demo-data-section" aria-labelledby="demo-data-pingone-audit-heading">
            <h2 id="demo-data-pingone-audit-heading">PingOne Configuration Audit</h2>
            <p className="demo-data-hint">
              Validate your PingOne environment configuration — check that all required resource servers exist
              and are configured with the correct scopes. Run the audit to verify your setup is correct.
            </p>
            <PingOneAudit />
          </section>



<details>
  <summary>🎓 Lesson: how can an AI reach your bank data?</summary>
          <section
            className="section demo-data-section demo-data-agent-auth-demo"
            aria-labelledby="demo-agent-auth-demo-heading"
          >
            <h2 id="demo-agent-auth-demo-heading">Learn: how can an AI reach your bank data?</h2>
            <p className="demo-data-hint">
              In the real world, <strong>OAuth</strong> is how apps prove “this person agreed” without sharing their
              password with every product. AI agents add a twist: sometimes people talk about “the agent logging in” in
              different ways. Pick a story below to see which path this demo highlights — we only save your choice in{' '}
              <em>this browser</em> so presenters can switch lessons; nothing here changes your PingOne tenant by itself.
            </p>
            <fieldset className="demo-data-agent-auth-fieldset">
              <legend className="demo-data-agent-auth-legend">Lesson focus</legend>
              <div className="demo-data-agent-auth-options">
                <label
                  className={`demo-data-agent-auth-card${
                    agentAuthDemoMode === AGENT_AUTH_DEMO.OAUTH_PKCE ? ' demo-data-agent-auth-card--active' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="bx-agent-auth-demo"
                    checked={agentAuthDemoMode === AGENT_AUTH_DEMO.OAUTH_PKCE}
                    onChange={() => handleAgentAuthDemoModeChange(AGENT_AUTH_DEMO.OAUTH_PKCE)}
                  />
                  <span className="demo-data-agent-auth-card__body">
                    <span className="demo-data-agent-auth-card__title">1 · Recommended — real sign-in at PingOne</span>
                    <span className="demo-data-agent-auth-card__desc">
                      The user is sent to PingOne’s login (authorization code + PKCE). The app’s backend keeps the access
                      token in a session — the browser never needs to hold a long-lived secret. This is the pattern to teach
                      first.
                    </span>
                  </span>
                </label>
                <label
                  className={`demo-data-agent-auth-card${
                    agentAuthDemoMode === AGENT_AUTH_DEMO.PI_FLOW_MARKETING ? ' demo-data-agent-auth-card--active' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="bx-agent-auth-demo"
                    checked={agentAuthDemoMode === AGENT_AUTH_DEMO.PI_FLOW_MARKETING}
                    onChange={() => handleAgentAuthDemoModeChange(AGENT_AUTH_DEMO.PI_FLOW_MARKETING)}
                  />
                  <span className="demo-data-agent-auth-card__body">
                    <span className="demo-data-agent-auth-card__title">2 · Sign-in from the marketing page (pi.flow)</span>
                    <span className="demo-data-agent-auth-card__desc">
                      Looks like a form on your site, but PingOne still runs the actual login and security screens (a Ping
                      flow: <code>response_type=pi.flow</code>). Good for teaching “embedded” experiences without teaching
                      apps to collect passwords and send them to a password-grant endpoint.
                    </span>
                  </span>
                </label>
                <label
                  className={`demo-data-agent-auth-card${
                    agentAuthDemoMode === AGENT_AUTH_DEMO.BEARER_PASTE ? ' demo-data-agent-auth-card--active' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="bx-agent-auth-demo"
                    checked={agentAuthDemoMode === AGENT_AUTH_DEMO.BEARER_PASTE}
                    onChange={() => handleAgentAuthDemoModeChange(AGENT_AUTH_DEMO.BEARER_PASTE)}
                  />
                  <span className="demo-data-agent-auth-card__body">
                    <span className="demo-data-agent-auth-card__title">3 · The AI already has an access token</span>
                    <span className="demo-data-agent-auth-card__desc">
                      Some demos assume the user copied a token (like a temporary key) into a script or tool. The API
                      accepts <code>Authorization: Bearer …</code>. Teach that this is powerful, easy to leak, and not the
                      same as teaching end users to paste secrets into chatbots.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            {agentAuthDemoMode === AGENT_AUTH_DEMO.OAUTH_PKCE && (
              <div className="demo-data-agent-auth-detail">
                <p className="demo-data-hint">
                  <strong>What you are teaching:</strong> the customer leaves this app briefly, signs in where PingOne
                  says it is safe, and returns with a short-lived “yes” the backend can use. After login, you can open the
                  slide lesson on <strong>token exchange</strong> to show how a narrower token can be minted for tools
                  like MCP.
                </p>
                <div className="demo-data-actions demo-data-actions--wrap">
                  <a className="demo-data-btn primary" href="/api/auth/oauth/user/login">
                    Go to PingOne customer sign-in
                  </a>
                  <button
                    type="button"
                    className="demo-data-btn ghost"
                    onClick={() => open(EDU.TOKEN_EXCHANGE, 'what')}
                  >
                    Open lesson: token exchange
                  </button>
                  <button
                    type="button"
                    className="demo-data-btn ghost"
                    onClick={() => open(EDU.BEST_PRACTICES, 'what')}
                  >
                    Open lesson: AI + OAuth basics
                  </button>
                </div>
              </div>
            )}

            {agentAuthDemoMode === AGENT_AUTH_DEMO.PI_FLOW_MARKETING && (
              <div className="demo-data-agent-auth-detail">
                <p className="demo-data-hint">
                  <strong>What you are teaching:</strong> the customer still authenticates with PingOne (MFA, policies,
                  branding), but the flow can feel like part of your marketing site. That is different from “type your
                  password into ChatGPT,” which you should discourage.
                </p>
                <ol className="demo-data-agent-auth-steps">
                  <li>
                    Scroll to <strong>Marketing page customer sign-in</strong> below, choose{' '}
                    <strong>Slide panel — hints + pi.flow</strong>, and click <strong>Save marketing sign-in</strong> (same
                    idea lives under Application setup if you prefer).
                  </li>
                  <li>
                    Visit <Link to="/">/</Link>, open the sign-in slide, and continue. Behind the scenes
                    the app asks PingOne for a <code>pi.flow</code> response so the real login UI is still PingOne’s — not a
                    legacy “password grant” to the token endpoint.
                  </li>
                </ol>
                <div className="demo-data-actions demo-data-actions--wrap">
                  <Link className="demo-data-btn primary" to="/">
                    Open marketing page (try sign-in)
                  </Link>
                  <button
                    type="button"
                    className="demo-data-btn ghost"
                    onClick={() =>
                      document.getElementById('demo-marketing-login-heading')?.scrollIntoView({ behavior: 'smooth' })
                    }
                  >
                    Scroll to marketing sign-in settings
                  </button>
                </div>
              </div>
            )}

            {agentAuthDemoMode === AGENT_AUTH_DEMO.BEARER_PASTE && (
              <div className="demo-data-agent-auth-detail">
                <p className="demo-data-hint">
                  <strong>What you are teaching:</strong> whoever holds a valid access token can call the API like the user
                  until it expires. In class, use this to show why tokens must be short-lived, scoped, and never pasted into
                  untrusted chat. The button below sends <em>only</em> the Bearer header (no session cookie) so you can
                  prove the rule. Use fake/lab tokens only.
                </p>
                <label className="demo-data-field">
                  <span>Paste an access token (lab only)</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={bearerPasteToken}
                    onChange={(e) => setBearerPasteToken(e.target.value)}
                    placeholder="eyJ…"
                  />
                </label>
                <div className="demo-data-actions demo-data-actions--wrap">
                  <button
                    type="button"
                    className="demo-data-btn primary"
                    disabled={bearerBusy}
                    onClick={handleBearerProbeAccounts}
                  >
                    {bearerBusy ? 'Trying…' : 'Try “list accounts” with this token'}
                  </button>
                  <a className="demo-data-btn ghost" href="/api/auth/oauth/user/token-claims" target="_blank" rel="noreferrer">
                    See your current session token (JSON lesson)
                  </a>
                </div>
                {bearerProbe && (
                  <pre className="demo-data-agent-auth-probe" role="status">
                    {JSON.stringify(bearerProbe, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </section>
</details>

          <Link
            to={dashboardPath}
            className="demo-data-agent-open-icon"
            title="Open dashboard (AI assistant)"
            aria-label="Open dashboard (AI assistant)"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 8V4H8" />
              <rect width="16" height="12" x="4" y="8" rx="2" />
              <path d="M2 14h2" />
              <path d="M20 14h2" />
              <path d="M15 13v2" />
              <path d="M9 13v2" />
            </svg>
          </Link>

          {loading ? (
            <section className="section">
              <p className="demo-data-loading">Loading…</p>
            </section>
          ) : (
            <>
            <form className="demo-data-form" onSubmit={handleSubmit}>
              <section className="section demo-data-section">
                <h2>User profile</h2>
                <p className="demo-data-hint">
                  These fields update your signed-in user record. Immutable fields (<code>id</code>, <code>password</code>,{' '}
                  <code>createdAt</code>) are not editable here.
                </p>
                {(userMeta.id || userMeta.role || userMeta.createdAt) && (
                  <p className="demo-data-readonly-meta" aria-label="Account metadata">
                    {userMeta.id && (
                      <span>
                        User ID: <code>{userMeta.id}</code>
                      </span>
                    )}
                    {userMeta.role && (
                      <span>
                        Role: <strong>{userMeta.role}</strong>
                      </span>
                    )}
                    {userMeta.createdAt && (
                      <span>
                        Created: <time dateTime={userMeta.createdAt}>{userMeta.createdAt}</time>
                      </span>
                    )}
                  </p>
                )}
                <div className="demo-data-profile-grid">
                  <label className="demo-data-field">
                    <span>First name</span>
                    <input
                      type="text"
                      autoComplete="given-name"
                      value={profile.firstName}
                      onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                      maxLength={300}
                    />
                  </label>
                  <label className="demo-data-field">
                    <span>Last name</span>
                    <input
                      type="text"
                      autoComplete="family-name"
                      value={profile.lastName}
                      onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                      maxLength={300}
                    />
                  </label>
                  <label className="demo-data-field">
                    <span>Email</span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={profile.email}
                      onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                      maxLength={300}
                    />
                  </label>
                  <label className="demo-data-field">
                    <span>Username</span>
                    <input
                      type="text"
                      autoComplete="username"
                      value={profile.username}
                      onChange={(e) => setProfile((p) => ({ ...p, username: e.target.value }))}
                      maxLength={300}
                    />
                  </label>
                </div>
                <label className="demo-data-field demo-data-field--checkbox">
                  <input
                    type="checkbox"
                    checked={profile.isActive}
                    onChange={(e) => setProfile((p) => ({ ...p, isActive: e.target.checked }))}
                  />
                  <span>Account active</span>
                </label>
              </section>

              <section className="section demo-data-section">
                <h2>Step-up thresholds (USD)</h2>
                <p className="demo-data-hint">
                  Same values as the <strong>$ Thresholds</strong> button on the dashboard — changes here are reflected there immediately.
                  <br />
                  <strong>Confirm (consent)</strong> — all transfers always require consent; this threshold applies to withdrawals and deposits.
                  <strong> MFA step-up</strong> — transfers and withdrawals at or above this amount require step-up authentication.
                </p>
                {threshLoading ? (
                  <p className="demo-data-loading">Loading…</p>
                ) : (
                  <>
                    <label className="demo-data-field">
                      <span>Confirm (consent) $</span>
                      <input type="number" min="1" step="50" className="demo-data-input" value={confirmThreshUsd} onChange={(e) => setConfirmThreshUsd(e.target.value)} />
                    </label>
                    <label className="demo-data-field" style={{ marginTop: '0.5rem' }}>
                      <span>MFA step-up $</span>
                      <input type="number" min="1" step="50" className="demo-data-input" value={mfaThreshUsd} onChange={(e) => setMfaThreshUsd(e.target.value)} />
                    </label>
                    <div className="demo-data-actions" style={{ marginTop: '0.75rem' }}>
                      <button type="button" className="demo-data-btn primary" onClick={handleSaveGlobalThresholds} disabled={threshSaving}>
                        {threshSaving ? 'Saving…' : 'Save thresholds'}
                      </button>
                      {threshStatus === 'saved' && <span style={{ color: '#15803d', fontSize: '0.85rem' }}>✓ Saved</span>}
                      {threshStatus === 'error' && <span style={{ color: '#b91c1c', fontSize: '0.85rem' }}>Error saving</span>}
                    </div>
                  </>
                )}
              </section>

              <section className="section demo-data-section">
                <div className="demo-data-accounts-header">
                  <h2>Accounts</h2>
                  <span className="demo-data-accounts-hint">Check a type to include it; uncheck to exclude. One account per type.</span>
                </div>
                <div className="demo-data-type-slots">
                  {ACCOUNT_TYPES.map((s) => {
                    const slot = typeSlots[s.type] || {};
                    return (
                      <div
                        key={s.type}
                        className={`demo-data-type-slot${slot.enabled ? ' demo-data-type-slot--on' : ''}`}
                      >
                        <label className="demo-data-type-slot__toggle" title={slot.enabled ? 'Disable this account type' : 'Enable this account type'}>
                          <input
                            type="checkbox"
                            checked={!!slot.enabled}
                            onChange={(e) => handleSlotChange(s.type, 'enabled', e.target.checked)}
                          />
                          <span className="demo-data-type-slot__icon">{s.icon}</span>
                          <span className="demo-data-type-slot__label">{s.label}</span>
                          {slot.enabled && slot.accountNumber && (
                            <code className="demo-data-type-slot__num">{slot.accountNumber}</code>
                          )}
                        </label>
                        {slot.enabled && (
                          <div className="demo-data-type-slot__fields">
                            <label className="demo-data-field demo-data-field--inline">
                              <span>Nickname</span>
                              <input
                                type="text"
                                value={slot.name}
                                placeholder={s.defaultName}
                                onChange={(e) => handleSlotChange(s.type, 'name', e.target.value)}
                                maxLength={120}
                              />
                            </label>
                            <label className="demo-data-field demo-data-field--inline demo-data-field--narrow">
                              <span>Balance (USD)</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={slot.balance}
                                onChange={(e) => handleSlotChange(s.type, 'balance', e.target.value)}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="section demo-data-actions-row">
                <div className="demo-data-actions">
                  <button type="button" className="demo-data-btn ghost" onClick={handleResetDefaults} disabled={!defaults}>
                    Reset form to defaults
                  </button>
                  <button type="submit" className="demo-data-btn primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </section>
            </form>

            {/* ── Account Profile Fields ── */}
            <section className="section demo-data-section" aria-labelledby="demo-acct-profile-heading">
              <button
                type="button"
                onClick={() => setCollapsedSections((prev) => ({ ...prev, accountProfile: !prev.accountProfile }))}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  padding: 0,
                  margin: 0,
                }}
                aria-expanded={!collapsedSections.accountProfile}
              >
                <h2 className="demo-data-section__heading" id="demo-acct-profile-heading" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem', minWidth: '1rem', display: 'inline-block' }}>
                    {collapsedSections.accountProfile ? '▶' : '▼'}
                  </span>
                  Account Profile Fields{' '}
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 400, color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '0.1rem 0.4rem' }}>
                    Sensitive fields require sensitive:read
                  </span>
                </h2>
              </button>
              {!collapsedSections.accountProfile && (
              <>
              <p className="demo-data-hint">
                Configure extended account details returned by the AI agent after the user grants explicit consent.
                Fields marked <strong>Sensitive</strong> are only returned via the{' '}
                <code>get_sensitive_account_details</code> tool after consent. Toggle{' '}
                <em>Include in response</em> to control which sensitive fields the demo exposes.
              </p>
              {ACCOUNT_TYPES.filter((s) => typeSlots[s.type]?.enabled).length === 0 && (
                <p className="demo-data-hint" style={{ fontStyle: 'italic' }}>
                  No accounts enabled. Enable accounts in the <strong>Accounts</strong> section above.
                </p>
              )}
              {ACCOUNT_TYPES.filter((s) => typeSlots[s.type]?.enabled).map((s) => {
                const slot = typeSlots[s.type];
                const prof = accountProfiles[s.type] || defaultAccountProfile(s.type, '');
                const setProf = (field, value) =>
                  setAccountProfiles((prev) => ({
                    ...prev,
                    [s.type]: { ...(prev[s.type] || defaultAccountProfile(s.type, '')), [field]: value },
                  }));
                return (
                  <div key={s.type} className="demo-data-type-slot demo-data-type-slot--on" style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
                      {s.icon} {slot.name || s.defaultName}
                      {slot.accountNumber && (
                        <code className="demo-data-type-slot__num">{slot.accountNumber}</code>
                      )}
                    </div>
                    <div className="demo-data-type-slot__fields">
                      {[
                        ['swiftCode', 'SWIFT Code'],
                        ['iban', 'IBAN'],
                        ['branchName', 'Branch Name'],
                        ['branchCode', 'Branch Code'],
                        ['openedDate', 'Opened Date'],
                        ['accountHolderName', 'Account Holder Name'],
                      ].map(([field, label]) => (
                        <label key={field} className="demo-data-field demo-data-field--inline">
                          <span>{label}</span>
                          <input
                            type="text"
                            value={prof[field] || ''}
                            onChange={(e) => setProf(field, e.target.value)}
                            maxLength={200}
                          />
                        </label>
                      ))}
                      <div style={{ border: '1px solid #fcd34d', borderRadius: 6, padding: '0.5rem 0.75rem', background: '#fffbeb', marginTop: '0.5rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#92400e', marginBottom: '0.4rem' }}>
                          Sensitive — requires sensitive:read
                        </div>
                        <label className="demo-data-field demo-data-field--inline">
                          <span>Routing Number</span>
                          <input
                            type="text"
                            value={prof.routingNumber || ''}
                            onChange={(e) => setProf('routingNumber', e.target.value)}
                            maxLength={50}
                          />
                        </label>
                        <label className="demo-data-field demo-data-field--checkbox" style={{ marginTop: '0.25rem' }}>
                          <input
                            type="checkbox"
                            checked={!!prof.includeRoutingNumber}
                            onChange={(e) => setProf('includeRoutingNumber', e.target.checked)}
                          />
                          <span>Include routing number in response</span>
                        </label>
                        <label className="demo-data-field demo-data-field--inline" style={{ marginTop: '0.5rem' }}>
                          <span>Full Account Number</span>
                          <input
                            type="text"
                            value={prof.accountNumberFull || ''}
                            onChange={(e) => setProf('accountNumberFull', e.target.value)}
                            maxLength={50}
                          />
                        </label>
                        <label className="demo-data-field demo-data-field--checkbox" style={{ marginTop: '0.25rem' }}>
                          <input
                            type="checkbox"
                            checked={!!prof.includeAccountNumberFull}
                            onChange={(e) => setProf('includeAccountNumberFull', e.target.checked)}
                          />
                          <span>Include full account number in response</span>
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="demo-data-actions" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="demo-data-btn primary"
                  disabled={accountProfileSaving}
                  onClick={handleSaveAccountProfiles}
                >
                  {accountProfileSaving ? 'Saving\u2026' : 'Save account profile fields'}
                </button>
              </div>
                          </>
              )}
            </section>

                        {/* \u2500\u2500 Agent Scope Permissions (separate save \u2014 calls /api/admin/config) \u2500\u2500 */}
            <section className="section demo-data-section" aria-labelledby="demo-scope-heading">
              <h2 className="demo-data-section__heading" id="demo-scope-heading">Agent scope permissions</h2>
              <p className="demo-data-hint">
                Controls which OAuth scopes are included in the RFC 8693 token exchange when the AI agent calls a tool.
                <br />
                <strong>read</strong> — agent can view accounts, balances, and transactions.
                <strong> write</strong> — agent can transfer funds and make deposits.
                Broad scopes (<em>read</em>, <em>write</em>) satisfy any matching tool;
                specific scopes are finer-grained alternatives.
              </p>
              <div className="demo-data-scope-list">
                {AGENT_MCP_SCOPE_CATALOG.map((row) => {
                  const checked = allowedScopes.has(row.scope);
                  return (
                    <label
                      key={row.scope}
                      className={`demo-data-scope-row${checked ? ' demo-data-scope-row--on' : ''}${row.group === 'broad' ? ' demo-data-scope-row--broad' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => handleScopeToggle(row.scope, e.target.checked)}
                        style={{ marginTop: '0.2rem', flexShrink: 0 }}
                      />
                      <span className="demo-data-scope-body">
                        <span className="demo-data-scope-label">{row.label}</span>
                        <code className="demo-data-scope-code">{row.scope}</code>
                        <span className="demo-data-scope-desc">{row.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="demo-data-actions" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="demo-data-btn primary"
                  disabled={scopeSaving}
                  onClick={handleSaveScopes}
                >
                  {scopeSaving ? 'Saving…' : 'Save scope permissions'}
                </button>
              </div>
            </section>

            <section className="section demo-data-section" aria-labelledby="demo-marketing-login-heading">
              <h2 className="demo-data-section__heading" id="demo-marketing-login-heading">
                Marketing page customer sign-in
              </h2>
              <p className="demo-data-hint">
                <strong>Teaching note:</strong> this controls what learners see when they click customer sign-in on the
                home / marketing page. <strong>Redirect</strong> is the simplest story — full browser hop to PingOne with
                standard OAuth (code + PKCE). <strong>Slide panel + pi.flow</strong> adds demo hints and uses Ping’s flow
                mode (<code>use_pi_flow=1</code>, <code>response_type=pi.flow</code>) so the real login still lives at
                PingOne — useful when you want to contrast “embedded” sign-in with unsafe “paste your password into an AI”
                habits. Needs a PingOne app that supports pi.flow; otherwise switch back to <strong>Redirect</strong>. Same
                options exist under <Link to="/config">Application setup</Link>.
              </p>
              <label className="demo-data-field">
                <span>Customer login mode</span>
                <select
                  value={marketingLoginMode}
                  onChange={(e) => setMarketingLoginMode(e.target.value)}
                >
                  <option value="redirect">Redirect — standard authorize (code + PKCE)</option>
                  <option value="slide_pi_flow">Slide panel — hints + pi.flow (?use_pi_flow=1)</option>
                </select>
              </label>
              <label className="demo-data-field">
                <span>Demo username hint (not a secret)</span>
                <input
                  type="text"
                  value={marketingUserHint}
                  onChange={(e) => setMarketingUserHint(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. bankuser"
                  autoComplete="off"
                />
              </label>
              <label className="demo-data-field">
                <span>Demo password hint (not a secret)</span>
                <input
                  type="text"
                  value={marketingPassHint}
                  onChange={(e) => setMarketingPassHint(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. your sandbox password"
                  autoComplete="off"
                />
              </label>
              <div className="demo-data-actions" style={{ marginTop: '1rem' }}>
                <button
                  type="button"
                  className="demo-data-btn primary"
                  disabled={marketingSaving}
                  onClick={handleSaveMarketingLogin}
                >
                  {marketingSaving ? 'Saving…' : 'Save marketing sign-in'}
                </button>
              </div>
            </section>

            {/* ── PingOne Authorize flags (all users — live vs simulated, MCP first tool, etc.) ── */}
            <section className="section demo-data-section" aria-labelledby="demo-p1az-flags-heading">
                <h2 className="demo-data-section__heading" id="demo-p1az-flags-heading">
                  PingOne Authorize — demo toggles
                </h2>
                <p className="demo-data-hint">
                  These are the same switches as <Link to="/feature-flags">Feature Flags</Link> (PingOne Authorize
                  category). <strong>Live PingOne</strong> calls the real decision API when{' '}
                  <strong>Simulated Authorize</strong> is <strong>off</strong> and you have a decision endpoint + worker
                  app in <Link to="/config">Application Configuration</Link>. <strong>Simulated Authorize on</strong> keeps
                  evaluation in-process (education). <strong>First MCP tool</strong> adds a policy check on the first
                  BankingAgent tool call per session when configured.
                </p>

                <div
                  className="demo-data-static-notice"
                  style={{ marginTop: '0.75rem', marginBottom: '0.75rem', borderColor: '#93c5fd', background: '#eff6ff' }}
                >
                  <span className="demo-data-static-notice__icon"></span>
                  <div style={{ flex: 1 }}>
                    <strong>Configure PingOne Authorize (worker + Management API)</strong>
                    <p className="demo-data-hint" style={{ margin: '0.35rem 0 0.5rem' }}>
                      Uses your <strong>Authorize worker</strong> app (client credentials) to call PingOne{' '}
                      <code>POST …/decisionEndpoints</code> and create two endpoints:{' '}
                      <em>AI Demo — Transactions</em> and <em>AI Demo — MCP first tool</em>. If they
                      already exist, their IDs are reused. Optionally pass a <strong>policy ID</strong> or{' '}
                      <strong>authorization version ID</strong> from PingOne Authorize (published policy); otherwise
                      PingOne attaches the latest policy version at runtime per PingOne docs.
                    </p>
                    <div className="demo-data-field-row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                      <label className="demo-data-field" style={{ flex: '1 1 200px' }}>
                        <span className="demo-data-field__label">Policy ID (optional)</span>
                        <input
                          type="text"
                          className="demo-data-input"
                          value={p1azBootstrapPolicyId}
                          onChange={(e) => setP1azBootstrapPolicyId(e.target.value)}
                          placeholder="PingOne policy UUID"
                          autoComplete="off"
                        />
                      </label>
                      <label className="demo-data-field" style={{ flex: '1 1 200px' }}>
                        <span className="demo-data-field__label">Authorization version ID (optional)</span>
                        <input
                          type="text"
                          className="demo-data-input"
                          value={p1azBootstrapAuthVer}
                          onChange={(e) => setP1azBootstrapAuthVer(e.target.value)}
                          placeholder="Pinned policy version UUID"
                          autoComplete="off"
                        />
                      </label>
                    </div>
                    <label className="demo-data-field demo-data-field--checkbox" style={{ marginTop: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={p1azBootstrapEnableLive}
                        onChange={(e) => setP1azBootstrapEnableLive(e.target.checked)}
                      />
                      <span>
                        After bootstrap: turn <strong>on</strong> live transaction Authorize and turn <strong>off</strong>{' '}
                        simulated Authorize (saved with endpoint IDs when config persistence is available)
                      </span>
                    </label>
                    <label className="demo-data-field demo-data-field--checkbox">
                      <input
                        type="checkbox"
                        checked={p1azBootstrapEnableMcp}
                        onChange={(e) => setP1azBootstrapEnableMcp(e.target.checked)}
                      />
                      <span>
                        Also enable <strong>First MCP tool</strong> Authorize flag and save MCP endpoint ID
                      </span>
                    </label>
                    <div className="demo-data-actions" style={{ marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        className="demo-data-btn primary"
                        disabled={p1azBootstrapBusy}
                        onClick={handleP1azAuthorizeBootstrap}
                      >
                        {p1azBootstrapBusy ? 'Calling PingOne…' : 'Create / link Authorize decision endpoints'}
                      </button>
                    </div>
                  </div>
                </div>

                {p1azFlagsLoading && <p className="demo-data-loading">Loading Authorize flags…</p>}
                {p1azFlagsError && (
                  <p style={{ color: '#b91c1c', fontSize: '0.9rem' }} role="alert">
                    {p1azFlagsError}
                  </p>
                )}
                {!p1azFlagsLoading && p1azFlags.length > 0 && (
                  <div className="demo-data-scope-list" style={{ marginTop: '0.75rem' }}>
                    {p1azFlags.map((flag) => {
                      const isOn = flag.value === true;
                      const showWarn =
                        (!isOn && flag.warnIfDisabled) || (isOn && flag.warnIfEnabled);
                      const warnMsg = flag.warnIfDisabled
                        ? 'Disabling may block transactions or reduce safety.'
                        : 'Enabling may reduce security — use for demos only.';
                      return (
                        <div
                          key={flag.id}
                          className={`demo-data-scope-row${isOn ? ' demo-data-scope-row--on' : ''}`}
                        >
                          <label className="demo-data-field demo-data-field--checkbox" style={{ alignItems: 'flex-start' }}>
                            <input
                              type="checkbox"
                              checked={isOn}
                              disabled={p1azFlagSaving === flag.id}
                              onChange={(e) => handleP1azFlagToggle(flag.id, e.target.checked)}
                              style={{ marginTop: '0.25rem', flexShrink: 0 }}
                            />
                            <span className="demo-data-scope-body">
                              <span className="demo-data-scope-label">{flag.name}</span>
                              <code className="demo-data-scope-code">{flag.id}</code>
                              <span className="demo-data-scope-desc">{flag.description}</span>
                              {showWarn && (
                                <span className="demo-data-scope-desc" style={{ color: '#b45309' }}>
                                  {warnMsg}
                                </span>
                              )}
                            </span>
                          </label>
                          {p1azFlagSaving === flag.id && (
                            <span style={{ fontSize: '0.75rem', color: '#374151' }}>Saving…</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="demo-data-hint" style={{ marginTop: '0.75rem' }}>
                  <Link to="/feature-flags">Open full Feature Flags</Link>
                  {' · '}
                  <Link to="/config">PingOne / OAuth config</Link>
                </p>

                {/* ── Token endpoint auth method overrides (Phase 110) ── */}
                <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-light,#e2e8f0)', paddingTop: '1rem' }}>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.4rem', color: '#374151' }}>
                    Token endpoint authentication method
                  </h3>
                  <p className="demo-data-hint" style={{ marginBottom: '0.75rem' }}>
                    Override the auth method the BFF uses when exchanging tokens with PingOne.
                    Leave blank to use the env var default (
                    <code>AI_AGENT_TOKEN_ENDPOINT_AUTH_METHOD</code> /{' '}
                    <code>MCP_EXCHANGER_TOKEN_ENDPOINT_AUTH_METHOD</code>).
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>
                      AI Agent App
                      <select
                        value={agentTokenEndpointAuth}
                        onChange={(e) => setAgentTokenEndpointAuth(e.target.value)}
                        style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }}
                      >
                        <option value="">— use env var —</option>
                        <option value="client_secret_basic">client_secret_basic</option>
                        <option value="client_secret_post">client_secret_post</option>
                        <option value="client_secret_jwt">client_secret_jwt</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>
                      MCP Token Exchanger
                      <select
                        value={mcpTokenEndpointAuth}
                        onChange={(e) => setMcpTokenEndpointAuth(e.target.value)}
                        style={{ padding: '0.35rem 0.5rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.8rem' }}
                      >
                        <option value="">— use env var —</option>
                        <option value="client_secret_basic">client_secret_basic</option>
                        <option value="client_secret_post">client_secret_post</option>
                        <option value="client_secret_jwt">client_secret_jwt</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="demo-data-btn ghost"
                      onClick={handleTokenAuthSave}
                      disabled={tokenAuthSaving}
                      style={{ alignSelf: 'flex-end' }}
                    >
                      {tokenAuthSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </section>

            {/* ── act claim — AI-Agent resource attribute check ── */}
            <section className="section demo-data-section" aria-labelledby="demo-act-claim-heading">
              <h2 className="demo-data-section__heading" id="demo-act-claim-heading">PingOne Setup — <code>act</code> claim attribute</h2>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
                The <code>act</code> claim in the exchanged token proves <em>which agent</em> performed the RFC&nbsp;8693 exchange
                on behalf of the user. It must be mapped on the{' '}
                <strong>AI-Agent resource</strong> (<code>agentgateway.ping.demo</code>) in PingOne using the SPEL expression{' '}
                <code>{'{"sub":"$'}{'{tokenContext.actor.sub}'}{'"}'}</code>.
                Use <strong>Check</strong> to verify the mapping exists, and <strong>Fix</strong> to create or correct it automatically.
              </p>
              <div className="demo-data-actions" style={{ flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="demo-data-btn ghost"
                  onClick={handleCheckActClaim}
                  disabled={actClaimChecking || actClaimFixing}
                >
                  {actClaimChecking ? 'Checking…' : 'Check act claim'}
                </button>
                <button
                  type="button"
                  className="demo-data-btn primary"
                  onClick={handleFixActClaim}
                  disabled={actClaimFixing || actClaimChecking || actClaimStatus?.status === 'ok'}
                >
                  {actClaimFixing ? 'Fixing…' : 'Fix act claim'}
                </button>
                {actClaimStatus && (
                  <span style={{ fontSize: '0.85rem', marginLeft: '0.25rem' }}>
                    {actClaimStatus.status === 'ok' && <span style={{ color: '#15803d' }}>act attribute present and correct</span>}
                    {actClaimStatus.status === 'missing' && <span style={{ color: '#b45309' }}>act attribute missing — click Fix</span>}
                    {actClaimStatus.status === 'wrong_value' && <span style={{ color: '#b45309' }}>act has wrong SPEL — click Fix to correct</span>}
                    {actClaimStatus.status === 'missing_resource' && <span style={{ color: '#b91c1c' }}>AI-Agent resource not found: {actClaimStatus.detail}</span>}
                    {actClaimStatus.status === 'error' && <span style={{ color: '#b91c1c' }}>{actClaimStatus.detail}</span>}
                  </span>
                )}
              </div>
              {actClaimStatus && actClaimStatus.status !== 'ok' && actClaimStatus.status !== 'missing' && (
                <details style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#374151' }}>
                  <summary style={{ cursor: 'pointer' }}>Details</summary>
                  <pre style={{ marginTop: '0.35rem', overflowX: 'auto' }}>{JSON.stringify(actClaimStatus, null, 2)}</pre>
                </details>
              )}
            </section>

            <section className="section demo-data-section" aria-labelledby="demo-reset-heading">
              <h2 id="demo-reset-heading">Reset Demo State</h2>
              <p style={{ marginBottom: '0.75rem', color: 'var(--text-muted, #6b7280)', fontSize: '0.9rem' }}>
                Clears all agent conversation history, token chain events, and MCP audit logs on the server, then reloads the page.
                Your login session is preserved.
              </p>
              <button
                type="button"
                className="demo-data-btn"
                style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
                onClick={handleResetDemo}
                disabled={demoResetting}
              >
                {demoResetting ? 'Resetting…' : 'Reset Demo'}
              </button>
            </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
