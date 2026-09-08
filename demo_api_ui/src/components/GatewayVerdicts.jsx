import React, { useCallback, useState } from 'react';
import './GatewayVerdicts.css';

/**
 * Gateway findings for the AI Guard page.
 *
 * The gateway records more about each decision than the response carries. A
 * block returns HTTP 400 and a sanitize shows up as [REDACTED:pii] inline, but
 * the compliance mappings — MITRE ATLAS, NIST AI RMF, OWASP LLM — exist only in
 * the gateway's own verdict log. Those are the reason this panel exists; the
 * verdicts themselves are already visible on the page.
 *
 * It reads them the honest way: through the governed gateway, via the
 * `opensearch22` Agentic App that the Generic MCP Inspector already talks to
 * (profile `built-in-privilege-opensearch`, DCR + PKCE per door). No new BFF
 * route, no direct OpenSearch access — the datastore has security disabled and
 * is deliberately not exposed.
 *
 * It CANNOT populate on its own. That app's authorization server advertises
 * `grant_types_supported: ['authorization_code','refresh_token']` and no
 * client_credentials, so a human signs in once per session. The panel says so
 * rather than sitting empty and looking broken.
 *
 * The inspector signals that state as **HTTP 200** with
 * `{ tools: [], privilege_login_required: true, loginUrl }` — NOT a 401. An
 * earlier version of this file checked status codes and would have rendered
 * "this door exposes no search tool" for a door that was merely not connected
 * yet. Verified live 2026-09-08 against built-in-privilege-opensearch, which
 * returned exactly that shape. Read the body, not the status.
 *
 * `error: true` + `reason` is the genuine-failure shape, also at 200.
 */

const PROFILE_ID = 'built-in-privilege-opensearch';
const INDEX = 'gateway-events';
const INSPECTOR_BASE = '/api/mcp/inspector';

// Frameworks the gateway maps findings onto, in the order a security reviewer
// reads them. Anything unrecognised still renders, labelled with its raw name.
const FRAMEWORK_LABELS = {
  mitre_atlas: 'MITRE ATLAS',
  nist_ai_rmf: 'NIST AI RMF',
  owasp_llm: 'OWASP LLM',
};

const EVENT_TONE = {
  llm_request_blocked: 'bad',
  llm_response_sanitized: 'warn',
  llm_request_alert: 'warn',
};

export function frameworkLabel(framework) {
  return FRAMEWORK_LABELS[framework] || framework;
}

/**
 * Normalise one raw gateway document into what the panel renders.
 *
 * VirtualKeyID is a live credential (`sk-orion-…`) and is dropped here rather
 * than filtered at render time, so it cannot reach component state at all.
 */
export function normalizeVerdict(doc) {
  const src = (doc && doc._source) || doc || {};
  const mappings = Array.isArray(src.ComplianceMappings) ? src.ComplianceMappings : [];
  return {
    time: src.time || src.RequestTS || null,
    category: src.Category || 'unknown',
    direction: src.Direction || 'unknown',
    event: src.Event || 'unknown',
    tone: EVENT_TONE[src.Event] || 'warn',
    mappings: mappings.map((m) => ({
      framework: m.Framework,
      label: frameworkLabel(m.Framework),
      identifier: m.Identifier,
      source: m.Source,
    })),
  };
}

/** Pick the profile's search tool without hardcoding a name we have not seen. */
export function pickSearchTool(tools) {
  const names = (tools || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean);
  return names.find((n) => /search/i.test(n)) || names.find((n) => /query/i.test(n)) || null;
}

/**
 * Is this response the "sign in to this door first" state?
 *
 * The inspector reports it as 200 with a flag in the body, so a status-only
 * check misses it entirely and the caller mistakes an unconnected door for a
 * broken one. 401/403 stay covered as a fallback for other transports.
 */
export function authGate(res, body) {
  const b = body || {};
  if (b.privilege_login_required || b.pingone_admin_login_required) {
    return { loginUrl: b.loginUrl || null };
  }
  if (res && (res.status === 401 || res.status === 403)) return { loginUrl: b.loginUrl || null };
  return null;
}

