/**
 * UseCaseLauncherPage — Plan A · Phase A5
 * /use-cases: full catalog grouped by track, big "Run" buttons.
 * chip-type triggers: POST /api/use-cases/demo/run, then navigate to /dashboard with the trigger text in router state.
 * attack-type triggers: POST /api/demo/attack-sim/run when sim is in RUNNABLE_SIMS.
 * A6: runnable attack sims wired to POST /api/demo/attack-sim/run.
 * A5.2 (slim launch drawer on /agent) — NOT included here; deferred.
 * A5.3 — FlagGate banner + guest-safe Enable button per card when a required
 * flag is off; Run auto-enables required flags for signed-in launches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AttackAnatomyExplainer from '../components/AttackAnatomyExplainer';
import FlagGate from '../components/FlagGate';
import GroupMembershipToggle from '../components/GroupMembershipToggle';
import OWASPBadge from '../components/OWASPBadge';
import UseCaseExplainModal from '../components/UseCaseExplainModal';
import apiClient from '../services/apiClient';
import { formatAxiosError } from '../utils/formatAxiosError';
import { useVertical } from '../vertical/useVertical';
import useLangchainProvider from '../hooks/useLangchainProvider';
import useLiveFlags from '../hooks/useLiveFlags';
import { useEducationUI } from '../context/EducationUIContext';
import { useThemeOptional } from '../context/ThemeContext';
import { MODE_PROVIDER } from '../config/agentModes';
import VerticalSwitcher from '../components/VerticalSwitcher';
import './UseCaseLauncherPage.css';
import { opportunisticPrewarm } from '../components/demoAgentSafety';
// A8 -- Ping product attribution
import { PingProductChip } from '../components/PingProductChip';
import { productsForUseCase } from '../utils/pingProducts';
import { markCameFromUseCases } from '../utils/fromUseCasesNav';
import { runsSignedOut } from '../utils/useCaseAuth';
import { navigateToAdminOAuthLogin, navigateToCustomerOAuthLogin } from '../utils/authUi';
import {
  clearCompletedUseCases,
  getCompletedUseCaseIds,
  markUseCaseCompleted,
} from '../utils/useCaseDemoProgress';
import { requiredFlagsForUseCase } from '../utils/requiredDemoFlags';
import {
  DEMO_USE_CASE_IDS,
  DEMO_USE_CASE_LABEL,
} from '../config/demoUseCaseSteps';
import { allRelatedUCIds as allAgentGatewayUCIds } from '../config/capabilityLedgers/agentGatewayCapabilities';
import { allRelatedUCIds as allPingOneAuthorizeUCIds } from '../config/capabilityLedgers/pingOneAuthorizeCapabilities';

const TRACK_ORDER = ['foundations', 'demo', 'attacks', 'hitl', 'controls', 'nhi', 'learn', 'tools'];
const TRACK_LABELS = {
  foundations: 'Foundations — delegation lifecycle',
  demo:        'Progressive Trust Demo — Ping MyHotels pattern on banking agents (Acts 1–5)',
  attacks:     'Attacks — malicious attempts blocked by PingOne',
  hitl:        'Human-in-the-Loop — approval, step-up, and consent requirements',
  controls:    'Other Controls — additional policy gates',
  nhi:         'NHI Governance — multi-source inventory and agent lifecycle export',
  learn:       'Learn — explore the platform hands-on',
  tools:       'Developer Tools — utilities and explorers',
};

const HAPPY_PATH_LABEL = 'Happy Paths — successful outcomes across every track';
const DEMO_LABEL = DEMO_USE_CASE_LABEL;
const AGENT_GATEWAY_LABEL = 'Agent Gateway — validate, throttle, transform, and enforce, cited against the running code';
const PINGONE_AUTHORIZE_LABEL = 'PingOne Authorize — contextual runtime decisions, cited against the running code';

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

function maturityLabel(maturity) {
  if (!maturity) return null;
  if (maturity === 'works')                  return { text: 'Works', cls: 'uc-maturity--works' };
  if (maturity === 'needs-build')            return { text: 'Needs build', cls: 'uc-maturity--needs-build' };
  if (maturity === 'needs-console-import')   return { text: 'Needs console import', cls: 'uc-maturity--needs-console' };
  if (maturity.startsWith('flag:'))          return { text: `Flag-gated: ${maturity.slice(5)}`, cls: 'uc-maturity--flag' };
  return { text: maturity, cls: '' };
}

/**
 * Case-insensitive substring match against a use case's searchable fields:
 * id, useCaseId, title, buyerStory, whatToSay, and the trigger's prompt text.
 */
