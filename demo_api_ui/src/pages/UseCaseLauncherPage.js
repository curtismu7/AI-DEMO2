/**
 * UseCaseLauncherPage — Plan A · Phase A5
 * /use-cases: full catalog grouped by track, big "Run" buttons.
 * chip-type triggers: POST /api/use-cases/demo/run, then navigate to /dashboard with the trigger text in router state.
 * attack-type triggers: POST /api/demo/attack-sim/run when sim is in RUNNABLE_SIMS.
 * A6: runnable attack sims wired to POST /api/demo/attack-sim/run.
 * A5.2 (slim launch drawer on /agent) — NOT included here; deferred.
 * A5.3 — FF-aware run-gating + inline enable toggle.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AttackAnatomyExplainer from '../components/AttackAnatomyExplainer';
import UseCaseExplainModal from '../components/UseCaseExplainModal';
import apiClient from '../services/apiClient';
import { formatAxiosError } from '../utils/formatAxiosError';
import { useVertical } from '../vertical/useVertical';
import useLangchainProvider from '../hooks/useLangchainProvider';
import { useEducationUI } from '../context/EducationUIContext';
import { MODE_PROVIDER } from '../config/agentModes';
import VerticalSwitcher from '../components/VerticalSwitcher';
import './UseCaseLauncherPage.css';
// A8 -- Ping product attribution
import { PingProductChip } from '../components/PingProductChip';
import { productsForUseCase } from '../utils/pingProducts';

const TRACK_ORDER = ['foundations', 'demo', 'attacks', 'hitl', 'controls', 'learn', 'tools'];
const TRACK_LABELS = {
  foundations: 'Happy Paths — core delegation and authorization',
  demo:        'Progressive Trust Demo — Ping MyHotels pattern on banking agents (Acts 1–5)',
  attacks:     'Attacks — malicious attempts blocked by PingOne',
  hitl:        'Human-in-the-Loop — approval, step-up, and consent requirements',
  controls:    'Other Controls — additional policy gates',
  learn:       'Learn — explore the platform hands-on',
  tools:       'Developer Tools — utilities and explorers',
};

// Attack sims wired to POST /api/demo/attack-sim/run (A6.1 + A6.2).
const RUNNABLE_SIMS = [
  'insufficient-scope',
  'wrong-aud',
  'cross-owner-account',
  'replayed-token',
  'rogue-actor',
  'rar-exceeded',
  'tampered-intent-token',
  'impersonation-no-act',
  'rate-limit-burst',
];

/**
 * Normalize catalog sim IDs to the backend's VALID_SIMS.
 * The catalog may use 'wrong-aud-token'; the backend expects 'wrong-aud'.
 */
function normalizeSim(s) {
  if (s === 'wrong-aud-token') return 'wrong-aud';
  return s;
}

// Maps maturity "flag:<id>" → the FLAG_REGISTRY id the PATCH must write.
// ff_ciba in the catalog is a legacy alias; the real key is ciba_enabled.
const FLAG_ID_ALIASES = { ff_ciba: 'ciba_enabled' };

/** Hide Act 1 from demo grid — shown only in the presenter strip. */
const PROGRESSIVE_TRUST_STRIP_IDS = new Set(['UC24']);

/**
 * Progressive trust act strip — references existing catalog UCs (see design spec).
 * Acts 2–5 reuse UC1 / UC8 / UC7 / UC22 (optional) / UC6; only Act 1 is UC24.
 */
