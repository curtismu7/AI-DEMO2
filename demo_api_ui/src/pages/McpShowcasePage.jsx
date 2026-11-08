import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../services/apiClient';
import WeatherStateControl from '../components/WeatherStateControl';
import {
  WEATHER_SCOPE_FLAG_ID,
  markLeavingToRun,
  runUseCaseIdForScope,
} from '../utils/weatherScopeHandoff';
import WeatherBlocklistControl from '../components/WeatherBlocklistControl';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import { useVertical } from '../vertical/useVertical';
import { useThemeOptional } from '../context/ThemeContext';
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
 *
 * Layout follows the Ping UI Standard (docs/ping-ui-primitives.md): P2 banner
 * first, P3 frame, P4 cards, P5 key-value, P7 chips, P9 buttons. The standalone
 * shell bar (P1) is not added: the app has its own. Skipped: P6 inspector and
 * P8 diagram (this page has neither).
 *
 * Primary button (P9), exactly one per view state:
 *   - idle: the first scripted Run (the permit case, the start of the story)
 *   - free-form text entered: the free-form ask button
 *   - a run starting: the control that was pressed (it reads "Starting…")
 * The theme toggle, Block city and the city remove buttons are always secondary.
 * A control that cannot act right now uses aria-disabled, never disabled, so
 * keyboard focus stays where it was when a request is in flight or fails. Because such a
 * control can still be pressed, pressing one that has nothing to act on says why in words.
 *
 * Run needs a signed-in session: the dashboard (where the prompt goes) shows a sign-in
 * modal to a guest, and /api/use-cases/demo/run and /api/verticals/active both accept a
 * guest. So the page checks the session itself, says so, and refuses to navigate away
 * while it knows the visitor is signed out.
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
    bannerLead: 'LIVE POLICY, NO VERDICT HERE',
    banner:
      'the allowed state and the blocked cities below are real '
      + 'settings: changing one writes the gateway flag on this machine, and the gateway reads it '
      + 'on every request. This page itself makes no weather call and shows no permit or deny '
      + 'result. Each Run hands a prompt to the agent on the dashboard, where the call goes '
      + 'through the real Agent Gateway (it must be running), and needs a signed-in session. Permit '
      + 'and deny below are what the policy should do, not an outcome.',
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
      emptyHint: 'Enter a location first, for example Denver, CO.',
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
    bannerLead: 'READ-ONLY POLICY, NO VERDICT HERE',
    banner:
      'the blocked terms below are a fixed copy of the list in '
      + 'tx-brave-scope.groovy and cannot be changed from this page. This page itself makes no '
      + 'search and shows no permit or deny result. Each Run hands a prompt to the agent on the '
      + 'dashboard, where the call goes through the real Agent Gateway (it must be running), and '
      + 'needs a signed-in session. Permit and deny below are what the policy should do, not an outcome.',
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
      emptyHint: 'Enter a search first, for example quantum computing.',
      prompt: (q) => `search the news for ${q}`,
      hint: 'Any query. Include a blocked term to watch the gateway refuse it.',
    },
  },
};

