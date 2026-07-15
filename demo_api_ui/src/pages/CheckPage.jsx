// demo_api_ui/src/pages/CheckPage.jsx
import React, { useEffect, useState } from 'react';
import './CheckPage.css';
import { useCheckRun } from '../hooks/useCheckRun';
import { runChipTest } from './check/chipTest';
import CardsView from './check/CardsView';
import StepperView from './check/StepperView';
import ChecklistView from './check/ChecklistView';
import RailDetailView from './check/RailDetailView';

const VIEWS = { cards: CardsView, stepper: StepperView, checklist: ChecklistView, rail: RailDetailView };
const VIEW_LABELS = { cards: 'Cards', stepper: 'Stepper', checklist: 'Checklist', rail: 'Rail + Detail' };
const VERDICT_TEXT = { ready: 'Ready for demo', ready_with_warnings: 'Ready — with warnings', not_ready: 'Not ready' };

export default function CheckPage() {
  const { catalog, results, verdict, running, loadCatalog, runAll, setResult } = useCheckRun();
  const [view, setView] = useState('cards');
  const [vertical, setVertical] = useState('banking');

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
      <div className={`verdict-bar verdict-${verdict || 'idle'}`}>
        <div className="verdict"><span className="dot" />
          <h2>{verdict ? VERDICT_TEXT[verdict] : 'Not run yet'}</h2></div>
        <div className="verdict-actions">
          <button className="chk-btn chk-btn-primary" disabled={running} onClick={() => runAll({ includeHeavy: false }).catch(() => {})}>Run demo check</button>
        </div>
      </div>

      <div className="check-tabs" role="tablist">
        {Object.keys(VIEWS).map((k) => (
          <button key={k} role="tab" aria-selected={view === k} className="chk-tab" onClick={() => setView(k)}>{VIEW_LABELS[k]}</button>
        ))}
      </div>

      <div className="check-actions">
        <label>Vertical
          <select value={vertical} disabled={running} onChange={(e) => setVertical(e.target.value)}>
            <option value="banking">banking</option>
            <option value="healthcare">healthcare</option>
            <option value="workforce">workforce</option>
          </select>
        </label>
        <button className="chk-btn chk-btn-ghost" disabled={running} onClick={async () => setResult(await runChipTest({ vertical }))}>Run real chip test</button>
        <button className="chk-btn chk-btn-ghost" disabled={running} onClick={() => runAll({ includeHeavy: true }).catch(() => {})}>Deep LLM test</button>
      </div>

      <ViewComp catalog={catalog} results={results} verdict={verdict} />
    </div>
  );
}