const PROGRESSIVE_TRUST_ACT_MAP = [
  {
    actKey: '1',
    actLabel: 'Act 1',
    title: 'Public catalog access',
    sourceId: 'UC24',
    presenterLine: 'Low-friction first — no token exchange for public catalog data.',
  },
  {
    actKey: '2',
    actLabel: 'Act 2',
    title: 'Authenticated access',
    sourceId: 'UC1',
    presenterLine: 'Same progressive pattern as member rates in the Ping blog — authenticate when value is clear, with full act-chain visibility.',
  },
  {
    actKey: '3',
    actLabel: 'Act 3',
    title: 'In-app HITL consent',
    sourceId: 'UC8',
    presenterLine: 'Policy evaluated the amount server-side — the transfer only ran after you approved it in the app.',
  },
  {
    actKey: '4',
    actLabel: 'Act 4',
    title: 'MFA step-up',
    sourceId: 'UC7',
    presenterLine: '$600 crosses the step-up threshold — MFA in session, then PERMIT.',
  },
  {
    actKey: '4b',
    actLabel: 'Act 4b',
    title: 'CIBA out-of-band (Ping blog parity)',
    sourceId: 'UC22',
    optional: true,
    presenterLine: 'Higher risk triggers decoupled approval on a separate device — enable ciba_enabled first.',
  },
  {
    actKey: '5',
    actLabel: 'Act 5',
    title: 'Policy hard deny',
    sourceId: 'UC6',
    presenterLine: 'Policy ceiling — blocked before CIBA even starts.',
  },
];

/** Presenter order for Phase 5 multi-LLM rerun (Helix → llama.cpp → Gemini). */
const PROGRESSIVE_TRUST_LLM_SHOWCASE = [
  {
    modeId: 'helix_google',
    label: 'Helix',
    step: 1,
    blurb: 'Default for talks — Ping-native LLM routing.',
    configHint: 'HELIX_* env or /setup',
    rerunHint: 'Run the full Acts 1–5 script.',
  },
  {
    modeId: 'llamacpp',
    label: 'llama.cpp',
    step: 2,
    blurb: 'Offline — local demo_llm_proxy on :8090.',
    configHint: './run.sh (LLM_BACKEND=llamacpp)',
    rerunHint: 'Rerun Act 2 — Token Chain unchanged.',
  },
  {
    modeId: 'gemini',
    label: 'Google Gemini',
    step: 3,
    blurb: 'Cloud alternative brain.',
    configHint: 'GOOGLE_API_KEY or configStore',
    rerunHint: 'Rerun Act 3 or the full script.',
  },
];

/**
 * Returns the FLAG_REGISTRY id for a flag-gated UC maturity string,
 * or null if maturity is not flag-gated.
 */
function parseFlagId(maturity) {
  if (!maturity?.startsWith('flag:')) return null;
  const raw = maturity.slice(5);
  return FLAG_ID_ALIASES[raw] ?? raw;
}

/**
 * Fetches live feature-flag values from GET /api/admin/feature-flags.
 * Returns { flagMap, flagsLoading, setFlag }.
 */
