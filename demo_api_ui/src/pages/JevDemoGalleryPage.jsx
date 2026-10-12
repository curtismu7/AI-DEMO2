// demo_api_ui/src/pages/JevDemoGalleryPage.jsx
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import InlineSpinner from '../components/shared/InlineSpinner';
import { ARTICLES, GALLERY } from './jevDemoContent';
import './JevLearningPage.css';

/**
 * The eight demos from "8 Cool Things People Use the Jev Model For", each a
 * runnable sketch on the same scenario-locked backend as JevLearningPage.
 * One route component renders any demo: /jev-demos/:demoId.
 *
 * Raw fetch on purpose (same as JevLearningPage): renders signed out, and a
 * 429/502 is an expected state shown inline.
 */

const ESCALATE_LOW = 0.35;
const ESCALATE_HIGH = 0.65;

async function evaluate(scenario, state) {
  const res = await fetch('/api/demo/jev/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, state }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

async function batch(scenario, states) {
  const res = await fetch('/api/demo/jev/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, states }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
  return body;
}

function ModeBadge({ mode, model }) {
  if (mode === 'live') return <span className="jev-badge jev-badge--live">{`Live: ${model}`}</span>;
  if (mode === 'recorded') return <span className="jev-badge jev-badge--rec">Recorded</span>;
  return <span className="jev-badge jev-badge--sim">Simulated — not configured</span>;
}

function ReportedNote({ children }) {
  return (
    <p className="jev-meta">
      <strong>Reported by the demo’s creator:</strong> {children}. Figures are as reported, not measured here —
      simulated mode is the keyword baseline and says nothing about Jev.
    </p>
  );
}

function Pill({ value, threshold = 0.5, label }) {
  const on = value >= threshold;
  return (
    <span className={`jev-chip${on ? ' jev-chip--on' : ''}`} style={{ cursor: 'default' }}>
      {label} ({value.toFixed(2)})
    </span>
  );
}

/** The Jev cell for a batch row: a probability pill for noul answers, the
 * picked choice (with confidence) for choice answers. */
function JevCell({ answer, actLabel, passLabel }) {
  if (!answer) return null;
  if (answer.type === 'choice') {
    return (
      <span className="jev-chip jev-chip--on" style={{ cursor: 'default' }}>
        {answer.choice}{answer.confidence != null ? ` (${Math.round(answer.confidence * 100)}%)` : ''}
      </span>
    );
  }
  return <Pill value={answer.probability} label={answer.probability >= 0.5 ? actLabel : passLabel} />;
}

/** The keyword-rules cell for a batch row, from the heuristic answer. */
function renderBaseline(baseline, actLabel, passLabel) {
  if (!baseline) return '—';
  if (baseline.type === 'choice') return baseline.choice;
  return baseline.probability >= 0.5 ? actLabel : passLabel;
}

function EscalateBand({ low, high, onChange }) {
  return (
    <label className="jev-slider">
      Escalate between <strong>{low.toFixed(2)}</strong> and <strong>{high.toFixed(2)}</strong>
      <input
        type="range" min="0" max="1" step="0.01" value={low}
        aria-label="Escalation lower bound"
        onChange={(e) => onChange([Math.min(Number(e.target.value), high - 0.01), high])}
      />
      <input
        type="range" min="0" max="1" step="0.01" value={high}
        aria-label="Escalation upper bound"
        onChange={(e) => onChange([low, Math.max(Number(e.target.value), low + 0.01)])}
      />
    </label>
  );
}

/** Shared outcome logic for noul batches: act / escalate / pass. */
function noulVerdicts(rows, low, high) {
  return rows.map((r) => {
    const p = r.answer.probability;
    if (p >= high) return { ...r, verdict: 'act' };
    if (p > low) return { ...r, verdict: 'escalate' };
    return { ...r, verdict: 'pass' };
  });
}

/** Batch demo driven by content.items: state text + what "act" means. */
function BatchDemo({ cfg, actLabel, passLabel, escalateNote, content }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [band, setBand] = useState([ESCALATE_LOW, ESCALATE_HIGH]);

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    setRows(null);
    try {
      const out = await batch(cfg.scenario, content.items.map((it) => it.state));
      setRows(out.jev.map((r, i) => ({
        ...content.items[i],
        mode: r.mode, model: r.model, answer: r.answer,
        baseline: out.heuristic.answers[i],
      })));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [cfg.scenario, content.items]);

  const verdicts = useMemo(() => (rows ? noulVerdicts(rows, band[0], band[1]) : []), [rows, band]);
  const escalated = verdicts.filter((v) => v.verdict === 'escalate');

  return (
    <section className="jev-card" aria-labelledby={`jev-demo-${cfg.id}`}>
      <h2 id={`jev-demo-${cfg.id}`} className="jev-h2">{cfg.title}</h2>
      <p className="jev-lead">{content.lead}</p>
      <ReportedNote>{cfg.reported}</ReportedNote>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>
        {busy ? 'Scoring...' : content.runLabel}
      </button>
      {busy && (
        <p className="jev-waiting">
          <InlineSpinner size="sm" label="Jev is scoring the batch" />
          <span className="jev-waiting-note">one call per item, fired in parallel</span>
        </p>
      )}
      {error && <p className="jev-error" role="alert">{error}</p>}
      {rows && (
        <>
          <table className="jev-table">
            <thead>
              <tr><th>Item</th><th>Keyword rules</th><th>Jev</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name || r.text || i}>
                  <td>{r.label || r.name || r.text}</td>
                  <td>{content.baselineCell ? content.baselineCell(r, i) : renderBaseline(r.baseline, content.actLabel || actLabel, passLabel)}</td>
                  <td>
                    <JevCell answer={r.answer} actLabel={content.actLabel || actLabel} passLabel={passLabel} />
                    {r.mode === 'error' && <span className="jev-error">error</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jev-big"><ModeBadge mode={rows[0].mode} model={rows[0].model} /></p>
          {content.withBand && (
            <>
              <EscalateBand low={band[0]} high={band[1]} onChange={setBand} />
              <p className="jev-explain">
                {escalated.length
                  ? <>Escalated to a person: {escalated.map((v) => `“${v.label || v.name || v.text}”`).join(', ')}. </>
                  : 'Nothing in the uncertain band right now. '}
                A check inside the band is not a verdict — it is a human’s queue.
              </p>
            </>
          )}
          <p className="jev-explain">{escalateNote}</p>
        </>
      )}
    </section>
  );
}

/** Single-decision demo: screen state -> one typed action. */
function ComputerUseDemo({ cfg }) {
  const [screenIdx, setScreenIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const screen = cfg.screens[screenIdx];

  const decide = useCallback(async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const r = await evaluate(cfg.scenario, `Goal: ${screen.goal}. Screen: ${screen.state}`);
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [cfg.scenario, screen]);

  return (
    <section className="jev-card" aria-labelledby="jev-demo-cu">
      <h2 id="jev-demo-cu" className="jev-h2">{cfg.title}</h2>
      <p className="jev-lead">{cfg.lead}</p>
      <ReportedNote>{cfg.reported}</ReportedNote>
      <div className="jev-tabs" role="tablist">
        {cfg.screens.map((s, i) => (
          <button key={s.id} type="button" role="tab" aria-selected={i === screenIdx}
            className={`jev-tab${i === screenIdx ? ' jev-tab--on' : ''}`}
            onClick={() => { setScreenIdx(i); setResult(null); setError(''); }}>
            {s.name}
          </button>
        ))}
      </div>
      <p className="jev-about"><strong>Goal:</strong> {screen.goal}</p>
      <p className="jev-explain">{screen.state}</p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={decide}>{busy ? 'Deciding...' : 'Decide next action'}</button>
      {busy && <p className="jev-waiting"><InlineSpinner size="sm" label="Jev is reading the screen" /></p>}
      {error && <p className="jev-error" role="alert">{error}</p>}
      {result && (
        <div className="jev-cols">
          <div className="jev-col">
            <h3 className="jev-h3">Keyword rules</h3>
            <p className="jev-big">{result.heuristic.answer.choice}</p>
            <p className="jev-explain">Matches words like “type”, “menu”, “open” — the screen text here deliberately contains several, so it guesses by vibe.</p>
          </div>
          <div className="jev-col">
            <h3 className="jev-h3">Jev <ModeBadge mode={result.jev.mode} model={result.jev.model} /></h3>
            <p className="jev-big">{result.jev.answer.choice} ({Math.round((result.jev.answer.confidence ?? 0) * 100)}% confident)</p>
            <p className="jev-explain">
              Expected: <strong>{screen.expected}</strong> — {screen.expectedWhy}
              {result.jev.mode === 'simulated' && ' (simulated mode cannot read the screen; it matches words.)'}
            </p>
            <p className="jev-meta">{result.jev.latencyMs} ms</p>
          </div>
        </div>
      )}
    </section>
  );
}

/** Game loop demo (gameMove / tradeSide): deterministic script of frames,
 * one Jev decision per frame, history rendered as a decision log. */
function GameLoopDemo({ cfg, frames, runLabel }) {
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    setLog(null);
    try {
      const out = [];
      for (const f of frames) {
        const r = await evaluate(cfg.scenario, f.state);
        out.push({
          ...f,
          answer: r.jev.answer,
          mode: r.jev.mode,
          model: r.jev.model,
          ms: r.jev.latencyMs,
          rules: r.heuristic.answer.choice ?? (r.heuristic.answer.probability >= 0.5 ? 'yes' : 'no'),
        });
      }
      setLog(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [cfg.scenario, frames]);

  return (
    <section className="jev-card" aria-labelledby={`jev-demo-${cfg.id}`}>
      <h2 id={`jev-demo-${cfg.id}`} className="jev-h2">{cfg.title}</h2>
      <p className="jev-lead">{cfg.lead}</p>
      <ReportedNote>{cfg.reported}</ReportedNote>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Running...' : runLabel}</button>
      {busy && <p className="jev-waiting"><InlineSpinner size="sm" label="Decision loop running" /><span className="jev-waiting-note">one call per frame, sequential — that is the loop</span></p>}
      {error && <p className="jev-error" role="alert">{error}</p>}
      {log && (
        <>
          <table className="jev-table">
            <thead><tr><th>Frame</th><th>Situation</th><th>Rules</th><th>Jev</th><th>Outcome</th></tr></thead>
            <tbody>
              {log.map((f, i) => {
                // With a correct action recorded (the runner), grade both
                // columns on it. Without one (the market), the outcome is
                // what the frame says the price did — displayed, not graded.
                const graded = Boolean(f.correct);
                const good = graded ? f.answer.choice === f.correct : true;
                const rulesGood = graded ? f.rules === f.correct : true;
                const outcome = graded
                  ? (good ? f.goodOutcome : f.badOutcome)
                  : (f.answer.choice === 'buy' ? f.goodOutcome : f.badOutcome);
                return (
                  <tr key={f.state}>
                    <td>{i + 1}</td>
                    <td>{f.state}</td>
                    <td className={rulesGood ? 'jev-right' : 'jev-wrong'}>{f.rules}</td>
                    <td className={good ? 'jev-right' : 'jev-wrong'}>
                      {f.answer.choice}{f.answer.confidence != null ? ` (${Math.round(f.answer.confidence * 100)}%)` : ''}
                    </td>
                    <td className={graded && !good ? 'jev-wrong' : ''}>{outcome}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="jev-big"><ModeBadge mode={log[0].mode} model={log[0].model} /></p>
          <p className="jev-explain">{cfg.lesson}</p>
        </>
      )}
    </section>
  );
}

/** PR review: batch + escalation band is the whole lesson. */
function PrReviewDemo({ cfg }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [band, setBand] = useState([ESCALATE_LOW, ESCALATE_HIGH]);

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    setRows(null);
    try {
      const out = await batch(cfg.scenario, cfg.checks.map((c) => c.text));
      setRows(out.jev.map((r, i) => ({
        ...cfg.checks[i],
        mode: r.mode, model: r.model, answer: r.answer,
        baseline: out.heuristic.answers[i],
      })));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [cfg]);

  const verdicts = useMemo(() => (rows ? noulVerdicts(rows, band[0], band[1]) : []), [rows, band]);
  const counts = {
    block: verdicts.filter((v) => v.verdict === 'act').length,
    escalate: verdicts.filter((v) => v.verdict === 'escalate').length,
    pass: verdicts.filter((v) => v.verdict === 'pass').length,
  };

  return (
    <section className="jev-card" aria-labelledby="jev-demo-pr">
      <h2 id="jev-demo-pr" className="jev-h2">{cfg.title}</h2>
      <p className="jev-lead">{cfg.lead}</p>
      <ReportedNote>{cfg.reported}</ReportedNote>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Reviewing...' : 'Run 6 checks on the diff'}</button>
      {busy && <p className="jev-waiting"><InlineSpinner size="sm" label="Scoring every check in parallel" /></p>}
      {error && <p className="jev-error" role="alert">{error}</p>}
      {rows && (
        <>
          <table className="jev-table">
            <thead><tr><th>Check</th><th>Snippet</th><th>Keyword rules</th><th>Jev P(risky)</th><th>Verdict</th></tr></thead>
            <tbody>
              {verdicts.map((v) => (
                <tr key={v.id}>
                  <td>{v.label}</td>
                  <td><code style={{ fontSize: '0.85em' }}>{v.text}</code></td>
                  <td>{v.baseline?.probability >= 0.5 ? 'flag' : 'pass'}</td>
                  <td>{v.answer.probability.toFixed(2)}</td>
                  <td className={v.verdict === 'escalate' ? '' : v.verdict === 'act' ? 'jev-wrong' : 'jev-right'}>
                    {v.verdict === 'act' ? 'block / security review' : v.verdict === 'escalate' ? 'escalate to a person' : 'safe to merge'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jev-big">
            {counts.block} block · {counts.escalate} escalate · {counts.pass} pass <ModeBadge mode={rows[0].mode} model={rows[0].model} />
          </p>
          <EscalateBand low={band[0]} high={band[1]} onChange={setBand} />
          <p className="jev-explain">{cfg.lesson}</p>
        </>
      )}
    </section>
  );
}

export default function JevDemoGalleryPage() {
  const { demoId } = useParams();
  const entry = GALLERY.find((g) => g.id === demoId) || GALLERY[0];
  // ARTICLES carries the demo body; id/title come from the GALLERY entry.
  const cfg = { ...ARTICLES[entry.id], id: entry.id, title: entry.title };

  return (
    <div className="jev-page">
      <h1 className="jev-h1">Jev demos: eight things people build with a decision model</h1>
      <p className="jev-sub">
        Eight demos from the wild, rebuilt as runnable sketches on this stack’s scenario-locked Jev backend.
        Every demo is a typed question with a probability back — the differences are what is being asked,
        what acts on the answer, and what happens in the uncertain middle. Costs and timings are the
        creators’ reported figures, shown as reported.
      </p>

      <nav className="jev-tabs" aria-label="Jev demos" style={{ marginBottom: '1rem' }}>
        {GALLERY.map((g) => (
          <Link key={g.id} to={`/jev-demos/${g.id}`}
            className={`jev-tab${g.id === entry.id ? ' jev-tab--on' : ''}`}
            style={{ textDecoration: 'none' }}>
            {g.label}
          </Link>
        ))}
      </nav>

      {entry.id === 'pr-review' && <PrReviewDemo key={entry.id} cfg={cfg} />}
      {entry.id === 'computer-use' && <ComputerUseDemo key={entry.id} cfg={cfg} />}
      {entry.id === 'internal-links' && (
        <BatchDemo key={entry.id} cfg={cfg} actLabel="link" passLabel="decline"
          content={{
            lead: cfg.lead, runLabel: 'Score 4 page pairs',
            items: cfg.pairs.map((p) => ({ label: `“${p.from}” → “${p.to}”`, state: `${p.from}\n---\n${p.to}`, match: p.match })),
            baselineCell: () => 'overlap rule',
            escalateNote: cfg.lesson,
          }}
        />
      )}
      {entry.id === 'doc-sort' && (
        <BatchDemo key={entry.id} cfg={cfg} actLabel="classified" passLabel="—"
          content={{
            lead: cfg.lead, runLabel: 'Classify 5 pages',
            items: cfg.docs.map((d) => ({ label: d.name, state: d.text })),
            baselineCell: null,
            escalateNote: cfg.lesson,
          }}
        />
      )}
      {entry.id === 'compaction' && (
        <BatchDemo key={entry.id} cfg={cfg} actLabel="keep" passLabel="drop"
          content={{
            lead: cfg.lead, runLabel: 'Score the transcript',
            items: cfg.transcript.map((t) => ({ label: `${t.turn} ${t.text}`, state: t.text })),
            baselineCell: null,
            escalateNote: cfg.lesson,
          }}
        />
      )}
      {entry.id === 'papers' && (
        <BatchDemo key={entry.id} cfg={cfg} actLabel="topic" passLabel="—"
          content={{
            lead: cfg.lead, runLabel: 'Classify 5 papers',
            items: cfg.papers.map((p) => ({ label: p.title, state: `Title: ${p.title}\nAbstract: ${p.abstract}` })),
            baselineCell: null,
            escalateNote: cfg.lesson,
          }}
        />
      )}
      {(entry.id === 'game-agent' || entry.id === 'trading') && (
        <GameLoopDemo
          key={entry.id}
          cfg={cfg}
          frames={FRAMES[entry.id]}
          runLabel={entry.id === 'game-agent' ? 'Run the runner' : 'Run the trading loop'}
        />
      )}
    </div>
  );
}

// Deterministic frame scripts: same frames every run, so a decision is
// comparable across runs and across deciders. `correct` is the one action
// that survives the frame — the outcome column grades both deciders on it.
const FRAMES = {
  'game-agent': [
    { state: 'Track ahead is clear for three lanes.', correct: 'stay', goodOutcome: 'keeps pace', badOutcome: 'wasted move' },
    { state: 'A low barrier is on the track ahead.', correct: 'jump', goodOutcome: 'jumps it', badOutcome: 'crashes into the barrier' },
    { state: 'An overhead beam spans all lanes at head height.', correct: 'slide', goodOutcome: 'slides under', badOutcome: 'knocked out by the beam' },
    { state: 'A gap on the left; the right lane is blocked further ahead.', correct: 'left', goodOutcome: 'moves left', badOutcome: 'stuck on the blocked side' },
    { state: 'Train approaching in the current lane, gap on the right.', correct: 'right', goodOutcome: 'dodges the train', badOutcome: 'hits the train' },
    { state: 'Everything clear, coin trail continues straight.', correct: 'stay', goodOutcome: 'keeps pace', badOutcome: 'wasted move' },
  ],
  trading: [
    // No single "correct" side exists in a market — grade both columns on
    // what the price did next (which the frame records) instead.
    { state: 'Price tick +0.8% on rising volume, green streak.', correct: null, goodOutcome: 'profit this block', badOutcome: 'loss this block' },
    { state: 'Price tick -1.2%, red, sellers in control.', correct: null, goodOutcome: 'profit this block', badOutcome: 'loss this block' },
    { state: 'Price tick +0.1%, flat, no momentum either way.', correct: null, goodOutcome: 'breaks even', badOutcome: 'small loss' },
    { state: 'Price tick -0.4%, drifting down on thin volume.', correct: null, goodOutcome: 'profit this block', badOutcome: 'loss this block' },
    { state: 'Price tick +2.3% sudden spike, green, gaining fast.', correct: null, goodOutcome: 'profit this block', badOutcome: 'loss this block' },
  ],
};