function matchesQuery(uc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [uc.id, uc.useCaseId, uc.title, uc.buyerStory, uc.whatToSay, uc.trigger?.text]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * A track's grid cards, minus any use case exclusively surfaced via the
 * Progressive Trust Demo strip (UC24 / Act 1 in the 'demo' track).
 */
function getDisplayItems(track, items) {
  return track === 'demo'
    ? items.filter((uc) => !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id))
    : items;
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
export function PromptSection({ prompt }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        setCopyFailed(true);
        setTimeout(() => setCopyFailed(false), 2000);
      }
    );
  };

  return (
    <div className="uc-card__prompt-section">
      <div className="uc-card__prompt-header">
        <span className="uc-card__what-to-say-label">What to say:</span>
        <button
          type="button"
          className={`uc-card__copy-btn${copied ? ' uc-card__copy-btn--copied' : ''}`}
          onClick={handleCopy}
          title={copied ? 'Copied!' : copyFailed ? 'Copy failed' : 'Copy prompt'}
          aria-label="Copy prompt to clipboard"
        >
          {copied ? '✓ Copied' : copyFailed ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <p className="uc-card__what-to-say">{prompt}</p>
    </div>
  );
}

function UseCaseCard({ uc, stepNumber, completed, onRun, onRunAttack, onExplain, onOpen, attackState, chipRunning, chipRunError, chipNeedsLogin, flagMap, flagsLoading, onFlagsEnabled }) {
  const isChip   = uc.trigger?.type === 'chip';
  const isAttack = uc.trigger?.type === 'attack';
  const isLink   = uc.trigger?.type === 'link';
  const isEdu    = uc.trigger?.type === 'edu';
  const mat = maturityLabel(uc.maturity);

  const simId = uc.trigger?.sim;
  const normalizedSim = simId ? normalizeSim(simId) : null;
  const isRunnable = isAttack && normalizedSim && RUNNABLE_SIMS.includes(normalizedSim);

  const { running, result, error } = attackState || {};

  // Flag-gating: the FULL required set (maturity flag + any runtime flags
  // like ff_mcp_gateway_pinggateway), not just the maturity flag.
  const requiredFlags = requiredFlagsForUseCase(uc);
  const flagIsOn = requiredFlags.every((id) => flagMap != null && flagMap[id] === 'true');
  const flagGated = requiredFlags.length > 0 && !flagIsOn;

  return (
    <div id={uc.id} className={`uc-card${uc.advanced ? ' uc-card--advanced' : ''}${completed ? ' uc-card--completed' : ''}`}>
      <div className="uc-card__header">
        <span className="uc-card__id">{uc.id}</span>
        {completed && (
          <span className="uc-card__done" aria-label="Completed this session" title="Completed this session">
            ✓
          </span>
        )}
        {stepNumber != null && <span className="uc-card__step">Step {stepNumber}</span>}
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

      <FlagGate
        useCaseId={uc.useCaseId}
        flagIds={requiredFlags}
        flagMap={flagMap}
        loading={flagsLoading}
        onEnabled={onFlagsEnabled}
      />

      {/* UC9 is the one use case whose outcome is decided by DIRECTORY state
          rather than by the prompt, so it gets a control for that state. The
          toggle writes to PingOne and the decision reads the same directory,
          which is what lets the presenter show PERMIT and DENY back to back
          without opening the console. */}
      {uc.useCaseId === 'group-entitlement-check' && <GroupMembershipToggle />}

      {uc.hint && <p className="uc-card__hint">{uc.hint}</p>}

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
            className={`uc-run-btn${chipRunning ? ' uc-run-btn--disabled' : ''}`}
            disabled={chipRunning}
            title={flagGated ? `Will auto-enable ${requiredFlags.join(', ')} on Run` : undefined}
            onClick={() => onRun(uc)}
          >
            {chipRunning ? 'Launching…' : completed ? 'Run again' : 'Run'}
          </button>
        )}
        {isAttack && isRunnable && (
          <button
            type="button"
            className="uc-run-btn"
            disabled={running}
            onClick={() => onRunAttack(uc, normalizedSim)}
          >
            {running ? 'Running…' : completed ? 'Run again' : 'Run'}
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
            {completed ? `Open again` : (uc.trigger.label || 'Open')}
          </button>
        )}
        {isEdu && (
          <button
            type="button"
            className="uc-run-btn"
            onClick={() => onOpen(uc)}
          >
            {completed ? 'Open again' : (uc.trigger.label || 'Open panel')}
          </button>
        )}
        {!isChip && !isAttack && !isLink && !isEdu && (
          <span className="uc-card__no-trigger">No trigger defined</span>
        )}
      </div>

      {isChip && chipRunError && (
        <p className="uc-sim-result__fetch-error">{chipRunError}</p>
      )}
      {isChip && <ChipLoginPrompt prompt={chipNeedsLogin} />}

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
 * Shown when the BFF refuses a step for want of a session. A dead error string
 * leaves the visitor stuck on a page whose only fix is a sign-in they were
 * never offered, so the refusal carries the button that resolves it.
 * @param {{ prompt: { msg: string, loginAs: 'user' | 'admin' } | null }} props
 */
