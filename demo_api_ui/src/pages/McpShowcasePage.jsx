import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import WeatherStateControl from '../components/WeatherStateControl';
import WeatherBlocklistControl from '../components/WeatherBlocklistControl';
import ThemeToggle from '../components/common/ThemeToggle';
import { useVertical } from '../vertical/useVertical';
import './McpShowcasePage.css';

/**
 * One page, two capabilities. The weather and Brave showcases tell the SAME
 * story — the Agent Gateway fronts a third-party MCP server it does not own and
 * enforces a policy the backend never sees — and differ only in what the policy
 * is (a geographic scope vs a content blocklist) and which flags drive it.
 * Two near-identical page files would drift; this is one component and a config.
 *
 * Both pages replace what used to be a bare nav ACTION for weather: a click that
 * POSTed a use case and bounced to /dashboard with no explanation of the policy
 * it was about to demonstrate. `WeatherStateControl` in particular was imported
 * nowhere at all, while the capability card claimed it was "configurable live,
 * right on this card" — this page is where it actually lives now.
 */

const SHOWCASES = {
  weather: {
    slug: 'weather',
    title: 'Weather MCP',
    subtitle: 'A third-party weather server, scoped at the gateway',
    lede:
      'The agent calls a real, unmodified third-party MCP server. The Agent Gateway '
      + 'fronts it and enforces a geographic scope policy at the edge — the weather '
      + 'server itself has no concept of the restriction.',
    gatewayPath: '/mcp/weather',
    enableFlag: 'ff_weather_mcp_showcase',
    policyKind: 'scope',
    policyTitle: 'Allowed region',
    policyNote:
      'Read live on every request, so the same query flips denied to allowed '
      + 'mid-demo with no gateway restart.',
    codeRefs: [
      'ping-gateway/scripts/groovy/tx-weather-scope.groovy',
      'ping-gateway/config/routes/00-mcp-weather.json',
      'demo_api_server/routes/weatherMcpFlag.js',
    ],
    runs: [
      {
        useCaseId: 'weather-mcp-texas-permit',
        label: "what's the weather in Austin, TX",
        outcome: 'PERMIT',
        note: 'In the allowed region — the gateway forwards the call.',
      },
      {
        useCaseId: 'weather-mcp-texas-deny',
        label: "what's the weather in Miami",
        outcome: 'DENY',
        note: 'Out of policy — killed before the third party ever sees it.',
      },
    ],
    freeForm: {
      heading: 'Check any location',
      placeholder: 'Denver, CO',
      button: 'Check weather',
      prompt: (q) => `what's the weather in ${q}`,
      hint: 'Whatever the room shouts out. The policy decides, not the tool.',
    },
    // Worth stating on the page: it is the reason a location question can come
    // back as a list of places and no weather at all.
    twoStep:
      "The agent geocodes first. weather-mcp's own tool descriptions steer it to "
      + 'search_location (Nominatim) and then to get_current_conditions with the '
      + 'resolved coordinates, so the policy is enforced on the COORDINATE call — '
      + 'not the city name you typed.',
  },
  brave: {
    slug: 'brave',
    title: 'Brave Search MCP',
    subtitle: 'A remote third-party news search, filtered at the gateway',
    lede:
      'The agent calls the real Brave Search API (the brave_news_search tool) through '
      + 'a third-party MCP server. The Agent Gateway inspects the query and refuses '
      + 'blocked terms before the request ever leaves the perimeter.',
    gatewayPath: '/mcp/brave',
    enableFlag: 'ff_brave_mcp_showcase',
    policyKind: 'blocklist',
    policyTitle: 'Blocked search terms',
    // Mirrors BLOCKED_TERMS in tx-brave-scope.groovy. Hardcoded there, so
    // hardcoded here — a fake control that cannot change anything would be worse.
    blockedTerms: ['bitcoin', 'cryptocurrency', 'crypto'],
    policyNote:
      'Substring match on the query argument, enforced in the gateway. The list is '
      + 'fixed in tx-brave-scope.groovy — unlike the weather scope, there is no flag '
      + 'to change it live.',
    codeRefs: [
      'ping-gateway/scripts/groovy/tx-brave-scope.groovy',
      'ping-gateway/config/routes/00-mcp-brave.json',
      'demo_api_server/routes/braveMcpFlag.js',
    ],
    runs: [
      {
        useCaseId: 'brave-mcp-search-permit',
        label: 'search the news for PingOne DaVinci',
        outcome: 'PERMIT',
        note: 'No blocked term — the gateway forwards the search.',
      },
      {
        useCaseId: 'brave-mcp-crypto-deny',
        label: 'search the news for bitcoin price today',
        outcome: 'DENY',
        note: 'Bank policy: no crypto research through the agent gateway.',
      },
    ],
    freeForm: {
      heading: 'Search anything',
      placeholder: 'quantum computing',
      button: 'Search news',
      prompt: (q) => `search the news for ${q}`,
      hint: 'Any query. Include a blocked term to watch the gateway refuse it.',
    },
  },
};

