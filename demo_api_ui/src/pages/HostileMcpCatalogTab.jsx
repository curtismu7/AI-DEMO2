// demo_api_ui/src/pages/HostileMcpCatalogTab.jsx
//
// The "Malicious MCP — Catalog" tab on /llm-gateway. Teaching companion to
// the Malicious MCP tab (HostileMcpTab), which FIRES the hostile server
// through the gateway. This tab is the map: every tool the hostile server
// serves, what each attack is, the poison text, and — the point of the page —
// the honest defense table: which layer (agent instruction / ingest scanner /
// gateway AIGuard) catches it, and where nothing does.
//
// The runner section fires each row's own surface through the SAME BFF relay
// the hostile tab drives (/api/privilege-mcp): door flip + Privilege sign-in
// are shared session state, and every verdict shown is the gateway's observed
// answer — an ALLOWED poisoned call is the honest gap, not a pass.
//
// Data: mirrored in config/hostileMcpCatalog.js with a parity test against
// standalone/hostile-mcp-server (the HostileA2aTab pattern). Test plan and
// outcome classification live in hostileMcpCatalogTests.js (pure logic).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATALOG_KINDS, HOSTILE_MCP_CATALOG } from '../config/hostileMcpCatalog';
import { scan } from '../utils/mcpScanner';
import { buildCatalogTestPlan, classifyCatalogOutcome, RUN_STATUSES } from './hostileMcpCatalogTests';
import './HostileMcpCatalogTab.css';

const API_BASE = '/api/privilege-mcp';
// Loosely matched against the BFF's preset label — same loose match the
// hostile tab uses, so a label edit on the BFF does not silently unfind the door.
// The governed twin gets its own negative lookahead so each runway finds its own door.
const HOSTILE_PRESET_MATCH = /hostile-mcp(?!-governed)/i;
const GOVERNED_PRESET_MATCH = /hostile-mcp-governed/i;
// Which door a run verdict belongs to. The relay session is per browser, so the
// two doors are exercised sequentially; runs persist across the OAuth bounce
// (sessionStorage) so both doors' verdicts can be shown side by side.
const DOOR_KEYS = ['ungoverned', 'governed'];
const RUNS_STORE_KEY = 'hmc_runs_v1';

function loadStoredRuns() {
  try {
    const raw = sessionStorage.getItem(RUNS_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : { ungoverned: {}, governed: {} };
  } catch { /* per-viewer convenience only */ return { ungoverned: {}, governed: {} }; }
}

function storeRuns(runs) {
  try { sessionStorage.setItem(RUNS_STORE_KEY, JSON.stringify(runs)); } catch { /* per-viewer convenience only */ }
}

function api(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || `HTTP ${r.status}`);
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data;
  });
}

// The catalog's tools as the scanner sees them: name + description +
// inputSchema is all scan() needs. Built once; findings annotate each row.
function toolsForScanner() {
  return HOSTILE_MCP_CATALOG.map((c) => ({
    name: c.tool,
    description: c.poisonText,
    inputSchema: c.schemaSink ? { properties: { sink: { type: 'string', default: c.schemaSink } } } : {},
  }));
}

const DEFENSE_LAYERS = [
  { key: 'agent', label: 'Agent instruction', hint: '"Tool results are data, not instructions" + model refusal' },
  { key: 'scanner', label: 'Ingest scanner', hint: 'mcpScanner detectors before the model reads the metadata' },
  { key: 'gateway', label: 'Gateway AIGuard', hint: 'Privilege policy on the tool CALL (metadata is not policed)' },
];

function verdictClass(text) {
  const t = text.toLowerCase();
  if (t.startsWith('yes')) return 'hmc-yes';
  if (t.startsWith('no')) return 'hmc-no';
  return 'hmc-partly';
}