function useLiveFlags() {
  const [flagMap, setFlagMap] = useState(null); // null = loading
  const [flagsLoading, setFlagsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/admin/feature-flags', { _silent: true })
      .then(({ data }) => {
        if (cancelled) return;
        const map = {};
        for (const f of data.flags || []) {
          map[f.id] = f.value;
        }
        setFlagMap(map);
        setFlagsLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setFlagMap({});   // empty = all flags default-off (safe: gates remain closed)
          setFlagsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const setFlag = useCallback((id, value) => {
    // Optimistic update — apply immediately so toggle feels instant.
    setFlagMap((prev) => ({ ...(prev || {}), [id]: value }));
    apiClient
      .patch('/api/admin/feature-flags', { updates: { [id]: value } })
      .catch(() => {
        // Roll back on failure
        setFlagMap((prev) => ({ ...(prev || {}), [id]: !value }));
      });
  }, []);

  return { flagMap, flagsLoading, setFlag };
}

function maturityLabel(maturity) {
  if (!maturity) return null;
  if (maturity === 'works')                  return { text: 'Works', cls: 'uc-maturity--works' };
  if (maturity === 'needs-build')            return { text: 'Needs build', cls: 'uc-maturity--needs-build' };
  if (maturity === 'needs-console-import')   return { text: 'Needs console import', cls: 'uc-maturity--needs-console' };
  if (maturity.startsWith('flag:'))          return { text: `Flag-gated: ${maturity.slice(5)}`, cls: 'uc-maturity--flag' };
  return { text: maturity, cls: '' };
}

function OWASPBadge({ owasp }) {
  if (!owasp || (!owasp.threats?.length && !owasp.sections?.length)) return null;
  const title = [
    owasp.threats?.length  ? `Threats: ${owasp.threats.join(', ')}`   : '',
    owasp.sections?.length ? `Sections: ${owasp.sections.join(', ')}` : '',
  ].filter(Boolean).join(' — ');
  return (
    <span className="uc-owasp-badge" title={title}>
      OWASP ASI
    </span>
  );
}

function AttackSimResult({ result }) {
  if (!result) return null;
  const { status, errorCode, reason, tokenChainEvents } = result;
  // Attack sims block via a 4xx/5xx; treat anything below 400 as an (unexpected) permit.
  const isDeny = typeof status !== 'number' || status >= 400;
  const verdict = isDeny ? 'DENY' : 'PERMIT';
  return (
    <div className="uc-sim-result">
      <div className="uc-sim-result__verdict">
        <span className={`uc-sim-result__status-chip uc-sim-result__status-chip--${isDeny ? 'deny' : 'permit'}`}>
          {status} {verdict}
        </span>
        {errorCode && (
          <span className="uc-sim-result__error-code">{errorCode}</span>
        )}
      </div>
      {reason && (
        <p className="uc-sim-result__reason">{reason}</p>
      )}
      {Array.isArray(tokenChainEvents) && tokenChainEvents.length > 0 && (
        <ol className="uc-sim-result__events">
          {tokenChainEvents.map((ev, i) => (
            <li
              key={ev.label || ev.step || ev.status || i}
              className={`uc-sim-result__event${['deny', 'fail', 'error', 'denied'].includes((ev.status || '').toLowerCase()) ? ' uc-sim-result__event--deny' : ''}`}
            >
              <span className="uc-sim-result__event-label">{ev.label || ev.step || `Step ${i + 1}`}</span>
              <span className={`uc-sim-result__event-status uc-sim-result__event-status--${(ev.status || '').toLowerCase()}`}>
                {ev.status}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * PromptSection — displays agent prompt with copy button.
 */
function PromptSection({ prompt }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="uc-card__prompt-section">
      <div className="uc-card__prompt-header">
        <span className="uc-card__what-to-say-label">What to say:</span>
        <button
          type="button"
          className={`uc-card__copy-btn${copied ? ' uc-card__copy-btn--copied' : ''}`}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy prompt'}
          aria-label="Copy prompt to clipboard"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <p className="uc-card__what-to-say">{prompt}</p>
    </div>
  );
}

/**
 * Gate notice + Ping2026 toggle for a flag-gated use case.
 */
function FlagGate({ flagId, isOn, loading, onToggle }) {
  const switchClass = `ctl-switch${isOn ? ' is-on' : ''}`;
  const gateClass = `uc-ff-gate${isOn ? ' uc-ff-gate--on' : ' uc-ff-gate--off'}`;

  function handleToggle() {
    if (loading) return;
    onToggle(flagId, !isOn);
  }

  return (
    <div className={gateClass}>
      <span className="uc-ff-gate__text">
        <span className="uc-ff-gate__flag">{flagId}</span>{' '}
        {isOn ? 'is enabled — ready to run.' : 'is OFF — turn on to run.'}
      </span>
      <div
        className={switchClass}
        role="switch"
        tabIndex={0}
        aria-checked={isOn}
        aria-label={`Enable ${flagId}`}
        title={isOn ? `Disable ${flagId}` : `Enable ${flagId}`}
        onClick={handleToggle}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handleToggle(); } }}
      >
        <span className="ctl-switch__knob" />
      </div>
    </div>
  );
}

function UseCaseCard({ uc, onRun, onRunAttack, onExplain, onOpen, attackState, chipRunning, chipRunError, flagMap, flagsLoading, setFlag }) {
  const isChip   = uc.trigger?.type === 'chip';
  const isAttack = uc.trigger?.type === 'attack';
  const isLink   = uc.trigger?.type === 'link';
  const isEdu    = uc.trigger?.type === 'edu';
  const mat = maturityLabel(uc.maturity);

  const simId = uc.trigger?.sim;
  const normalizedSim = simId ? normalizeSim(simId) : null;
  const isRunnable = isAttack && normalizedSim && RUNNABLE_SIMS.includes(normalizedSim);

  const { running, result, error } = attackState || {};

  // Flag-gating: parse flagId from maturity; gate Run if flag is not ON.
  const flagId   = parseFlagId(uc.maturity);
  const flagIsOn = flagId != null
    ? (flagMap != null ? Boolean(flagMap[flagId]) : false)
    : true; // non-flag-gated UCs are always runnable
  const flagGated = flagId != null && !flagIsOn;

  return (
    <div className={`uc-card${uc.advanced ? ' uc-card--advanced' : ''}`}>
      <div className="uc-card__header">
        <span className="uc-card__id">{uc.id}</span>
        <h3 className="uc-card__title">{uc.title}</h3>
        {uc.advanced && <span className="uc-card__advanced-label">Advanced</span>}
        <OWASPBadge owasp={uc.owasp} />
      </div>

      <p className="uc-card__buyer-story">{uc.buyerStory}</p>

      {/* A8 -- Ping product attribution */}
      {(() => {
        const _prods = productsForUseCase(uc);
        return _prods.length > 0 ? (
          <div className="uc-card__products">
            <span className="uc-card__plabel">Ping:</span>
            {_prods.map((p) => <PingProductChip key={p.id} product={p} size="sm" />)}
          </div>
        ) : null;
      })()}

      {uc.trigger?.text && (
        <PromptSection prompt={uc.trigger.text} />
      )}

      {mat && (
        <span className={`uc-maturity ${mat.cls}`}>{mat.text}</span>
      )}

      {flagId != null && (
        <FlagGate
          flagId={flagId}
          isOn={flagIsOn}
          loading={flagsLoading}
          onToggle={setFlag}
        />
      )}

      <div className="uc-card__actions">
        <button
          type="button"
          className="uc-explain-btn"
          onClick={() => onExplain(uc)}
          aria-label={`Explain ${uc.title}`}
        >
          Explain
        </button>
        {isChip && (
          <button
            type="button"
            className={`uc-run-btn${flagGated || chipRunning ? ' uc-run-btn--disabled' : ''}`}
            disabled={flagGated || chipRunning}
            title={flagGated ? `Enable ${flagId} to run this scenario` : undefined}
            onClick={() => onRun(uc)}
          >
            {chipRunning ? 'Launching…' : 'Run'}
          </button>
        )}
        {isAttack && isRunnable && (
          <button
            type="button"
            className="uc-run-btn"
            disabled={running}
            onClick={() => onRunAttack(uc, normalizedSim)}
          >
            {running ? 'Running…' : 'Run'}
          </button>
        )}
        {isAttack && !isRunnable && (
          <button
            type="button"
            className="uc-run-btn uc-run-btn--disabled"
            disabled
            title="Attack simulator — coming in A6.2"
          >
            Run (coming in A6.2)
          </button>
        )}
        {isLink && (
          <button
            type="button"
            className="uc-run-btn"
            onClick={() => onOpen(uc)}
          >
            {uc.trigger.label || 'Open'}
          </button>
        )}
        {isEdu && (
          <button
            type="button"
            className="uc-run-btn"
            onClick={() => onOpen(uc)}
          >
            {uc.trigger.label || 'Open panel'}
          </button>
        )}
        {!isChip && !isAttack && !isLink && !isEdu && (
          <span className="uc-card__no-trigger">No trigger defined</span>
        )}
      </div>

      {isChip && chipRunError && (
        <p className="uc-sim-result__fetch-error">{chipRunError}</p>
      )}

      {isRunnable && error && (
        <p className="uc-sim-result__fetch-error">{error}</p>
      )}
      {isRunnable && result && (
        <AttackSimResult result={result} />
      )}
    </div>
  );
}

/**
 * Resolve progressive trust strip steps from the loaded catalog + act map.
 */
function resolveProgressiveTrustActs(useCases) {
  return PROGRESSIVE_TRUST_ACT_MAP.map((entry) => {
    const uc = useCases.find((u) => u.id === entry.sourceId);
    if (!uc) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`Progressive trust act ${entry.actKey}: missing catalog entry ${entry.sourceId}`);
      }
      return null;
    }
    return {
      ...entry,
      uc,
      chipText: entry.chipDisplay || uc.trigger?.text || '',
    };
  }).filter(Boolean);
}

/**
 * Ordered presenter strip for the progressive trust demo.
 * Run/Explain delegate to source UCs (UC1, UC8, UC7, UC22, UC6, UC24).
 */
function ProgressiveTrustDemoStrip({
  useCases,
  onRun,
  onExplain,
  chipRun,
  flagMap,
  flagsLoading,
  setFlag,
}) {
  const acts = resolveProgressiveTrustActs(useCases);

  if (!acts.length) return null;

  return (
    <div className="pt-demo-strip">
      <p className="pt-demo-strip__banner">
        Progressive Trust Demo — Act 1 from here; Acts 2–5 on the dashboard with Token Chain open.
        Act 4 is MFA step-up (UC7); Act 4b is optional CIBA (UC22) when ciba_enabled is on.
      </p>
      <ol className="pt-demo-strip__list">
        {acts.map((act) => {
          const { uc } = act;
          const flagId = parseFlagId(uc.maturity);
          const flagIsOn = flagId != null
            ? (flagMap != null ? Boolean(flagMap[flagId]) : false)
            : true;
          const flagGated = flagId != null && !flagIsOn;
          const chipRunning = chipRun?.id === uc.id && chipRun.state === 'running';
          const chipRunError = chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null;
          const mat = maturityLabel(uc.maturity);

          return (
            <li
              key={act.actKey}
              className={`pt-demo-strip__step${act.optional ? ' pt-demo-strip__step--optional' : ''}`}
            >
              <div className="pt-demo-strip__step-head">
                <span className="pt-demo-strip__act">{act.actLabel}</span>
                <h3 className="pt-demo-strip__title">{act.title}</h3>
                {mat && <span className={`uc-maturity ${mat.cls}`}>{mat.text}</span>}
                {act.sourceId !== 'UC24' && (
                  <span className="pt-demo-strip__source" title="Catalog source use case">
                    {act.sourceId}
                  </span>
                )}
              </div>
              {act.chipText && (
                <p className="pt-demo-strip__prompt">
                  <span className="pt-demo-strip__prompt-label">Chip:</span>
                  <code>{act.chipText}</code>
                </p>
              )}
              <p className="pt-demo-strip__say">{act.presenterLine}</p>
              {flagId != null && (
                <FlagGate
                  flagId={flagId}
                  isOn={flagIsOn}
                  loading={flagsLoading}
                  onToggle={setFlag}
                />
              )}
              <div className="pt-demo-strip__actions">
                <button
                  type="button"
                  className="uc-explain-btn"
                  onClick={() => onExplain(uc)}
                  aria-label={`Explain ${act.title}`}
                >
                  Explain
                </button>
                <button
                  type="button"
                  className={`uc-run-btn${flagGated || chipRunning ? ' uc-run-btn--disabled' : ''}`}
                  disabled={flagGated || chipRunning}
                  title={flagGated ? `Enable ${flagId} to run this act` : undefined}
                  onClick={() => onRun(uc)}
                >
                  {chipRunning ? 'Launching…' : 'Run act'}
                </button>
              </div>
              {chipRunError && (
                <p className="uc-sim-result__fetch-error">{chipRunError}</p>
              )}
            </li>
          );
        })}
      </ol>
      <ProgressiveTrustLlmShowcase />
    </div>
  );
}

/**
 * Phase 5 — switch agent brain between Helix, llama.cpp, and Gemini, then rerun acts.
 */
function ProgressiveTrustLlmShowcase() {
  const { mode, setMode, saving, keySet, loading } = useLangchainProvider();
  const [llamaCppOk, setLlamaCppOk] = useState(null);

  useEffect(() => {
    let alive = true;
    const probe = () => {
      fetch('/api/langchain/provider/llamacpp/status', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setLlamaCppOk(d ? d.status === 'available' : false); })
        .catch(() => { if (alive) setLlamaCppOk(false); });
    };
    probe();
    const onFocus = () => probe();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.removeEventListener('focus', onFocus); };
  }, []);

  const modeAvailable = useCallback((modeId) => {
    const provider = MODE_PROVIDER[modeId];
    if (!provider) return true;
    if (provider === 'llamacpp') return llamaCppOk !== false;
    return keySet?.[provider] === true;
  }, [keySet, llamaCppOk]);

  return (
    <div className="pt-llm-showcase">
      <h3 className="pt-llm-showcase__heading">Multi-LLM showcase</h3>
      <p className="pt-llm-showcase__lead">
        Swap the agent brain — PingOne Authorize, D-05 anti-bypass, and token exchange do not move.
        Rerun Acts 2–5 after each switch to prove provider-agnostic security.
      </p>
      <ol className="pt-llm-showcase__modes">
        {PROGRESSIVE_TRUST_LLM_SHOWCASE.map((entry) => {
          const available = !loading && modeAvailable(entry.modeId);
          const active = mode === entry.modeId;
          return (
            <li
              key={entry.modeId}
              className={`pt-llm-showcase__mode${active ? ' pt-llm-showcase__mode--active' : ''}`}
            >
              <div className="pt-llm-showcase__mode-head">
                <span className="pt-llm-showcase__step">Step {entry.step}</span>
                <strong className="pt-llm-showcase__label">{entry.label}</strong>
                {active && <span className="pt-llm-showcase__active">Active</span>}
              </div>
              <p className="pt-llm-showcase__blurb">{entry.blurb}</p>
              <p className="pt-llm-showcase__config">
                <span className="pt-llm-showcase__config-label">Config:</span>
                <code>{entry.configHint}</code>
              </p>
              <p className="pt-llm-showcase__rerun">{entry.rerunHint}</p>
              <button
                type="button"
                className={`uc-run-btn${!available || active ? ' uc-run-btn--disabled' : ''}`}
                disabled={!available || saving || active}
                title={!available ? `${entry.label} is not configured` : undefined}
                onClick={() => setMode(entry.modeId)}
              >
                {active ? 'Active brain' : saving ? 'Saving…' : 'Use this brain'}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function UseCaseLauncherPage() {
  const navigate    = useNavigate();
  const { activeId: verticalId } = useVertical();
  const { open: openEdu } = useEducationUI();

  const [useCases, setUseCases] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  // A9: track which UC has its explain modal open
  const [explainUc, setExplainUc] = useState(null);

  // attackStates: { [uc.id]: { running: bool, result: object|null, error: string|null } }
  const [attackStates, setAttackStates] = useState({});

  // A7.1: track the last attack sim result + its catalog entry for AttackAnatomyExplainer
  const [lastSimResult,  setLastSimResult]  = useState(null);
  const [lastSimUcEntry, setLastSimUcEntry] = useState(null);

  // Lifecycle of the chip "Run" the user last clicked, for one card at a time:
  // { id, state: 'running' | 'error', msg? }. Guards double-clicks and surfaces errors.
  const [chipRun, setChipRun] = useState(null);

  const { flagMap, flagsLoading, setFlag } = useLiveFlags();

  const vertical = verticalId || 'banking';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Clear the prior vertical's transient run state — attackStates is keyed by
    // uc.id, and those ids are shared across verticals, so results would otherwise
    // leak onto the same-id card under the new vertical.
    setAttackStates({});
    setLastSimResult(null);
    setLastSimUcEntry(null);
    setChipRun(null);
    apiClient.get('/api/use-cases', { params: { vertical }, _silent: true })
      .then(({ data }) => {
        if (!cancelled) {
          setUseCases(data.useCases || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load use cases');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [vertical]);

  const handleRun = useCallback((uc) => {
    if (uc.trigger?.type !== 'chip') return;
    // The backend resolves by the useCaseId slug only — uc.id (e.g. "UC1") is not accepted.
    const useCaseId = uc.useCaseId;
    if (!useCaseId) {
      console.error('Use case missing useCaseId:', uc);
      setChipRun({ id: uc.id, state: 'error', msg: 'This use case is misconfigured (no id).' });
      return;
    }
    setChipRun({ id: uc.id, state: 'running' });
    apiClient.post('/api/use-cases/demo/run', { useCaseId, vertical })
      .then(({ data }) => {
        // Switch to the target vertical so the dashboard loads with the correct context.
        // If already on this vertical, this is a no-op.
        return apiClient.post('/api/verticals/active', { id: vertical })
          .then(() => data);
      })
      .then((data) => {
        // Navigation unmounts this page, so chipRun need not be cleared here.
        navigate('/dashboard', {
          state: {
            useCaseId: data.useCaseId,
            triggerText: data.triggerText,
            type: data.type,
            vertical,
          }
        });
      })
      .catch((err) => {
        console.error('Failed to run use case:', err);
        setChipRun({ id: uc.id, state: 'error', msg: formatAxiosError(err, 'Failed to launch scenario') });
      });
  }, [navigate, vertical]);

  // Link-type use cases navigate to their page; edu-type opens a learning panel.
  const handleOpen = useCallback((uc) => {
    if (uc.trigger?.type === 'edu') {
      openEdu(uc.trigger.panel, uc.trigger.tab || 'overview');
      return;
    }
    if (uc.trigger?.path) navigate(uc.trigger.path);
  }, [navigate, openEdu]);

  const handleRunAttack = useCallback((uc, sim) => {
    // Clear anatomy explainer while a new run is in flight
    setLastSimResult(null);
    setLastSimUcEntry(null);
    setAttackStates((prev) => ({
      ...prev,
      [uc.id]: { running: true, result: null, error: null },
    }));
    apiClient.post('/api/demo/attack-sim/run', { sim })
      .then(({ data }) => {
        setAttackStates((prev) => ({
          ...prev,
          [uc.id]: { running: false, result: data, error: null },
        }));
        // A7.1: populate anatomy explainer
        setLastSimResult(data);
        setLastSimUcEntry(uc);
      })
      .catch((err) => {
        const msg = formatAxiosError(err, 'Attack simulation failed');
        setAttackStates((prev) => ({
          ...prev,
          [uc.id]: { running: false, result: null, error: msg },
        }));
      });
  }, []);

  // Group use cases by track, in TRACK_ORDER order.
  const grouped = TRACK_ORDER.map((track) => ({
    track,
    items: useCases.filter((uc) => uc.track === track),
  }));

  if (loading) {
    return (
      <div className="uc-launcher">
        <div className="uc-launcher__loading">Loading use cases...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="uc-launcher">
        <div className="uc-launcher__error">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="uc-launcher">
      <header className="uc-launcher__header">
        <h1 className="uc-launcher__title">AI Agent Security Use Cases</h1>
        <p className="uc-launcher__subtitle">
          {useCases.length} security use cases grouped by demo track. Click Run to launch a scenario in the agent.
        </p>
        <div className="uc-launcher__vertical-picker" data-testid="uc-vertical-picker">
          <span className="uc-launcher__vertical-label">Vertical</span>
          <VerticalSwitcher variant="pills" />
        </div>
      </header>

      {grouped.map(({ track, items }) => {
        if (items.length === 0) return null;
        const displayItems = track === 'demo'
          ? items.filter((uc) => !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id))
          : items;
        return (
          <section key={track} className="uc-track">
            <h2 className="uc-track__heading">{TRACK_LABELS[track]}</h2>
            {track === 'demo' && (
              <ProgressiveTrustDemoStrip
                useCases={items}
                onRun={handleRun}
                onExplain={setExplainUc}
                chipRun={chipRun}
                flagMap={flagMap}
                flagsLoading={flagsLoading}
                setFlag={setFlag}
              />
            )}
            <div className="uc-track__grid">
              {displayItems.map((uc) => (
                <UseCaseCard
                  key={uc.id}
                  uc={uc}
                  onRun={handleRun}
                  onRunAttack={handleRunAttack}
                  onExplain={setExplainUc}
                  onOpen={handleOpen}
                  attackState={attackStates[uc.id]}
                  chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                  chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                  flagMap={flagMap}
                  flagsLoading={flagsLoading}
                  setFlag={setFlag}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* A7.1 — attack anatomy explainer, shown after any attack sim run */}
      <AttackAnatomyExplainer ucEntry={lastSimUcEntry} simResult={lastSimResult} />

      {/* A9 — per-card explain modal */}
      <UseCaseExplainModal
        uc={explainUc}
        open={explainUc !== null}
        onClose={() => setExplainUc(null)}
      />
    </div>
  );
}