export default function GatewayVerdicts({ fetchImpl }) {
  const [state, setState] = useState('idle'); // idle | loading | ready | needsAuth | error
  const [verdicts, setVerdicts] = useState([]);
  const [error, setError] = useState(null);
  const [loginUrl, setLoginUrl] = useState(null);

  const doFetch = fetchImpl || ((url, opts) => fetch(url, opts));

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const toolsRes = await doFetch(`${INSPECTOR_BASE}/tools?profile=${encodeURIComponent(PROFILE_ID)}`, {
        credentials: 'include',
      });
      const toolsBody = await toolsRes.json().catch(() => ({}));
      const gate = authGate(toolsRes, toolsBody);
      if (gate) {
        setLoginUrl(gate.loginUrl || null);
        setState('needsAuth');
        return;
      }
      if (!toolsRes.ok) throw new Error(toolsBody.error || `HTTP ${toolsRes.status}`);
      if (toolsBody.error) throw new Error(toolsBody.reason || 'The door reported an error.');

      const tool = pickSearchTool(toolsBody.tools);
      if (!tool) {
        throw new Error('This door is connected but exposes no search tool, so its verdict log cannot be queried from here.');
      }

      const invokeRes = await doFetch(`${INSPECTOR_BASE}/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          profile: PROFILE_ID,
          tool,
          params: {
            index: INDEX,
            query: { match: { msg: 'AIGuard' } },
            size: 25,
            sort: [{ time: { order: 'desc' } }],
          },
        }),
      });
      const invokeBody = await invokeRes.json().catch(() => ({}));
      const invokeGate = authGate(invokeRes, invokeBody);
      if (invokeGate) {
        setLoginUrl(invokeGate.loginUrl || null);
        setState('needsAuth');
        return;
      }
      if (!invokeRes.ok) throw new Error(invokeBody.error || `HTTP ${invokeRes.status}`);

      const hits = invokeBody?.result?.hits?.hits || invokeBody?.hits?.hits || [];
      setVerdicts(hits.map(normalizeVerdict));
      setState('ready');
    } catch (err) {
      setError(err.message || String(err));
      setState('error');
    }
  }, [doFetch]);

  return (
    <section className="gwv" data-testid="gateway-verdicts">
      <div className="gwv__head">
        <h3 className="gwv__title">Gateway findings</h3>
        <button type="button" className="gwv__btn" onClick={load} disabled={state === 'loading'}>
          {state === 'loading' ? 'Loading…' : verdicts.length ? 'Refresh' : 'Load findings'}
        </button>
      </div>

      <p className="gwv__note">
        Compliance mappings for each decision, read through the gateway itself. The verdicts are
        already visible above &mdash; these framework identifiers are not.
      </p>

      {state === 'needsAuth' ? (
        <p className="gwv__note gwv__note--auth" data-testid="gwv-needs-auth">
          This door needs its own sign-in before it will answer &mdash; its authorization server
          offers no client-credentials grant, so the panel cannot populate on its own.{' '}
          {loginUrl ? (
            <a className="gwv__login" href={loginUrl} data-testid="gwv-login-link">
              Sign in to this door
            </a>
          ) : (
            <>Connect the Privilege&nbsp;OpenSearch door in the MCP Inspector</>
          )}
          , then load again.
        </p>
      ) : null}

      {state === 'error' ? (
        <p className="gwv__note gwv__note--error" data-testid="gwv-error">{error}</p>
      ) : null}

      {state === 'ready' && verdicts.length === 0 ? (
        <p className="gwv__note" data-testid="gwv-empty">
          No findings recorded yet. Fire an attack from the library above, then load again.
        </p>
      ) : null}

      {verdicts.length ? (
        <ul className="gwv__list" data-testid="gwv-list">
          {verdicts.map((v, i) => (
            <li key={i} className={`gwv__item is-${v.tone}`}>
              <div className="gwv__row">
                <span className="gwv__cat">{v.category}</span>
                <span className="gwv__event">{v.event}</span>
                <span className="gwv__dir">{v.direction}</span>
                {v.time ? <span className="gwv__time">{v.time}</span> : null}
              </div>
              {v.mappings.length ? (
                <div className="gwv__frameworks">
                  {v.mappings.map((m, j) => (
                    <span key={j} className="gwv__fw" title={m.source || undefined}>
                      <span className="gwv__fw-label">{m.label}</span>
                      <span className="gwv__fw-id">{m.identifier}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