export default function McpShowcasePage({ capability }) {
  const cfg = SHOWCASES[capability];
  const navigate = useNavigate();
  const { activeId: activeVerticalId } = useVertical() || {};
  const [enabled, setEnabled] = useState(null);
  const [running, setRunning] = useState(null);
  const [error, setError] = useState(null);
  const [freeText, setFreeText] = useState('');

  // GET on the flags endpoint is open to everyone (the pill needs it), so this
  // works signed out — the page must render the real policy for a guest.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/admin/feature-flags')
      .then(({ data }) => {
        if (cancelled) return;
        const flags = data?.flags || data || [];
        const hit = Array.isArray(flags)
          ? flags.find((f) => f.id === cfg.enableFlag)
          : null;
        setEnabled(hit ? hit.value !== false : true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.enableFlag]);

  // Same dispatch the old "Weather MCP" nav action used: run the use case, pin
  // the vertical, then hand the trigger text to the dashboard chat.
  const run = useCallback(
    async (useCaseId) => {
      const vertical = activeVerticalId || 'banking';
      setRunning(useCaseId);
      setError(null);
      try {
        const { data } = await apiClient.post('/api/use-cases/demo/run', {
          useCaseId,
          vertical,
        });
        await apiClient.post('/api/verticals/active', { id: vertical });
        navigate('/dashboard', {
          state: {
            useCaseId: data.useCaseId,
            triggerText: data.triggerText,
            type: data.type,
            vertical,
          },
        });
      } catch (err) {
        setRunning(null);
        setError(
          err?.response?.data?.error
            || 'Could not start the demo. The use case may be disabled.',
        );
      }
    },
    [activeVerticalId, navigate],
  );

  // Free-form ask. The canned Run buttons only cover the two scripted outcomes;
  // this sends an arbitrary prompt down the SAME path, so it produces the same
  // token chain and Proof strip rather than a side channel that proves nothing.
  // `useCaseId` is deliberately absent — AIAgent treats it as optional and this
  // run is not a catalog case, so it must not claim to be one.
  const askFreeForm = useCallback(
    async (e) => {
      e.preventDefault();
      const q = freeText.trim();
      if (!q || running) return;
      const vertical = activeVerticalId || 'banking';
      setRunning('free');
      setError(null);
      try {
        await apiClient.post('/api/verticals/active', { id: vertical });
        navigate('/dashboard', {
          state: { triggerText: cfg.freeForm.prompt(q), vertical },
        });
      } catch (err) {
        setRunning(null);
        setError(
          err?.response?.data?.error || 'Could not start that run.',
        );
      }
    },
    [freeText, running, activeVerticalId, navigate, cfg],
  );

  return (
    <div className={`mcpsc mcpsc--${cfg.slug}`}>
      <header className="mcpsc__head">
        <div className="mcpsc__head-top">
          <p className="mcpsc__eyebrow">Agent Gateway capability</p>
          <ThemeToggle />
        </div>
        <h1 className="mcpsc__title">{cfg.title}</h1>
        <p className="mcpsc__subtitle">{cfg.subtitle}</p>
        <p className="mcpsc__lede">{cfg.lede}</p>
        <dl className="mcpsc__facts">
          <div className="mcpsc__fact">
            <dt>Gateway route</dt>
            <dd><code>{cfg.gatewayPath}</code></dd>
          </div>
          <div className="mcpsc__fact">
            <dt>Capability</dt>
            <dd>
              <span
                className={`mcpsc__pill mcpsc__pill--${
                  enabled === null ? 'unknown' : enabled ? 'on' : 'off'
                }`}
              >
                {enabled === null ? 'unknown' : enabled ? 'enabled' : 'disabled'}
              </span>
              <code className="mcpsc__flagid">{cfg.enableFlag}</code>
            </dd>
          </div>
        </dl>
        {enabled === false ? (
          <p className="mcpsc__warn">
            This capability is switched off, so every call to{' '}
            <code>{cfg.gatewayPath}</code> is denied with HTTP 403 regardless of the
            policy below.
          </p>
        ) : null}
      </header>

      <section className="mcpsc__card">
        <h2>{cfg.policyTitle}</h2>
        {cfg.policyKind === 'scope' ? (
          <>
            <WeatherStateControl />
            <h3 className="mcpsc__subhead">Blocked cities</h3>
            <p className="mcpsc__note">
              Used by the <code>Any except blocked cities</code> mode. Each city is
              geocoded once when you add it, so the gateway denies it whether the
              agent sends the name or the coordinates it resolved.
            </p>
            <WeatherBlocklistControl />
          </>
        ) : (
          <ul className="mcpsc__terms">
            {cfg.blockedTerms.map((t) => (
              <li key={t}><code>{t}</code></li>
            ))}
          </ul>
        )}
        <p className="mcpsc__note">{cfg.policyNote}</p>
        {cfg.twoStep ? <p className="mcpsc__note">{cfg.twoStep}</p> : null}
      </section>

      <section className="mcpsc__card">
        <h2>Run it</h2>
        <p className="mcpsc__note">
          Each one sends the prompt to the agent on the dashboard and records a
          token chain you can inspect.
        </p>
        <ul className="mcpsc__runs">
          {cfg.runs.map((r) => (
            <li key={r.useCaseId} className="mcpsc__run">
              <div className="mcpsc__runtext">
                <span
                  className={`mcpsc__outcome mcpsc__outcome--${r.outcome.toLowerCase()}`}
                >
                  {r.outcome}
                </span>
                <code className="mcpsc__prompt">{r.label}</code>
                <span className="mcpsc__runnote">{r.note}</span>
              </div>
              <button
                type="button"
                className="mcpsc__btn"
                onClick={() => run(r.useCaseId)}
                disabled={running !== null}
              >
                {running === r.useCaseId ? 'Starting…' : 'Run'}
              </button>
            </li>
          ))}
        </ul>
        {cfg.freeForm ? (
          <>
            <h3 className="mcpsc__subhead">{cfg.freeForm.heading}</h3>
            <p className="mcpsc__note">{cfg.freeForm.hint}</p>
            <form className="mcpsc__free" onSubmit={askFreeForm}>
              <label className="mcpsc__srlabel" htmlFor="mcpsc-free">
                {cfg.freeForm.heading}
              </label>
              <input
                id="mcpsc-free"
                type="text"
                className="mcpsc__freeinput"
                placeholder={cfg.freeForm.placeholder}
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                disabled={running !== null}
              />
              <button
                type="submit"
                className="mcpsc__btn"
                disabled={running !== null || !freeText.trim()}
              >
                {running === 'free' ? 'Starting…' : cfg.freeForm.button}
              </button>
            </form>
          </>
        ) : null}

        {error ? <p className="mcpsc__error" role="alert">{error}</p> : null}
      </section>

      <section className="mcpsc__card">
        <h2>Where it is enforced</h2>
        <ul className="mcpsc__refs">
          {cfg.codeRefs.map((ref) => (
            <li key={ref}><code>{ref}</code></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