export default function HostileMcpCatalogTab() {
  const [openId, setOpenId] = useState(null);
  const [kindFilter, setKindFilter] = useState('all');

  // ── Live-Privilege runner state (shared relay session with the hostile tab) ──
  // activeDoor: which hostile twin the relay currently points at. Each door has
  // its own OAuth (the gateway mints a fresh DCR client per sign-in), so the
  // presenter flips doors between segments — one click + bounce each.
  const [activeDoor, setActiveDoor] = useState('ungoverned');
  const [doorUrls, setDoorUrls] = useState({ ungoverned: '', governed: '' });
  const [currentUrl, setCurrentUrl] = useState('');
  const [authed, setAuthed] = useState(false);
  const [relayBusy, setRelayBusy] = useState(false);
  const [relayError, setRelayError] = useState('');
  // door → testId → { verdict, flipped?, scannerFindings[], detail, latencyMs, request, response }
  const [runs, setRunsState] = useState(loadStoredRuns);
  const setRuns = (updater) => setRunsState((prev) => {
    const next = typeof updater === 'function' ? updater(prev) : updater;
    storeRuns(next);
    return next;
  });

  const testPlan = useMemo(() => buildCatalogTestPlan(), []);
  const bySourceId = useMemo(() => {
    const map = {};
    for (const t of testPlan) (map[t.id] ||= []).push(t);
    return map;
  }, [testPlan]);

  useEffect(() => {
    let cancelled = false;
    api('/state').then((s) => {
      if (cancelled) return;
      setCurrentUrl(s.config?.mcpUrl || '');
      // /state exposes the relay's OAuth block at TOP level (s.oauth), not
      // under s.config — session.config carries no oauth key at all.
      setAuthed(Boolean(s.oauth?.authenticated));
      const presets = s.presets || [];
      const ungoverned = presets.find((p) => HOSTILE_PRESET_MATCH.test(p.label || ''));
      const governed = presets.find((p) => GOVERNED_PRESET_MATCH.test(p.label || ''));
      setDoorUrls({ ungoverned: ungoverned?.url || '', governed: governed?.url || '' });
      if ((currentUrl || '').includes('-governed')) setActiveDoor('governed');
    }).catch(() => { /* runner stays gated; strip shows what to do */ });
    return () => { cancelled = true; };
  }, []);

  // Returning from the Privilege OAuth bounce (?auth=success on this path):
  // refresh auth state. The tab itself is restored by LlmGatewayCombinedPage's
  // last-tab memory — the BFF's returnTo sanitization keeps only the bare
  // path, so the bounce cannot carry ?tab=catalog back in the URL.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).get('auth')) return undefined;
    let cancelled = false;
    api('/state').then((s) => {
      if (cancelled) return;
      setCurrentUrl(s.config?.mcpUrl || '');
      setAuthed(Boolean(s.oauth?.authenticated));
      const presets = s.presets || [];
      const ungoverned = presets.find((p) => HOSTILE_PRESET_MATCH.test(p.label || ''));
      const governed = presets.find((p) => GOVERNED_PRESET_MATCH.test(p.label || ''));
      setDoorUrls({ ungoverned: ungoverned?.url || '', governed: governed?.url || '' });
      if ((s.config?.mcpUrl || '').includes('-governed')) setActiveDoor('governed');
    }).catch(() => { /* strip keeps showing what to do */ });
    return () => { cancelled = true; };
  }, []);

  const onHostileDoor = activeDoor === 'ungoverned'
    ? (currentUrl || '').includes('hostile-mcp') && !(currentUrl || '').includes('-governed')
    : (currentUrl || '').includes('-governed');
  const runwayReady = onHostileDoor && authed;

  // One click for the demo: flipping the door also starts the Privilege sign-in —
  // the OAuth bounce returns to this tab and the runway unlocks on landing.
  // (signIn() navigates away, so relayBusy's finally never runs; that is fine.)
  const pointAtDoor = async (door = activeDoor) => {
    setRelayBusy(true);
    setRelayError('');
    try {
      const saved = await api('/config', { method: 'POST', body: { mcpUrl: doorUrls[door], gatewayMode: 'privilege' } });
      setCurrentUrl(saved?.config?.mcpUrl || doorUrls[door]);
      setActiveDoor(door);
      // /config also exposes the OAuth block at top level, not under config.
      setAuthed(Boolean(saved?.oauth?.authenticated || saved?.oauth?.destinationAuthenticated));
    } catch (err) {
      setRelayError(err.message);
      setRelayBusy(false);
      return;
    }
    await signIn();
  };

  const signIn = async () => {
    setRelayBusy(true);
    setRelayError('');
    try {
      // returnTo brings the OAuth bounce back to THIS tab (query included —
      // the BFF sanitizes only the base path, /auth/callback re-appends ?auth=).
      const data = await api('/auth/start', { method: 'POST', body: { returnTo: '/llm-gateway' } });
      if (data?.authUrl) { window.location.href = data.authUrl; return; }
      setAuthed(true);
    } catch (err) {
      setRelayError(err.message);
    } finally {
      setRelayBusy(false);
    }
  };

  const runTest = async (test) => {
    setRelayBusy(true);
    setRelayError('');
    try {
      const path = test.method === 'tools/list' ? '/tools/list' : test.method === 'tools/call' ? '/tools/call' : '/request';
      const body = test.method === 'tools/list' ? test.params
        : test.method === 'tools/call' ? test.params
          : { method: test.method, params: test.params };
      const t0 = performance.now();
      let outcome;
      try {
        const data = await api(path, { method: 'POST', body });
        // rug_pull diffs two lists: the first is whatever the relay just
        // returned; the second forces the flip by listing again.
        if (test.id === 'rug_pull') {
          const second = await api('/tools/list', { method: 'POST', body: {} });
          outcome = classifyCatalogOutcome({
            kind: 'rug_pull',
            ok: true,
            status: 200,
            body: {
              first: (data.tools || []).filter((t) => t.name === 'get_stock_price'),
              second: (second.tools || []).filter((t) => t.name === 'get_stock_price'),
            },
          });
        } else {
          outcome = classifyCatalogOutcome({ kind: test.id, ok: true, status: 200, body: data });
        }
      } catch (err) {
        outcome = classifyCatalogOutcome({ kind: test.id, ok: false, status: err.status ?? 0, body: err.body || { error: err.message } });
      }
      const latencyMs = Math.round(performance.now() - t0);
      // An expected deny that was allowed is its own badge, not a soft "allowed".
      if (test.expectation.verdict === 'denied' && outcome.verdict === 'allowed') {
        outcome = { ...outcome, verdict: 'expected-deny-missed' };
      }
      setRuns((prev) => ({
        ...prev,
        [activeDoor]: {
          ...prev[activeDoor],
          [test.id]: {
            ...outcome,
            latencyMs,
            request: JSON.stringify({ method: 'POST', path: `${API_BASE}${path}`, ...(test.method === 'tools/call' || test.method === 'tools/list' ? { body } : { body }) }, null, 2),
            response: outcome.firstDesc !== undefined
              ? JSON.stringify({ first: outcome.firstDesc, second: outcome.secondDesc, flipped: outcome.flipped }, null, 2)
              : null,
          },
        },
      }));
    } finally {
      setRelayBusy(false);
    }
  };

  const runAll = async () => {
    for (const test of testPlan) {
      // Skip induced rows whose source row errored on auth — they will 401 too.
      // eslint-disable-next-line no-await-in-loop
      await runTest(test);
    }
  };

  const scannerFindings = useMemo(() => {
    const byTool = {};
    for (const f of scan(toolsForScanner())) {
      (byTool[f.tool] ||= []).push(`${f.kind}: ${f.detail}`);
    }
    return byTool;
  }, []);

  const rows = useMemo(
    () => (kindFilter === 'all' ? HOSTILE_MCP_CATALOG : HOSTILE_MCP_CATALOG.filter((c) => c.kind === kindFilter)),
    [kindFilter],
  );

  const currentRuns = runs[activeDoor] || {};
  const otherDoor = activeDoor === 'ungoverned' ? 'governed' : 'ungoverned';
  const totalRun = Object.keys(currentRuns).length;
  const denied = Object.values(currentRuns).filter((r) => r.verdict === 'denied').length;
  const otherRun = runs[otherDoor] || {};
  const bothDoorsRun = Object.keys(currentRuns).length > 0 && Object.keys(otherRun).length > 0;

  return (
    <div className="hmc">
      <header className="hmc-head">
        <h2>Malicious MCP — Catalog</h2>
        <p className="hmc-lede">
          Every tool <code>standalone/hostile-mcp-server</code> serves, what each attack is, and which
          defense layer catches it. The poison is in tool <strong>metadata</strong> — the MCP protocol
          inspects none of it, so a defense can only sit where the tool list or the tool call is
          consumed. This page says where nothing does.
        </p>
        <p className="hmc-see-live">
          Want to fire it for real? The{' '}
          <Link to="/llm-gateway?tab=hostile">Malicious MCP tab</Link> runs this server through the
          gateway and shows Privilege deny the induced transfer.
        </p>
      </header>

      <section className="hmc-runner" aria-label="Live Privilege tests">
        <div className="hmc-runner-head">
          <div>
            <h3>Live Privilege tests</h3>
            <p className="hmc-runner-lede">
              Each row&apos;s Run button fires that attack&apos;s own surface through the same
              Privilege relay the Malicious MCP tab uses — the observed gateway verdict lands on
              the row. Allowed poisoned calls are shown as <strong>ALLOWED</strong>: that is the
              gap the defense table names, measured live. Run the same rows against the
              governed twin (<code>hostile-mcp-governed</code>, deny policy on transfers) to show
              the same poisoned call allowed here and denied there — side by side.
            </p>
            <div className="hmc-door-toggle" role="group" aria-label="Which hostile door">
              {DOOR_KEYS.map((door) => (
                <button
                  key={door}
                  type="button"
                  className={activeDoor === door ? 'hmc-chip hmc-on' : 'hmc-chip'}
                  onClick={() => setActiveDoor(door)}
                >
                  {door === 'ungoverned' ? 'Ungoverned (hostile-mcp)' : 'Governed (hostile-mcp-governed)'}
                </button>
              ))}
            </div>
          </div>
          <div className="hmc-runner-runall">
            <button
              type="button"
              className="hmc-btn hmc-btn--danger"
              disabled={relayBusy || !runwayReady}
              onClick={runAll}
              title={runwayReady ? 'Run every test in sequence' : 'One click: points the relay at the hostile door and starts the Privilege sign-in'}
            >
              {relayBusy ? 'Running…' : `Run all ${testPlan.length}`}
            </button>
            {totalRun > 0 && (
              <span className="hmc-runner-tally">
                {denied} denied · {totalRun} run{bothDoorsRun ? ' · both doors' : ''}
              </span>
            )}
          </div>
        </div>

        {!runwayReady && (
          <div className="hmc-runway">
            <span className={onHostileDoor ? 'hmc-pill hmc-pill--ok' : 'hmc-pill'}>
              {onHostileDoor ? `✓ ${activeDoor} door` : `Door: not on the ${activeDoor} relay`}
            </span>
            <span className={authed ? 'hmc-pill hmc-pill--ok' : 'hmc-pill'}>
              {authed ? '✓ Signed in with Privilege' : 'Not signed in with Privilege'}
            </span>
            {!runwayReady && (
              <button
                type="button"
                className="hmc-btn"
                disabled={relayBusy || !doorUrls[activeDoor]}
                onClick={() => pointAtDoor(activeDoor)}
              >
                {onHostileDoor ? 'Sign in with Privilege' : `Point at ${activeDoor} door & sign in`}
              </button>
            )}
            <span className="hmc-runway-note">
              Same relay session as the <Link to="/llm-gateway?tab=hostile">Malicious MCP tab</Link>.
              {otherRun && Object.keys(otherRun).length > 0 && (
                <>
                  {' '}The <strong>{otherDoor}</strong> door&apos;s verdicts are kept — flip back to compare side by side.
                </>
              )}
            </span>
          </div>
        )}
        {relayError && <p className="hmc-error" role="alert">{relayError}</p>}
      </section>

      <div className="hmc-filters" role="group" aria-label="Filter by attack kind">
        <button
          type="button"
          className={kindFilter === 'all' ? 'hmc-chip hmc-on' : 'hmc-chip'}
          onClick={() => setKindFilter('all')}
        >
          All ({HOSTILE_MCP_CATALOG.length})
        </button>
        {CATALOG_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            className={kindFilter === k.key ? 'hmc-chip hmc-on' : 'hmc-chip'}
            onClick={() => setKindFilter(k.key)}
          >
            {k.label.split('—')[0].trim()} ({HOSTILE_MCP_CATALOG.filter((c) => c.kind === k.key).length})
          </button>
        ))}
      </div>

      <section className="hmc-list">
        {rows.map((c) => {
          const findings = scannerFindings[c.tool] || [];
          const open = openId === c.id;
          return (
            <article key={c.id} className="hmc-card">
              <button
                type="button"
                className="hmc-card-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : c.id)}
              >
                <span className="hmc-tool">{c.tool}</span>
                <span className="hmc-attack">{c.attack}</span>
                {/* Side-by-side: ungoverned verdict, then governed, when both doors have been run. */}
                {runs.ungoverned?.[c.id] && (
                  <span
                    className={`hmc-verdict hmc-verdict-${runs.ungoverned[c.id].verdict}`}
                    title="Ungoverned door (hostile-mcp)"
                  >
                    U:{RUN_STATUSES[runs.ungoverned[c.id].verdict] || runs.ungoverned[c.id].verdict}
                  </span>
                )}
                {runs.governed?.[c.id] && (
                  <span
                    className={`hmc-verdict hmc-verdict-${runs.governed[c.id].verdict}`}
                    title="Governed door (hostile-mcp-governed)"
                  >
                    G:{RUN_STATUSES[runs.governed[c.id].verdict] || runs.governed[c.id].verdict}
                  </span>
                )}
                <span className={`hmc-kind hmc-kind-${c.kind}`}>{c.kind}</span>
              </button>
              {open && (
                <div className="hmc-card-body">
                  <p className="hmc-summary">{c.summary}</p>
                  <div className="hmc-poison">
                    <div className="hmc-poison-label">The poison (as served in tools/list / content)</div>
                    <pre className="hmc-poison-text">{c.poisonText}</pre>
                    {c.schemaSink && <pre className="hmc-poison-text hmc-sink">{c.schemaSink}</pre>}
                  </div>

                  {(bySourceId[c.id] || []).map((test) => {
                    const run = currentRuns[test.id];
                    const otherRunVerdict = otherRun[test.id];
                    return (
                      <div key={test.id} className="hmc-livetest">
                        <div className="hmc-livetest-row">
                          <button
                            type="button"
                            className="hmc-btn hmc-btn--run"
                            disabled={relayBusy || !runwayReady}
                            onClick={() => runTest(test)}
                            title={runwayReady ? `Fire this through the ${activeDoor} door` : 'One click: points the relay at the hostile door and starts the Privilege sign-in'}
                          >
                            {run && relayBusy ? 'Running…' : 'Run'}
                          </button>
                          <span className="hmc-livetest-label">{test.label}</span>
                          {otherRunVerdict && (
                            <span
                              className={`hmc-verdict hmc-verdict-${otherRunVerdict.verdict}`}
                              title={`${otherDoor} door`}
                            >
                              {otherDoor === 'governed' ? 'G:' : 'U:'}{RUN_STATUSES[otherRunVerdict.verdict] || otherRunVerdict.verdict}
                            </span>
                          )}
                          {run && (
                            <span className={`hmc-verdict hmc-verdict-${run.verdict}`}>
                              {RUN_STATUSES[run.verdict] || run.verdict}{run.latencyMs != null ? ` · ${run.latencyMs} ms` : ''}
                            </span>
                          )}
                        </div>
                        {run && (
                          <div className="hmc-livetest-result">
                            <p className="hmc-livetest-why">
                              {test.expectation.why}
                            </p>
                            {run.detail && <pre className="hmc-poison-text hmc-observed">{run.detail}</pre>}
                            {run.scannerFindings.length > 0 && (
                              <div className="hmc-findings">
                                <div className="hmc-findings-label">Scanner on the returned content</div>
                                <ul>
                                  {run.scannerFindings.map((f, i) => <li key={i}>{f}</li>)}
                                </ul>
                              </div>
                            )}
                            <details className="hmc-evidence">
                              <summary>Request / response</summary>
                              <pre className="hmc-poison-text">{run.request}</pre>
                              {run.response && <pre className="hmc-poison-text">{run.response}</pre>}
                            </details>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {findings.length > 0 && (
                    <div className="hmc-findings">
                      <div className="hmc-findings-label">Scanner verdict (what mcpScanner flags at ingest)</div>
                      <ul>
                        {findings.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {findings.length === 0 && (
                    <div className="hmc-findings hmc-findings-empty">
                      Scanner verdict: clean — nothing at ingest time flags this one.
                    </div>
                  )}
                  {c.measured && (
                    <div className="hmc-measured">
                      <strong>Measured:</strong> {c.measured}
                    </div>
                  )}
                  <table className="hmc-defense">
                    <caption className="hmc-visually-hidden">Defense layers for {c.tool}</caption>
                    <thead>
                      <tr>
                        {DEFENSE_LAYERS.map((l) => (
                          <th key={l.key} scope="col" title={l.hint}>
                            {l.label}
                          </th>
                        ))}
                        <th scope="col">Honest gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {DEFENSE_LAYERS.map((l) => (
                          <td key={l.key} className={verdictClass(c.defenses[l.key])}>
                            {c.defenses[l.key]}
                          </td>
                        ))}
                        <td className="hmc-gap">{c.defenses.gap}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <footer className="hmc-foot">
        <h3>The table in one line</h3>
        <p>
          Metadata attacks need a scanner at ingest; call attacks need the gateway; result-based
          attacks need either the agent&apos;s data-not-instructions discipline or gateway content
          inspection. The rug-pull defeats ingest-once scanning by design — re-listing must be
          re-scanned. Nothing here claims the gateway sanitizes metadata; it does policy on calls.
        </p>
      </footer>
    </div>
  );
}
