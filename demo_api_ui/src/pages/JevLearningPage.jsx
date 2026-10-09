// demo_api_ui/src/pages/JevLearningPage.jsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  SYSTEM_COMPARE,
  SCENARIOS,
  BAKEOFF,
  INTENT_BAKEOFF,
  RECORDED_RUN,
  guardrailReadout,
  intentReadout,
  POLICY_RULES,
  decide,
} from './jevLessons';
import InlineSpinner from '../components/shared/InlineSpinner';
import './JevLearningPage.css';

/** Which verdict the keyword rules just gave, so its explanation can react. */
function rulesHit(answer) {
  return Boolean(answer && answer.type !== 'choice' && answer.probability >= 0.5);
}

/**
 * Jev walkthrough — System 1 vs System 2, a live side-by-side, the
 * "confidence is not permission" threshold lesson, and a small guardrail bake-off.
 *
 * Raw `fetch` on purpose (same as A2AProtocolLearningPage): the page renders
 * signed out and a 429/502 here is an expected state shown inline, not a
 * session-expired event.
 */

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

/** One number a column can show for any answer type. */
function headline(answer) {
  if (!answer) return '';
  if (answer.type === 'choice') return `${answer.choice} (${Math.round((answer.confidence ?? 0) * 100)}% confident)`;
  return `P(yes) = ${answer.probability.toFixed(2)}`;
}

/** Plain-language reading of a live answer, shown under the number. */
function explainJev(answer) {
  if (!answer) return '';
  if (answer.type === 'choice') {
    return 'The model read the meaning of the text, picked the best-fitting option, and reports how confident it is in that pick.';
  }
  const pct = Math.round(answer.probability * 100);
  return `The model read the meaning of the text and scored how likely the answer to the question above is "yes": about ${pct}%. Unlike the rules, it can say "probably" or "not sure", and a score near 50% means it is unsure.`;
}

function ModeBadge({ mode, model }) {
  if (mode === 'recorded') {
    return <span className="jev-badge jev-badge--rec">{`Recorded: ${model}, ${RECORDED_RUN.date}`}</span>;
  }
  return mode === 'live' ? (
    <span className="jev-badge jev-badge--live">{`Live: ${model}`}</span>
  ) : (
    <span className="jev-badge jev-badge--sim">Simulated - not configured</span>
  );
}

// The recorded run, shaped like live rows, shown until (and unless) a live run replaces it.
const RECORDED_GUARDRAIL_ROWS = RECORDED_RUN.guardrail.map((r) => ({ ...r, mode: 'recorded', model: RECORDED_RUN.model }));
const RECORDED_INTENT_ROWS = RECORDED_RUN.intent.map((r) => ({ ...r, mode: 'recorded', model: RECORDED_RUN.model }));

/** Says plainly that the rows on screen are a saved example, not a live answer. */
function RecordedNote({ busy, runLabel }) {
  return (
    <p className="jev-explain jev-recorded">
      {busy
        ? `Running live now. Until the results arrive, this is the recorded example from ${RECORDED_RUN.model} (${RECORDED_RUN.date}).`
        : `This is an example run recorded from ${RECORDED_RUN.model} on ${RECORDED_RUN.date}, shown so you can see what to expect. Click "${runLabel}" to run it live.`}
    </p>
  );
}