export function ChipLoginPrompt({ prompt }) {
  if (!prompt) return null;
  const asAdmin = prompt.loginAs === 'admin';
  return (
    <p className="uc-sim-result__fetch-error">
      {prompt.msg}{' '}
      <button
        type="button"
        className="uc-run-btn"
        onClick={() => (asAdmin ? navigateToAdminOAuthLogin() : navigateToCustomerOAuthLogin())}
      >
        {asAdmin ? 'Sign in as admin' : 'Sign in'}
      </button>
    </p>
  );
}

/**
 * Ordered presenter strip for the progressive trust demo.
 * Run/Explain delegate to source UCs (UC1, UC8, UC7, UC22, UC6, UC24).
 */
function ProgressiveTrustDemoStrip({
  useCases,
  completedIds,
  onRun,
  onExplain,
  chipRun,
  flagMap,
  flagsLoading,
  onFlagsEnabled,
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
          const completed = completedIds?.has(uc.id);
          const requiredFlags = requiredFlagsForUseCase(uc);
          const flagIsOn = requiredFlags.every((id) => flagMap != null && flagMap[id] === 'true');
          const flagGated = requiredFlags.length > 0 && !flagIsOn;
          const chipRunning = chipRun?.id === uc.id && chipRun.state === 'running';
          const chipRunError = chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null;
          const chipNeedsLogin = chipRun?.id === uc.id && chipRun.state === 'needs-login' ? chipRun : null;
          const mat = maturityLabel(uc.maturity);

          return (
            <li
              key={act.actKey}
              className={[
                'pt-demo-strip__step',
                act.optional ? 'pt-demo-strip__step--optional' : '',
                completed ? 'pt-demo-strip__step--completed' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="pt-demo-strip__step-head">
                <span className="pt-demo-strip__act">{act.actLabel}</span>
                {completed && (
                  <span className="uc-card__done" aria-label="Completed this session" title="Completed this session">
                    ✓
                  </span>
                )}
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
              <FlagGate
                useCaseId={uc.useCaseId}
                flagIds={requiredFlags}
                flagMap={flagMap}
                loading={flagsLoading}
                onEnabled={onFlagsEnabled}
              />
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
                  className={`uc-run-btn${chipRunning ? ' uc-run-btn--disabled' : ''}`}
                  disabled={chipRunning}
                  title={flagGated ? `Will auto-enable ${requiredFlags.join(', ')} on Run` : undefined}
                  onClick={() => onRun(uc)}
                >
                  {chipRunning ? 'Launching…' : completed ? 'Run act again' : 'Run act'}
                </button>
              </div>
              {chipRunError && (
                <p className="uc-sim-result__fetch-error">{chipRunError}</p>
              )}
              <ChipLoginPrompt prompt={chipNeedsLogin} />
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

export default function UseCaseLauncherPage({ onStopAgentClick }) {
  const navigate    = useNavigate();
  const { activeId: verticalId } = useVertical();
  const { open: openEdu } = useEducationUI();
  const { darkMode, toggleDarkMode } = useThemeOptional();

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
  // Monotonic token for the in-flight chip launch chain. Bumped at the start of
  // every handleRun call; a chain checks its captured token against this ref
  // before applying its result, so a slower, earlier launch can never clobber
  // chipRun/navigate() after a faster, later launch has already landed.
  const chipRunTokenRef = useRef(0);

  const [query, setQuery] = useState('');

  // Catalog ids (UC1, UC2, …) marked complete this presenter session.
  const [completedIds, setCompletedIds] = useState(() => getCompletedUseCaseIds());

  const { flagMap, flagsLoading, refreshFlags } = useLiveFlags();
  // Optimistic overlay so a FlagGate's Enable click flips the banner off
  // immediately, without waiting on a refetch of every flag.
  const [localFlagMap, setLocalFlagMap] = useState(null);
  const effectiveFlagMap = localFlagMap || flagMap;
  const handleFlagsEnabled = useCallback((enabledFlags) => {
    setLocalFlagMap((prev) => {
      const base = prev || flagMap || {};
      const next = { ...base };
      for (const id of enabledFlags) next[id] = 'true';
      return next;
    });
  }, [flagMap]);

  const vertical = verticalId || 'banking';

  // Pre-load the agent-brain tier while the presenter browses use cases
  // (fire-and-forget). Honors LLM_PROXY_PIN_TIER when set.
  useEffect(() => {
    opportunisticPrewarm();
  }, []);

  // Re-read progress when returning to this route (remount) or gaining focus after
  // another tab — keeps checks in sync if the same sessionStorage is shared.
  useEffect(() => {
    setCompletedIds(getCompletedUseCaseIds());
    const onFocus = () => setCompletedIds(getCompletedUseCaseIds());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  /** Record a catalog id as completed and refresh card checkmarks. */
  const recordCompleted = useCallback((uc) => {
    if (!uc?.id) return;
    setCompletedIds(markUseCaseCompleted(uc.id));
  }, []);

  /** Reset demo check-offs for a fresh presenter pass. */
  const handleClearProgress = useCallback(() => {
    setCompletedIds(clearCompletedUseCases());
  }, []);

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

  const handleRun = useCallback(async (uc) => {
    if (uc.trigger?.type !== 'chip') return;
    // The backend resolves by the useCaseId slug only — uc.id (e.g. "UC1") is not accepted.
    const useCaseId = uc.useCaseId;
    if (!useCaseId) {
      console.error('Use case missing useCaseId:', uc);
      setChipRun({ id: uc.id, state: 'error', msg: 'This use case is misconfigured (no id).' });
      return;
    }
    const myRunToken = ++chipRunTokenRef.current;
    setChipRun({ id: uc.id, state: 'running' });
    // Auto-arm required flags so Run is not blocked when maturity is flag:* or A2A.
    // Skipped for public use cases: arming PATCHes an admin route, and its 401
    // raises the global re-auth banner over a step that needs no session.
    const flags = runsSignedOut(uc) ? [] : requiredFlagsForUseCase(uc);
    if (flags.length) {
      const updates = Object.fromEntries(flags.map((id) => [id, true]));
      try {
        // _noAuthBanner: same reasoning as ensureRequiredDemoFlags — an arming
        // 401 says nothing about the session, so it must not raise the banner.
        await apiClient.patch('/api/admin/feature-flags', { updates }, { _noAuthBanner: true });
      } catch (e) {
        console.warn('[handleRun] Could not auto-enable flags:', e.message);
      }
    }
    apiClient.post('/api/use-cases/demo/run', { useCaseId, vertical })
      .then(({ data }) => {
        // Switch to the target vertical so the dashboard loads with the correct context.
        // If already on this vertical, this is a no-op.
        return apiClient.post('/api/verticals/active', { id: vertical })
          .then(() => data);
      })
      .then((data) => {
        // A newer Run click has since started its own chain — discard this
        // stale one so it can't overwrite chipRun or navigate over the newer run.
        if (myRunToken !== chipRunTokenRef.current) return;
        // Navigation unmounts this page, so chipRun need not be cleared here.
        // Persist launcher origin so TopNav can show "← Use Cases" after AIAgent
        // clears router state.
        markCameFromUseCases();
        recordCompleted(uc);
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
        if (myRunToken !== chipRunTokenRef.current) return;
        console.error('Failed to run use case:', err);
        // The BFF now says WHICH sign-in a refused step wants, so offer it
        // instead of printing a dead error the visitor can do nothing with.
        const body = err?.response?.data;
        if (body?.requiresLogin) {
          setChipRun({
            id: uc.id,
            state: 'needs-login',
            msg: body.message || 'This step needs you signed in.',
            loginAs: body.requiredAuth === 'admin' ? 'admin' : 'user',
          });
          return;
        }
        setChipRun({ id: uc.id, state: 'error', msg: formatAxiosError(err, 'Failed to launch scenario') });
      });
  }, [navigate, vertical, recordCompleted]);

  // Link-type use cases navigate to their page; edu-type opens a learning panel.
  const handleOpen = useCallback((uc) => {
    if (uc.trigger?.type === 'edu') {
      recordCompleted(uc);
      openEdu(uc.trigger.panel, uc.trigger.tab || 'overview');
      return;
    }
    if (uc.trigger?.path) {
      markCameFromUseCases();
      recordCompleted(uc);
      navigate(uc.trigger.path);
    }
  }, [navigate, openEdu, recordCompleted]);

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
        recordCompleted(uc);
      })
      .catch((err) => {
        const msg = formatAxiosError(err, 'Attack simulation failed');
        setAttackStates((prev) => ({
          ...prev,
          [uc.id]: { running: false, result: null, error: msg },
        }));
      });
  }, [recordCompleted]);

  // These derivations used to run directly in the render body on every
  // render (including unrelated state changes elsewhere in this large
  // component), re-scanning the full cross-vertical use-case catalog on
  // every keystroke in the search box. Memoized on the inputs that
  // actually change: the `*All`/id-Set derivations depend only on
  // `useCases` (or nothing, for the static config lookups), and the
  // query-filtered lists depend on those plus `query` (finding #66,
  // round-4 audit).
  const authorizeIds = useMemo(() => new Set(allPingOneAuthorizeUCIds()), []);
  const agentGatewayIds = useMemo(() => new Set(allAgentGatewayUCIds()), []);

  const happyPathAll = useMemo(
    () => useCases.filter(
      (uc) => uc.expectedOutcome === 'PERMIT' && !PROGRESSIVE_TRUST_STRIP_IDS.has(uc.id)
    ),
    [useCases]
  );
  const happyPathIds = useMemo(() => new Set(happyPathAll.map((uc) => uc.id)), [happyPathAll]);
  const happyPath = useMemo(() => happyPathAll.filter((uc) => matchesQuery(uc, query)), [happyPathAll, query]);

  const authorizeAll = useMemo(() => useCases.filter((uc) => authorizeIds.has(uc.id)), [useCases, authorizeIds]);
  const authorizeVisible = useMemo(() => authorizeAll.filter((uc) => matchesQuery(uc, query)), [authorizeAll, query]);

  const grouped = useMemo(() => TRACK_ORDER.map((track) => ({
    track,
    items: useCases
      .filter((uc) => uc.track === track && !happyPathIds.has(uc.id))
      .filter((uc) => matchesQuery(uc, query)),
  })), [useCases, happyPathIds, query]);

  const demoTrackItemsForStrip = useMemo(() => useCases.filter((uc) => uc.track === 'demo'), [useCases]);

  const demoAll = useMemo(
    () => DEMO_USE_CASE_IDS.map((id) => useCases.find((uc) => uc.id === id)).filter(Boolean),
    [useCases]
  );
  const demoVisible = useMemo(() => demoAll.filter((uc) => matchesQuery(uc, query)), [demoAll, query]);

  const agentGatewayAll = useMemo(() => useCases.filter((uc) => agentGatewayIds.has(uc.id)), [useCases, agentGatewayIds]);
  const agentGatewayVisible = useMemo(() => agentGatewayAll.filter((uc) => matchesQuery(uc, query)), [agentGatewayAll, query]);

  const isSearching = query.trim().length > 0;
  // getDisplayItems mirrors the demo-track STRIP_IDS exclusion applied at
  // render time, so this reflects what actually becomes visible, not just
  // what's in `items`.
  const hasAnyResults =
    demoVisible.length > 0 ||
    happyPath.length > 0 ||
    agentGatewayVisible.length > 0 ||
    authorizeVisible.length > 0 ||
    grouped.some(({ track, items }) => getDisplayItems(track, items).length > 0);

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
        <div className="uc-launcher__progress" data-testid="uc-demo-progress">
          <span className="uc-launcher__progress-count">
            {completedIds.size === 0
              ? 'No use cases run this session yet'
              : `${completedIds.size} completed this session`}
          </span>
          {completedIds.size > 0 && (
            <button
              type="button"
              className="uc-launcher__clear-progress"
              onClick={handleClearProgress}
              title="Clear checkmarks for a fresh demo pass"
            >
              Clear progress
            </button>
          )}
          {onStopAgentClick && (
            <button
              type="button"
              className="uc-launcher__stop-agent"
              onClick={onStopAgentClick}
              title="Revoke the agent's OAuth token at PingOne — stops it before its next tool call"
            >
              Stop Agent
            </button>
          )}
        </div>
        <div className="uc-launcher__search">
          <label htmlFor="uc-search-input" className="uc-launcher__search-label">
            Search use cases
          </label>
          <input
            id="uc-search-input"
            type="search"
            className="uc-launcher__search-input"
            placeholder="Search by title, id, or prompt…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="uc-launcher__vertical-picker" data-testid="uc-vertical-picker">
          <span className="uc-launcher__vertical-label">Vertical</span>
          <VerticalSwitcher variant="pills" />
        </div>
        {/* ☀️/🌙 reserved in REGRESSION_PLAN.md §0 specifically for this control. */}
        <button
          type="button"
          onClick={toggleDarkMode}
          className="ulp__theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
      </header>

      {isSearching && !hasAnyResults && (
        <p className="uc-launcher__empty">No use cases match &quot;{query.trim()}&quot;.</p>
      )}

      {agentGatewayVisible.length > 0 && (
        <section className="uc-track uc-track--agent-gateway">
          <h2 className="uc-track__heading">{AGENT_GATEWAY_LABEL}</h2>
          <div className="uc-track__grid">
            {agentGatewayVisible.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                completed={completedIds.has(uc.id)}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                chipNeedsLogin={chipRun?.id === uc.id && chipRun.state === 'needs-login' ? chipRun : null}
                flagMap={effectiveFlagMap}
                flagsLoading={flagsLoading}
                onFlagsEnabled={handleFlagsEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {demoVisible.length > 0 && (
        <section className="uc-track uc-track--demo-script">
          <h2 className="uc-track__heading">{DEMO_LABEL}</h2>
          <div className="uc-track__grid">
            {demoVisible.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                stepNumber={DEMO_USE_CASE_IDS.indexOf(uc.id) + 1}
                completed={completedIds.has(uc.id)}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                chipNeedsLogin={chipRun?.id === uc.id && chipRun.state === 'needs-login' ? chipRun : null}
                flagMap={effectiveFlagMap}
                flagsLoading={flagsLoading}
                onFlagsEnabled={handleFlagsEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {happyPath.length > 0 && (
        <section className="uc-track uc-track--happy-path">
          <h2 className="uc-track__heading">{HAPPY_PATH_LABEL}</h2>
          <div className="uc-track__grid">
            {happyPath.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                completed={completedIds.has(uc.id)}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                chipNeedsLogin={chipRun?.id === uc.id && chipRun.state === 'needs-login' ? chipRun : null}
                flagMap={effectiveFlagMap}
                flagsLoading={flagsLoading}
                onFlagsEnabled={handleFlagsEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {authorizeVisible.length > 0 && (
        <section className="uc-track uc-track--pingone-authorize">
          <h2 className="uc-track__heading">{PINGONE_AUTHORIZE_LABEL}</h2>
          <div className="uc-track__grid">
            {authorizeVisible.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                completed={completedIds.has(uc.id)}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                chipNeedsLogin={chipRun?.id === uc.id && chipRun.state === 'needs-login' ? chipRun : null}
                flagMap={effectiveFlagMap}
                flagsLoading={flagsLoading}
                onFlagsEnabled={handleFlagsEnabled}
              />
            ))}
          </div>
        </section>
      )}

      {grouped.map(({ track, items }) => {
        if (items.length === 0) return null;
        const displayItems = getDisplayItems(track, items);
        return (
          <section key={track} className="uc-track">
            <h2 className="uc-track__heading">{TRACK_LABELS[track]}</h2>
            {track === 'demo' && !isSearching && (
              <ProgressiveTrustDemoStrip
                useCases={demoTrackItemsForStrip}
                completedIds={completedIds}
                onRun={handleRun}
                onExplain={setExplainUc}
                chipRun={chipRun}
                flagMap={effectiveFlagMap}
                flagsLoading={flagsLoading}
                onFlagsEnabled={handleFlagsEnabled}
              />
            )}
            <div className="uc-track__grid">
              {displayItems.map((uc) => (
                <UseCaseCard
                  key={uc.id}
                  uc={uc}
                  completed={completedIds.has(uc.id)}
                  onRun={handleRun}
                  onRunAttack={handleRunAttack}
                  onExplain={setExplainUc}
                  onOpen={handleOpen}
                  attackState={attackStates[uc.id]}
                  chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                  chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                  chipNeedsLogin={chipRun?.id === uc.id && chipRun.state === 'needs-login' ? chipRun : null}
                  flagMap={effectiveFlagMap}
                  flagsLoading={flagsLoading}
                  onFlagsEnabled={handleFlagsEnabled}
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