export default function McpShowcasePage({ capability }) {
  const cfg = SHOWCASES[capability];
  const navigate = useNavigate();
  const { activeId: activeVerticalId } = useVertical() || {};
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [enabled, setEnabled] = useState(null);
  const [running, setRunning] = useState(null);
  const [error, setError] = useState(null);
  const [freeText, setFreeText] = useState('');
  const [freeHint, setFreeHint] = useState('');
  // null = not known (check pending or failed), true / false = what the session endpoints said.
  const [signedIn, setSignedIn] = useState(null);

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

  // Both status endpoints answer 200 with { authenticated } for a guest, so a guest reads as
  // false here, not as an error. Any failed check leaves it unknown and Run is not blocked.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiClient.get('/api/auth/oauth/user/status').then((r) => r.data, () => null),
      apiClient.get('/api/auth/oauth/status').then((r) => r.data, () => null),
    ]).then(([user, admin]) => {
      if (cancelled) return;
      if (user?.authenticated === true || admin?.authenticated === true) setSignedIn(true);
      else if (typeof user?.authenticated === 'boolean' && typeof admin?.authenticated === 'boolean') setSignedIn(false);
      else setSignedIn(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refuseSignedOut = useCallback(() => {
    setError('Not started: Run needs a signed-in session. Sign in with the button above, then run it again.');
  }, []);

  // Same dispatch the old "Weather MCP" nav action used: run the use case, pin
  // the vertical, then hand the trigger text to the dashboard chat.
  const run = useCallback(
    async (useCaseId) => {
      if (running !== null) return;
      if (signedIn === false) {
        refuseSignedOut();
        return;
      }
      const vertical = activeVerticalId || 'banking';
      setRunning(useCaseId);
      setError(null);
      try {
        const { data } = await apiClient.post('/api/use-cases/demo/run', {
          useCaseId,
          vertical,
        });
        await apiClient.post('/api/verticals/active', { id: vertical });
        let runUseCaseId = data.useCaseId;
        if (cfg.policyKind === 'scope') {
          // A changed scope makes this run UC32, whichever button was pressed.
          // Unreadable flags keep the button's own use case rather than block the run.
          const { data: flagData } = await apiClient
            .get('/api/admin/feature-flags')
            .catch(() => ({}));
          const flags = flagData?.flags || flagData || [];
          const scope = Array.isArray(flags)
            ? flags.find((f) => f.id === WEATHER_SCOPE_FLAG_ID)?.value
            : null;
          runUseCaseId = runUseCaseIdForScope(data.useCaseId, scope);
          // The scope control resets its policy when this page unmounts; mark this
          // navigation as the run the policy was changed for.
          markLeavingToRun();
        }
        navigate('/dashboard', {
          state: {
            useCaseId: runUseCaseId,
            triggerText: data.triggerText,
            type: data.type,
            vertical,
          },
        });
      } catch (err) {
        setRunning(null);
        setError(
          // A 401 carries a sentence for the visitor in `message`; `error` is a code.
          err?.response?.data?.message
            || err?.response?.data?.error
            || 'Could not start the demo. The use case may be disabled.',
        );
      }
    },
    [activeVerticalId, cfg, navigate, running, signedIn, refuseSignedOut],
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
      if (running) return;
      if (!q) {
        setFreeHint(cfg.freeForm.emptyHint);
        return;
      }
      if (signedIn === false) {
        refuseSignedOut();
        return;
      }
      const vertical = activeVerticalId || 'banking';
      setRunning('free');
      setError(null);
      try {
        await apiClient.post('/api/verticals/active', { id: vertical });
        if (cfg.policyKind === 'scope') markLeavingToRun();
        navigate('/dashboard', {
          state: { triggerText: cfg.freeForm.prompt(q), vertical },
        });
      } catch (err) {
        setRunning(null);
        setError(
          err?.response?.data?.message || err?.response?.data?.error || 'Could not start that run.',
        );
      }
    },
    [freeText, running, activeVerticalId, navigate, cfg, signedIn, refuseSignedOut],
  );

  const freeReady = Boolean(freeText.trim());
  // One primary per view state (see the header comment).
  const primaryKey = running !== null ? running : freeReady ? 'free' : cfg.runs[0].useCaseId;
  const capStatus = enabled === null
    ? { tone: 'neutral', word: 'Unknown' }
    : enabled
      ? { tone: 'ok', word: 'Enabled' }
      : { tone: 'danger', word: 'Disabled' };

  return (
    <PingPage className={`mcpsc mcpsc--${cfg.slug}`}>
      <SimBanner data-testid="mcpsc-banner">
        <strong>{cfg.bannerLead}</strong> — {cfg.banner}
      </SimBanner>
      <PageHeader
        eyebrow="Agent Gateway capability"
        title={cfg.title}
        summary={cfg.subtitle}
        actions={(
          // User-requested exception to the emoji allowlist (REGRESSION_PLAN
          // §0): sun/moon aren't in the approved set, but every other toggle
          // in the app uses a plain "Light mode"/"Dark mode" text label for
          // exactly that reason. Approved deliberately for this button.
          <ActionButton
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </ActionButton>
        )}
      />
      <PageFrame>
        <Section id="mcpsc-capability" kicker="1 · The capability" title="Route and status" lede={cfg.lede}>
          <CardGrid>
            <Card data-testid="mcpsc-capability">
              <KvList
                items={[
                  { label: 'Gateway route (config)', value: cfg.gatewayPath, mono: true },
                  {
                    label: 'Capability',
                    value: <StatusChip tone={capStatus.tone}>{capStatus.word}</StatusChip>,
                  },
                  { label: 'Flag', value: cfg.enableFlag, mono: true },
                ]}
              />
              <p className="pu-note">
                The route and flag are configuration read from this repo and the flags API. They are
                not a gateway verdict.
              </p>
            </Card>
            {enabled === false ? (
              <Card tone="warn" title="Switched off" data-testid="mcpsc-disabled">
                <p className="pu-status-line"><StatusChip tone="danger">Disabled</StatusChip> Every call is refused.</p>
                <p className="pu-note">
                  This capability is switched off, so every call to <code>{cfg.gatewayPath}</code> is
                  denied with HTTP 403 regardless of the policy below.
                </p>
              </Card>
            ) : null}
          </CardGrid>
        </Section>

        <Section id="mcpsc-policy" kicker="2 · The policy" title={cfg.policyTitle}>
          {cfg.policyKind === 'scope' ? (
            <CardGrid>
              <Card tone="live" title="Allowed state" data-testid="mcpsc-scope">
                <p className="pu-status-line"><StatusChip tone="info">Live setting</StatusChip> Saved to the gateway flag when you change it.</p>
                <WeatherStateControl />
              </Card>
              <Card tone="live" title="Blocked cities" data-testid="mcpsc-blocklist">
                <p className="pu-status-line"><StatusChip tone="info">Live setting</StatusChip> Saved on the server when you add or remove a city.</p>
                <p className="pu-note">
                  Used by the <code>Any except blocked cities</code> mode. Each city is geocoded once when
                  you add it, so the gateway denies it whether the agent sends the name or the coordinates
                  it resolved.
                </p>
                <WeatherBlocklistControl />
              </Card>
            </CardGrid>
          ) : (
            <CardGrid>
              <Card tone="neutral" data-testid="mcpsc-terms">
                <p className="pu-status-line"><StatusChip tone="neutral">Read-only</StatusChip> A fixed copy of the gateway list.</p>
                <ul className="mcpsc__terms">
                  {cfg.blockedTerms.map((t) => (
                    <li key={t}><code>{t}</code></li>
                  ))}
                </ul>
              </Card>
            </CardGrid>
          )}
          <p className="pu-note">{cfg.policyNote}</p>
          {cfg.twoStep ? <p className="pu-note">{cfg.twoStep}</p> : null}
        </Section>

        <Section
          id="mcpsc-run"
          kicker="3 · Run it"
          title="Send a prompt to the agent"
          lede="Each one sends the prompt to the agent on the dashboard and records a token chain you can inspect. Run needs a signed-in session; the dashboard asks you to sign in before it will start."
        >
          <CardGrid>
            {signedIn === false ? (
              <Card tone="warn" title="Sign in to run" data-testid="mcpsc-signin">
                <p className="pu-status-line">
                  <StatusChip tone="warn">Signed out</StatusChip> Run and the free-form ask will not start
                  until you sign in.
                </p>
                <div className="pu-actions">
                  <ActionButton onClick={() => navigateToCustomerOAuthLogin(`/${cfg.slug}-mcp`)}>
                    Sign in
                  </ActionButton>
                </div>
              </Card>
            ) : null}
            {cfg.runs.map((r) => {
              const permit = r.outcome === 'PERMIT';
              return (
                <Card
                  key={r.useCaseId}
                  tone={permit ? 'ok' : 'danger'}
                  title={permit ? 'Scripted run: should pass' : 'Scripted run: should be refused'}
                  data-testid={`mcpsc-run-${r.useCaseId}`}
                >
                  <p className="pu-status-line">
                    <StatusChip tone={permit ? 'ok' : 'danger'}>{permit ? 'Expected: permit' : 'Expected: deny'}</StatusChip>
                    Not a result until you run it.
                  </p>
                  <p className="pu-note"><code className="mcpsc__prompt">{r.label}</code></p>
                  <p className="pu-note">{r.note}</p>
                  <div className="pu-actions">
                    <ActionButton
                      lead={primaryKey === r.useCaseId}
                      onClick={() => run(r.useCaseId)}
                      aria-disabled={running !== null ? 'true' : undefined}
                      aria-label={`${running === r.useCaseId ? 'Starting' : 'Run'} ${r.label}`}
                    >
                      {running === r.useCaseId ? 'Starting…' : 'Run'}
                    </ActionButton>
                  </div>
                </Card>
              );
            })}
            {cfg.freeForm ? (
              <Card tone="neutral" title={cfg.freeForm.heading} data-testid="mcpsc-free-card">
                <p className="pu-note">{cfg.freeForm.hint}</p>
                <form className="mcpsc__free" onSubmit={askFreeForm}>
                  <label className="pu-label" htmlFor="mcpsc-free">
                    {cfg.freeForm.heading}
                  </label>
                  <div className="mcpsc__freerow">
                    <input
                      id="mcpsc-free"
                      type="text"
                      className="mcpsc__input"
                      placeholder={cfg.freeForm.placeholder}
                      value={freeText}
                      onChange={(e) => {
                        setFreeText(e.target.value);
                        setFreeHint('');
                      }}
                      readOnly={running !== null}
                      aria-describedby={freeHint ? 'mcpsc-free-hint' : undefined}
                    />
                    <ActionButton
                      type="submit"
                      lead={primaryKey === 'free'}
                      aria-disabled={running !== null || !freeReady ? 'true' : undefined}
                      aria-describedby={freeHint ? 'mcpsc-free-hint' : undefined}
                    >
                      {running === 'free' ? 'Starting…' : cfg.freeForm.button}
                    </ActionButton>
                  </div>
                  <div className="mcpsc__live" role="status">
                    {freeHint ? <p id="mcpsc-free-hint" className="pu-note">{freeHint}</p> : null}
                  </div>
                </form>
              </Card>
            ) : null}
          </CardGrid>
          {error ? (
            <p className="pu-status-line" role="alert">
              <StatusChip tone="danger">Error</StatusChip> {error}
            </p>
          ) : null}
        </Section>

        <Section
          id="mcpsc-files"
          kicker="4 · Where it is enforced"
          title="Gateway config files"
          lede="Paths to the real gateway route, script and flag files in this repo. They are configuration, not a result."
        >
          <Card tone="neutral">
            <ul className="mcpsc__refs">
              {cfg.codeRefs.map((ref) => (
                <li key={ref}><code>{ref}</code></li>
              ))}
            </ul>
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// The page's one button element: `lead` is the single primary for the current view state.
function ActionButton({ lead, ...rest }) {
  return <button type="button" className={lead ? 'pu-btn pu-btn--primary' : 'pu-btn'} {...rest} />;
}