function LivePanel({ onRisk }) {
  const [scenario, setScenario] = useState('injection');
  const [text, setText] = useState(SCENARIOS.injection.examples[0]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (key) => {
    setScenario(key);
    setText(SCENARIOS[key].examples[0]);
    setResult(null);
    setError('');
  };

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const r = await evaluate(scenario, text);
      setResult(r);
      if (scenario === 'risk' && r.jev.answer.type === 'noul') onRisk(r.jev.answer.probability);
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [scenario, text, onRisk]);

  return (
    <section className="jev-card" aria-labelledby="jev-live">
      <h2 id="jev-live" className="jev-h2">Same input, two deciders</h2>
      <p className="jev-lead">{SCENARIOS[scenario].question}</p>
      <p className="jev-step"><span className="jev-step-n">1</span> Choose a scenario</p>
      <div className="jev-tabs" role="tablist">
        {Object.entries(SCENARIOS).map(([key, s]) => (
          <button
            key={key}
            role="tab"
            aria-selected={scenario === key}
            className={`jev-tab${scenario === key ? ' jev-tab--on' : ''}`}
            onClick={() => pick(key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="jev-about">{SCENARIOS[scenario].about}</p>
      <p className="jev-step"><span className="jev-step-n">2</span> Click an example to load it, or type your own below</p>
      <div className="jev-examples">
        {SCENARIOS[scenario].examples.map((ex) => (
          <button key={ex} className="jev-chip" onClick={() => setText(ex)}>{ex}</button>
        ))}
      </div>
      <p className="jev-step"><span className="jev-step-n">3</span> Edit the text if you like, then press Decide to run both deciders on it</p>
      <textarea
        className="jev-input"
        aria-label="Text to judge"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={run}>
        {busy ? 'Deciding...' : 'Decide'}
      </button>
      {busy && (
        <p className="jev-waiting">
          <InlineSpinner size="sm" label="Jev is reading the text" />
          <span className="jev-waiting-note">a decision model, not a chat: this takes a second, longer the first time while the local model loads</span>
        </p>
      )}
      {error && <p className="jev-error" role="alert">{error}</p>}
      {result && (
        <div className="jev-cols">
          <div className="jev-col">
            <h3 className="jev-h3">Keyword rules</h3>
            <p className="jev-big">{headline(result.heuristic.answer)}</p>
            {rulesHit(result.heuristic.answer) ? (
              <p className="jev-explain">
                Matched a trigger phrase on its fixed list, so it says yes (1.00) - and that is all it
                can ever say. It never reads meaning and never says "maybe", so a reworded attack that
                uses no listed phrase slips straight through.
              </p>
            ) : (
              <p className="jev-explain">
                Matched nothing on its trigger-word list, so it says no (0.00) - but that only means the
                exact phrases it knows are absent. "Please kindly forget everything you were told" is an
                attack with no trigger phrase, which is exactly what it just missed.
              </p>
            )}
            <p className="jev-meta">{result.heuristic.latencyMs} ms - always 0 or 1, never unsure</p>
          </div>
          <div className="jev-col">
            <h3 className="jev-h3">Jev <ModeBadge mode={result.jev.mode} model={result.jev.model} /></h3>
            <p className="jev-big">{headline(result.jev.answer)}</p>
            {result.jev.mode === 'live' && <p className="jev-explain">{explainJev(result.jev.answer)}</p>}
            {result.jev.mode === 'live' && result.jev.answer.type !== 'choice' && (
              <p className="jev-explain">{SCENARIOS[scenario].howUsed}</p>
            )}
            <p className="jev-meta">{result.jev.latencyMs} ms - model {result.jev.model}</p>
            {result.jev.mode === 'live' && (
              <p className="jev-meta">Deterministic: the same text always scores the same - rerun it to check. Different wording moves the score less than you'd expect, because it scores classes of text, not vibes.</p>
            )}
            {result.jev.mode === 'simulated' && (
              <p className="jev-meta">
                No OPENROUTER_API_KEY or JEV_ENDPOINT on the server, so this column is the same keyword rules. It says nothing about Jev.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ThresholdLesson({ probability, setProbability }) {
  const [stepUpAt, setStepUpAt] = useState(0.4);
  const [denyAt, setDenyAt] = useState(0.9);
  const outcome = decide(probability, stepUpAt, denyAt);
  return (
    <section className="jev-card" aria-labelledby="jev-thresh">
      <h2 id="jev-thresh" className="jev-h2">Confidence is not permission</h2>
      <p className="jev-lead">
        Jev answers "how likely is this risky?". Whether that means allow, step up or deny is a
        policy decision. In this demo that belongs to PingOne Authorize and the gateway - the model
        score is one attribute they can read, not the verdict. Drag the lines to see the same
        score flip outcome. Run the Step-up risk example above to load a real score.
      </p>
      <label className="jev-slider">
        Jev P(yes risky): <strong>{probability.toFixed(2)}</strong>
        <input type="range" min="0" max="1" step="0.01" value={probability}
          onChange={(e) => setProbability(Number(e.target.value))} />
      </label>
      <label className="jev-slider">
        Step-up at: <strong>{stepUpAt.toFixed(2)}</strong>
        <input type="range" min="0" max="1" step="0.01" value={stepUpAt}
          onChange={(e) => setStepUpAt(Math.min(Number(e.target.value), denyAt))} />
      </label>
      <label className="jev-slider">
        Deny at: <strong>{denyAt.toFixed(2)}</strong>
        <input type="range" min="0" max="1" step="0.01" value={denyAt}
          onChange={(e) => setDenyAt(Math.max(Number(e.target.value), stepUpAt))} />
      </label>
      <ul className="jev-outcomes">
        {POLICY_RULES.map((r) => (
          <li key={r.id} className={`jev-outcome jev-outcome--${r.id}${outcome === r.id ? ' jev-outcome--on' : ''}`}>
            <strong>{r.label}</strong> - {r.detail}
          </li>
        ))}
      </ul>
      <p className="jev-meta">
        Two failure modes to discuss: a confident wrong score (a real attack scored low) sails through
        every threshold, and a score near a line flips with tiny changes. Keep a deterministic
        floor - amount caps, consent, scope checks - that no model score can lower.
      </p>
    </section>
  );
}

const quoted = (items) => (items.length ? ` (${items.map((t) => `"${t}"`).join('; ')})` : '');

/** Plain-language reading of the guardrail table, built from the rows that were just scored. */
function GuardrailReadout({ rows, live }) {
  const { rules, jev } = guardrailReadout(rows);
  const line = (d) => `Missed attacks: ${d.missed.length}${quoted(d.missed)}. False alarms: ${d.falseAlarms.length}${quoted(d.falseAlarms)}.`;
  return (
    <div className="jev-readout">
      <h3 className="jev-h3">What this shows</h3>
      <ul className="jev-readout-list">
        <li><strong>Keyword rules.</strong> {line(rules)} They only look for a fixed list of phrases, so a reworded
          attack has nothing to match and passes, while a harmless sentence that happens to contain one gets blocked.</li>
        {live && (
          <li><strong>Jev.</strong> {line(jev)} It scores what the whole message means, so rewording matters less,
            but it can still be confidently wrong and it cannot tell you why.</li>
        )}
      </ul>
      <p className="jev-explain">
        The two mistakes cost different things. A missed attack reaches the tool. A false alarm only costs the
        customer an extra step. Neither decider is safe on its own: treat the score as one input to policy and keep a
        deterministic floor underneath, as in "Confidence is not permission" above.
      </p>
    </div>
  );
}

function IntentReadout({ rows, live }) {
  const { rules, jev } = intentReadout(rows);
  const wrongs = (list, withConf) => (list.length
    ? list.map((w) => `"${w.text}" as ${w.got}${withConf ? ` (${Math.round(w.conf * 100)}%)` : ''}`).join('; ')
    : 'none');
  return (
    <div className="jev-readout">
      <h3 className="jev-h3">What this shows</h3>
      <ul className="jev-readout-list">
        <li><strong>Keyword rules.</strong> Wrong picks: {wrongs(rules, false)}. They match words (send, pay, move mean a
          transfer; balance, how much mean a balance check) and file everything else under "other", so any
          message worded differently falls through.</li>
        {live && (
          <li><strong>Jev.</strong> Wrong picks: {wrongs(jev, true)}. It reads the meaning, so it handles wording the
            rules never saw, but it always picks something, even for a message that fits none of the options.</li>
        )}
      </ul>
      <p className="jev-explain">
        Confidence is how sure the model is of its pick, not how likely the pick is to be right. Use it to decide when
        to ask the customer to confirm, never as a guarantee: a 99% answer can still be wrong.
      </p>
    </div>
  );
}

function Bakeoff() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    setRows(null);
    try {
      const out = [];
      for (const item of BAKEOFF) {
        const r = await evaluate('injection', item.text);
        out.push({ ...item, rules: r.heuristic.answer.probability >= 0.5, jev: r.jev.answer.probability, mode: r.jev.mode, model: r.jev.model });
      }
      setRows(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = rows || RECORDED_GUARDRAIL_ROWS; // the recorded example until a live run lands
  const score = useMemo(() => {
    const rulesRight = shown.filter((r) => r.rules === r.bad).length;
    const jevRight = shown.filter((r) => (r.jev >= 0.5) === r.bad).length;
    const noMiddle = !shown.some((r) => r.jev > 0.35 && r.jev < 0.65);
    return { rulesRight, jevRight, total: shown.length, mode: shown[0].mode, model: shown[0].model, noMiddle };
  }, [shown]);

  return (
    <section className="jev-card" aria-labelledby="jev-bake">
      <h2 id="jev-bake" className="jev-h2">Guardrail bake-off</h2>
      <p className="jev-lead">
        Eight hand-labelled messages: four hostile, four harmless (some deliberately contain words that
        look suspicious). The score covers only these eight - it is a teaching exercise, not a benchmark
        of Jev, and it is separate from the gateway guardrail measurements. Both columns block at the
        same cutoff: a score of 0.50 or higher.
      </p>
      <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Running...' : 'Run bake-off'}</button>
      {error && <p className="jev-error" role="alert">{error}</p>}
      {(
        <>
          {score.mode === 'recorded' && <RecordedNote busy={busy} runLabel="Run bake-off" />}
          <p className="jev-explain">
            How to read it: <strong>Truth</strong> is what a person would say about the message. <strong>block</strong> and{' '}
            <strong>allow</strong> are what each decider would do with it. Green means that matches the truth (hostile
            blocked, harmless allowed); red means it got it wrong.
          </p>
          <table className="jev-table">
            <thead>
              <tr><th>Message</th><th>Truth</th><th>Rules</th><th>Jev (score)</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.text}>
                  <td>{r.text}</td>
                  <td>{r.bad ? 'hostile' : 'harmless'}</td>
                  <td className={r.rules === r.bad ? 'jev-right' : 'jev-wrong'}>{r.rules ? 'block' : 'allow'}</td>
                  <td className={(r.jev >= 0.5) === r.bad ? 'jev-right' : 'jev-wrong'}>{r.jev >= 0.5 ? 'block' : 'allow'} ({r.jev.toFixed(2)})</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jev-big">
            Rules {score.rulesRight}/{score.total} - Jev {score.jevRight}/{score.total} <ModeBadge mode={score.mode} model={score.model} />
          </p>
          <GuardrailReadout rows={shown} live={score.mode !== 'simulated'} />
          {score.mode === 'live' && score.noMiddle && (
            <p className="jev-meta">
              No message scored between 0.35 and 0.65: this model separated the eight cleanly, so the
              "unsure" middle never shows up here. Use the sliders above to see what a score near a line does.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function IntentBakeoff() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    setRows(null);
    try {
      const out = [];
      for (const item of INTENT_BAKEOFF) {
        const r = await evaluate('intent', item.text);
        out.push({
          ...item,
          rules: r.heuristic.answer.choice,
          jev: r.jev.answer.choice,
          conf: r.jev.answer.confidence ?? 0,
          mode: r.jev.mode,
          model: r.jev.model,
        });
      }
      setRows(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const shown = rows || RECORDED_INTENT_ROWS; // the recorded example until a live run lands
  const score = useMemo(() => {
    const wrong = shown.filter((r) => r.jev !== r.truth).sort((a, b) => b.conf - a.conf);
    const confs = shown.map((r) => r.conf);
    return {
      rulesRight: shown.filter((r) => r.rules === r.truth).length,
      jevRight: shown.length - wrong.length,
      total: shown.length,
      mode: shown[0].mode,
      model: shown[0].model,
      min: Math.round(Math.min(...confs) * 100),
      max: Math.round(Math.max(...confs) * 100),
      topWrong: wrong[0] || null,
    };
  }, [shown]);

  return (
    <section className="jev-card" aria-labelledby="jev-intent-bake">
      <h2 id="jev-intent-bake" className="jev-h2">Intent-routing bake-off</h2>
      <p className="jev-lead">
        Eight messages, each labelled with what the customer is actually asking for: check a balance,
        move money, or something else. Unlike yes/no, this answer is a pick plus a confidence, so
        results vary from message to message. The labels were written before either decider was run.
        Same caveat as above: eight messages is an illustration, not a benchmark.
      </p>
      <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Running...' : 'Run intent bake-off'}</button>
      {error && <p className="jev-error" role="alert">{error}</p>}
      {(
        <>
          {score.mode === 'recorded' && <RecordedNote busy={busy} runLabel="Run intent bake-off" />}
          <p className="jev-explain">
            How to read it: <strong>Truth</strong> is what the customer is actually asking for. Each decider picks one of
            three actions, and green means its pick matches the truth. For Jev the percentage is how confident it is in
            that pick.
          </p>
          <table className="jev-table">
            <thead>
              <tr><th>Message</th><th>Truth</th><th>Rules</th><th>Jev (confidence)</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.text}>
                  <td>{r.text}</td>
                  <td>{r.truth}</td>
                  <td className={r.rules === r.truth ? 'jev-right' : 'jev-wrong'}>{r.rules}</td>
                  <td className={r.jev === r.truth ? 'jev-right' : 'jev-wrong'}>{r.jev} ({Math.round(r.conf * 100)}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jev-big">
            Rules {score.rulesRight}/{score.total} - Jev {score.jevRight}/{score.total} <ModeBadge mode={score.mode} model={score.model} />
          </p>
          <IntentReadout rows={shown} live={score.mode !== 'simulated'} />
          {score.mode !== 'simulated' && (
            <p className="jev-meta">
              Jev's confidence ranged from {score.min}% to {score.max}%.
              {score.topWrong
                ? ` Its most confident miss: "${score.topWrong.text}" as ${score.topWrong.jev} at ${Math.round(score.topWrong.conf * 100)}%. Confidence is not correctness.`
                : ' It got every message right this run.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Same scenario, but the call goes through LangChain's OpenAIDecisions client
 * (beta) inside the agent container, translated onto the Von backend. The
 * heuristic baseline is computed in the BFF either way, so this panel's
 * "Keyword rules" number always matches the panel above. */
function LangChainPanel() {
  const [scenario, setScenario] = useState('injection');
  const [text, setText] = useState(SCENARIOS.injection.examples[0]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (key) => {
    setScenario(key);
    setText(SCENARIOS[key].examples[0]);
    setResult(null);
    setError('');
  };

  const run = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/demo/jev/langchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, state: text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setResult(body);
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [scenario, text]);

  return (
    <section className="jev-card" aria-labelledby="jev-lc">
      <h2 id="jev-lc" className="jev-h2">The same lesson through LangChain</h2>
      <p className="jev-lead">
        The panel above calls the decision model directly. This one sends the identical question
        through <strong>LangChain&apos;s OpenAIDecisions client</strong> (beta) running in the agent
        container, which speaks the OpenAI Decisions dialect — typed questions, typed answers, token
        counts, tracing — while a thin adapter translates onto the same Von model. Same question in,
        same probability out: the framework is plumbing, not a second opinion.
      </p>
      <div className="jev-tabs" role="tablist">
        {Object.entries(SCENARIOS).map(([key, s]) => (
          <button
            key={key}
            role="tab"
            aria-selected={scenario === key}
            className={`jev-tab${scenario === key ? ' jev-tab--on' : ''}`}
            onClick={() => pick(key)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="jev-about">{SCENARIOS[scenario].about}</p>
      <div className="jev-examples">
        {SCENARIOS[scenario].examples.map((ex) => (
          <button key={ex} className="jev-chip" onClick={() => setText(ex)}>{ex}</button>
        ))}
      </div>
      <textarea
        className="jev-input"
        aria-label="Text to judge through LangChain"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={run}>
        {busy ? 'Deciding...' : 'Decide'}
      </button>
      {busy && (
        <p className="jev-waiting">
          <InlineSpinner size="sm" label="Jev is reading the text" />
          <span className="jev-waiting-note">through LangChain in the agent container — a bit longer than the direct call</span>
        </p>
      )}
      {error && <p className="jev-error" role="alert">{error}</p>}
      {result && (
        <div className="jev-cols">
          <div className="jev-col">
            <h3 className="jev-h3">Keyword rules</h3>
            <p className="jev-big">{headline(result.heuristic.answer)}</p>
            <p className="jev-explain">
              {rulesHit(result.heuristic.answer)
                ? 'Matched a trigger phrase on its fixed list - yes (1.00), the only verdict it knows.'
                : 'Matched nothing on its trigger-word list - no (0.00), even though the model beside it read the same text and disagreed.'}
            </p>
            <p className="jev-meta">computed in the BFF, same rules as above</p>
          </div>
          <div className="jev-col">
            <h3 className="jev-h3">LangChain <ModeBadge mode={result.langchain?.mode} model={result.langchain?.model} /></h3>
            <p className="jev-big">{result.langchain ? headline(result.langchain.answer) : '—'}</p>
            {result.langchain && <p className="jev-explain">{explainJev(result.langchain.answer)}</p>}
            {result.langchain?.usage && (
              <p className="jev-meta">
                {result.langchain.usage.input_tokens} prompt · {result.langchain.usage.output_tokens} completion
              </p>
            )}
            {result.langchain && (
              <p className="jev-meta">{result.langchain.latency_ms} ms - through LangChain OpenAIDecisions</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function JevLearningPage() {
  const [risk, setRisk] = useState(0.62);
  return (
    <div className="jev-page">
      <h1 className="jev-h1">Jev: a fast decision model for agents</h1>
      <p className="jev-sub">
        Jev (TypeSafe) is a "System One" model: you send it text and a typed question in plain
        English, and it returns a choice, a score, or a yes/no probability instead of prose. Think of it as
        an if-statement that can read.
      </p>

      <section className="jev-card" aria-labelledby="jev-s1s2">
        <h2 id="jev-s1s2" className="jev-h2">System One vs System Two</h2>
        <table className="jev-table">
          <thead><tr><th /><th>System One (Jev)</th><th>System Two (generative LLM)</th></tr></thead>
          <tbody>
            {SYSTEM_COMPARE.map((r) => (
              <tr key={r.row}><th scope="row">{r.row}</th><td>{r.one}</td><td>{r.two}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="jev-meta">Speed and cost rows are TypeSafe's published claims, not measurements from this demo.</p>
      </section>

      <LivePanel onRisk={setRisk} />
      <ThresholdLesson probability={risk} setProbability={setRisk} />
      <Bakeoff />
      <IntentBakeoff />
      <LangChainPanel />
    </div>
  );
}
