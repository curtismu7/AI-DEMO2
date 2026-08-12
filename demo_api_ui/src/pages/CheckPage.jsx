// demo_api_ui/src/pages/CheckPage.jsx
import React, { useEffect, useState } from 'react';
import './CheckPage.css';
import { useCheckRun } from '../hooks/useCheckRun';
import { useVertical } from '../vertical/useVertical';
import { runChipTest } from './check/chipTest';
import CardsView from './check/CardsView';
import StepperView from './check/StepperView';
import ChecklistView from './check/ChecklistView';
import RailDetailView from './check/RailDetailView';
import ServersPage from './ServersPage';
import PreflightModal from '../components/PreflightModal';

// Mirrors demo_api_server/config/useCases.js VERTICALS — keep in sync.
const VERTICALS = ['banking', 'healthcare', 'retail', 'government', 'university', 'workforce', 'sporting-goods', 'manufacturing', 'investment'];
const VIEWS = { cards: CardsView, stepper: StepperView, checklist: ChecklistView, rail: RailDetailView };
const VIEW_LABELS = { cards: 'Cards', stepper: 'Stepper', checklist: 'Checklist', rail: 'Rail + Detail' };
const VERDICT_TEXT = { ready: 'Ready for demo', ready_with_warnings: 'Ready — with warnings', not_ready: 'Not ready' };
// Fallback only — the project's default vertical for manual validation. The
// selector starts on whatever vertical the app is actually showing, so a chip
// test run from a retail session doesn't silently target banking.
const DEFAULT_VERTICAL = 'sporting-goods';

export function initialVertical(activeId) {
  return VERTICALS.includes(activeId) ? activeId : DEFAULT_VERTICAL;
}

export default function CheckPage() {
  const { catalog, results, verdict, running, loadCatalog, runAll, setResult } = useCheckRun();
  const [view, setView] = useState('cards');
  // ff_preflight_modal (default OFF) — a one-verdict demo-prep summary over the
  // same registry this page renders as cards. Additive: when the flag is off
  // nothing about this page changes.
  const [preflightEnabled, setPreflightEnabled] = useState(false);
  const [preflightOpen, setPreflightOpen] = useState(false);
  useEffect(() => {
    fetch('/api/admin/feature-flags', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const f = data?.flags?.find((x) => x.id === 'ff_preflight_modal');
        if (f != null) setPreflightEnabled(Boolean(f.value));
      })
      .catch(() => {});
  }, []);
  // `picked` is the operator's explicit override; until they choose, the
  // selector tracks the vertical the app is actually on.
  const { activeId } = useVertical();
  const [picked, setPicked] = useState(null);
  const vertical = picked || initialVertical(activeId);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  const ViewComp = VIEWS[view];

  return (
    <div className="check-wrap">
      <header className="check-page-head">
        <h1>Demo check</h1>
        <p className="check-page-sub">
          Pre-demo readiness — stack health, a real PERMIT path, and a DENY proof.
          Sign in, then run before your talk.
        </p>
      </header>
      {preflightEnabled && (
        <PreflightModal isOpen={preflightOpen} onClose={() => setPreflightOpen(false)} />
      )}
      <ServersPage />
      <div className={`verdict-bar verdict-${verdict || 'idle'}`}>
        <div className="verdict"><span className="dot" />
          <h2>{verdict ? VERDICT_TEXT[verdict] : 'Not run yet'}</h2></div>
        <div className="verdict-actions">
          <button className="chk-btn chk-btn-primary" disabled={running} onClick={() => runAll({ includeHeavy: false }).catch(() => {})}>Run demo check</button>
          {preflightEnabled && (
            <button className="chk-btn" type="button" onClick={() => setPreflightOpen(true)}>Preflight summary</button>
          )}
        </div>
      </div>

      <div className="check-tabs" role="tablist">
        {Object.keys(VIEWS).map((k) => (
          <button key={k} role="tab" aria-selected={view === k} className="chk-tab" onClick={() => setView(k)}>{VIEW_LABELS[k]}</button>
        ))}
      </div>

      <div className="check-actions">
        <label className="chk-select-label">Vertical
          <select className="chk-select" value={vertical} disabled={running} onChange={(e) => setPicked(e.target.value)}>
            {VERTICALS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <button className="chk-btn chk-btn-ghost" disabled={running} onClick={async () => setResult(await runChipTest({ vertical }))}>Run real chip test</button>
        <button className="chk-btn chk-btn-ghost" disabled={running} onClick={() => runAll({ includeHeavy: true }).catch(() => {})}>Deep LLM test</button>
      </div>

      <ViewComp catalog={catalog} results={results} verdict={verdict} />
    </div>
  );
}
