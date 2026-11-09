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
import PingIdentitySpinner from '../components/shared/PingIdentitySpinner';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
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
 *
 * Layout follows the Ping UI Standard through the shared primitives (components/pingUi,
 * docs/ping-ui-primitives.md): P2 banner first, P3 frame + sections, P4 cards, P5 kv, P7 chips, P9 buttons.
 *
 * P9 "one primary per view": this is one lesson read top to bottom, and its main action is "Decide" on the
 * first live panel (the same text through both deciders). That is the only primary. The two bake-off runs and the
 * LangChain "Decide" repeat the idea at larger scale or through another client, so they are secondaries; the
 * scenario tabs and example buttons are secondaries too (the chosen one shows aria-selected / aria-pressed).
 * Every control that can be busy or empty uses aria-disabled, not disabled, so keyboard focus stays on it, and the
 * reason is on screen (the status line, or the note under the text box). A run's progress is announced by a status
 * region that is mounted before the run starts, so the words are read when they change.
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

// The page component comes first in the file on purpose: scripts/check-ui-patterns.mjs reads the source in order and
// requires the banner before any section, card or button. The helpers below are hoisted function declarations.
export default function JevLearningPage() {
  const [risk, setRisk] = useState(0.62);
  return (
    <PingPage className="jevl-page">
      <SimBanner data-testid="jevl-banner">
        <strong>WHAT IS REAL ON THIS PAGE</strong> — the keyword rules always run, on the server. Jev answers live only
        when the server has a decision model configured, and every Jev result says which it was:{' '}
        <strong>Live</strong> (the model answered this call), <strong>Simulated</strong> (no model configured, so that
        column repeats the keyword rules) or <strong>Recorded</strong> (a saved run of {RECORDED_RUN.model} from{' '}
        {RECORDED_RUN.date}, shown in both bake-offs until you run them). Speed and cost figures are TypeSafe&apos;s
        published claims, not measurements from this demo.
      </SimBanner>
      <PageHeader
        eyebrow="Learning"
        title="Jev: a fast decision model for agents"
        summary={'Jev (TypeSafe) is a "System One" model: you send it text and a typed question in plain English, and it returns a choice, a score, or a yes/no probability instead of prose. Think of it as an if-statement that can read.'}
      />
      <PageFrame>
        <Section id="jev-s1s2" kicker="1 · The idea" title="System One vs System Two">
          <Card tone="neutral" data-testid="jevl-compare">
            <table className="jevl-table">
              <thead>
                <tr><th scope="col"><span className="jevl-sr">Aspect</span></th><th scope="col">System One (Jev)</th><th scope="col">System Two (generative LLM)</th></tr>
              </thead>
              <tbody>
                {SYSTEM_COMPARE.map((r) => (
                  <tr key={r.row}>
                    <th scope="row">{r.row}</th>
                    <td data-label="System One (Jev)">{r.one}</td>
                    <td data-label="System Two (generative LLM)">{r.two}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="pu-note">Speed and cost rows are TypeSafe's published claims, not measurements from this demo.</p>
          </Card>
        </Section>

        <LivePanel onRisk={setRisk} />
        <ThresholdLesson probability={risk} setProbability={setRisk} />
        <Bakeoff />
        <IntentBakeoff />
        <LangChainPanel />
      </PageFrame>
    </PingPage>
  );
}

const MODE_CHIP = {
  live: { tone: 'info', card: 'live' },
  recorded: { tone: 'neutral', card: 'neutral' },
  simulated: { tone: 'warn', card: 'warn' },
};
const modeKind = (mode) => (MODE_CHIP[mode] ? mode : 'simulated');

/** The word on the chip comes from the mode the server reported, never a fixed claim. */
function ModeBadge({ mode, model }) {
  const kind = modeKind(mode);
  let word = 'Simulated - not configured';
  if (kind === 'recorded') word = `Recorded: ${model}, ${RECORDED_RUN.date}`;
  else if (kind === 'live') word = `Live: ${model}`;
  return <StatusChip tone={MODE_CHIP[kind].tone}>{word}</StatusChip>;
}

// The recorded run, shaped like live rows, shown until (and unless) a live run replaces it.
const RECORDED_GUARDRAIL_ROWS = RECORDED_RUN.guardrail.map((r) => ({ ...r, mode: 'recorded', model: RECORDED_RUN.model }));
const RECORDED_INTENT_ROWS = RECORDED_RUN.intent.map((r) => ({ ...r, mode: 'recorded', model: RECORDED_RUN.model }));

/** Says plainly that the rows on screen are a saved example, not a live answer. */
function RecordedNote({ busy, runLabel }) {
  return (
    <p className="pu-note jevl-recorded">
      {busy
        ? `Running live now. Until the results arrive, this is the recorded example from ${RECORDED_RUN.model} (${RECORDED_RUN.date}).`
        : `This is an example run recorded from ${RECORDED_RUN.model} on ${RECORDED_RUN.date}, shown so you can see what to expect. Click "${runLabel}" to run it live.`}
    </p>
  );
}

/**
 * Progress of one run, in a region that is on the page before the run starts (a live region that appears together
 * with its text is often not read). Idle it is empty; busy / failed / finished each say so with a word, never colour alone.
 */
function RunStatus({ busy, error, done, busyText, doneText, testId }) {
  let line = null;
  if (busy) line = { tone: 'info', word: 'Running', text: busyText };
  else if (error) line = { tone: 'danger', word: 'Failed', text: 'The run did not finish. The reason is below.' };
  else if (done) line = { tone: 'neutral', word: 'Finished', text: doneText };
  return (
    <div role="status" aria-live="polite" className="jevl-status" data-testid={testId}>
      {line && (
        <p className="pu-status-line">
          {busy && <PingIdentitySpinner size={20} aria-hidden="true" className="ping-spinner--inline" />}
          <StatusChip tone={line.tone}>{line.word}</StatusChip>
          {line.text}
        </p>
      )}
    </div>
  );
}

function ScenarioPicker({ scenario, onPick, label }) {
  return (
    <div className="jevl-choices" role="tablist" aria-label={label}>
      {Object.entries(SCENARIOS).map(([key, s]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={scenario === key}
          className="pu-btn"
          onClick={() => onPick(key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

function ExamplePicker({ scenario, text, onPick, label }) {
  return (
    <div className="jevl-choices" role="group" aria-label={label}>
      {SCENARIOS[scenario].examples.map((ex) => (
        <button key={ex} type="button" aria-pressed={text === ex} className="pu-btn jevl-example" onClick={() => onPick(ex)}>
          {ex}
        </button>
      ))}
    </div>
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

  const empty = !text.trim();
  const run = useCallback(async () => {
    if (busy || empty) return; // aria-disabled keeps focus on the button; the click is ignored
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
  }, [scenario, text, onRisk, busy, empty]);

  const jevKind = result ? modeKind(result.jev.mode) : null;

  return (
    <Section id="jev-live" kicker="2 · Try it" title="Same input, two deciders" lede={SCENARIOS[scenario].question}>
      <Card data-testid="jevl-live-input">
        <p className="jevl-step"><span className="jevl-step-n">1</span> Choose a scenario</p>
        <ScenarioPicker scenario={scenario} onPick={pick} label="Scenario" />
        <p className="pu-note">{SCENARIOS[scenario].about}</p>
        <p className="jevl-step"><span className="jevl-step-n">2</span> Click an example to load it, or type your own below</p>
        <ExamplePicker scenario={scenario} text={text} onPick={setText} label="Examples" />
        <p className="jevl-step"><span className="jevl-step-n">3</span> Edit the text if you like, then press Decide to run both deciders on it</p>
        <textarea
          className="jevl-input"
          aria-label="Text to judge"
          aria-describedby={empty ? 'jevl-live-reason' : undefined}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
        {empty && <p id="jevl-live-reason" className="pu-note">Type or pick some text first: Decide needs something to judge.</p>}
        <div className="pu-actions">
          <button
            type="button"
            className="pu-btn pu-btn--primary"
            aria-disabled={busy || empty ? 'true' : undefined}
            onClick={run}
            data-testid="jevl-live-decide"
          >
            Decide
          </button>
        </div>
        <RunStatus
          busy={busy}
          error={error}
          done={Boolean(result)}
          busyText="Jev is reading the text. This is a decision model, not a chat: it takes a second, longer the first time while the local model loads."
          doneText={jevKind === 'live'
            ? 'Both deciders answered. Compare the two cards below.'
            : 'The Jev card repeats the keyword rules: no model is configured, so treat it as the baseline again.'}
          testId="jevl-live-status"
        />
        {error && <p className="pu-note jevl-error" role="alert">{error}</p>}
      </Card>
      {result && (
        <CardGrid>
          <Card tone="neutral" title="Keyword rules" data-testid="jevl-live-rules">
            <p className="jevl-big">{headline(result.heuristic.answer)}</p>
            {rulesHit(result.heuristic.answer) ? (
              <p className="pu-note">
                Matched a trigger phrase on its fixed list, so it says yes (1.00) - and that is all it
                can ever say. It never reads meaning and never says "maybe", so a reworded attack that
                uses no listed phrase slips straight through.
              </p>
            ) : (
              <p className="pu-note">
                Matched nothing on its trigger-word list, so it says no (0.00) - but that only means the
                exact phrases it knows are absent. "Please kindly forget everything you were told" is an
                attack with no trigger phrase, which is exactly what it just missed.
              </p>
            )}
            <KvList items={[
              { label: 'Latency', value: `${result.heuristic.latencyMs} ms` },
              { label: 'Answers', value: 'always 0 or 1, never unsure' },
            ]}
            />
          </Card>
          <Card
            tone={MODE_CHIP[jevKind].card}
            title={<>Jev <ModeBadge mode={result.jev.mode} model={result.jev.model} /></>}
            data-testid="jevl-live-jev"
          >
            <p className="jevl-big">{headline(result.jev.answer)}</p>
            {result.jev.mode === 'live' && <p className="pu-note">{explainJev(result.jev.answer)}</p>}
            {result.jev.mode === 'live' && result.jev.answer.type !== 'choice' && (
              <p className="pu-note">{SCENARIOS[scenario].howUsed}</p>
            )}
            <KvList items={[
              { label: 'Latency', value: `${result.jev.latencyMs} ms` },
              { label: 'Model', value: String(result.jev.model), mono: true },
            ]}
            />
            {result.jev.mode === 'live' && (
              <p className="pu-note">Deterministic: the same text always scores the same - rerun it to check. Different wording moves the score less than you'd expect, because it scores classes of text, not vibes.</p>
            )}
            {result.jev.mode === 'simulated' && (
              <p className="pu-note">
                No OPENROUTER_API_KEY or JEV_ENDPOINT on the server, so this column is the same keyword rules. It says nothing about Jev.
              </p>
            )}
          </Card>
        </CardGrid>
      )}
    </Section>
  );
}

function ThresholdLesson({ probability, setProbability }) {
  const [stepUpAt, setStepUpAt] = useState(0.4);
  const [denyAt, setDenyAt] = useState(0.9);
  const outcome = decide(probability, stepUpAt, denyAt);
  return (
    <Section
      id="jev-thresh"
      kicker="3 · Policy"
      title="Confidence is not permission"
      lede="Jev answers 'how likely is this risky?'. Whether that means allow, step up or deny is a policy decision. In this demo that belongs to PingOne Authorize and the gateway - the model score is one attribute they can read, not the verdict. Drag the lines to see the same score flip outcome. Run the Step-up risk example above to load a real score."
    >
      <Card data-testid="jevl-thresholds">
        <label className="jevl-slider">
          Jev P(yes risky): <strong>{probability.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.01" value={probability}
            onChange={(e) => setProbability(Number(e.target.value))} />
        </label>
        <label className="jevl-slider">
          Step-up at: <strong>{stepUpAt.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.01" value={stepUpAt}
            onChange={(e) => setStepUpAt(Math.min(Number(e.target.value), denyAt))} />
        </label>
        <label className="jevl-slider">
          Deny at: <strong>{denyAt.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.01" value={denyAt}
            onChange={(e) => setDenyAt(Math.max(Number(e.target.value), stepUpAt))} />
        </label>
        <ul className="jevl-outcomes">
          {POLICY_RULES.map((r) => (
            <li
              key={r.id}
              className={`jevl-outcome${outcome === r.id ? ' jevl-outcome--on' : ''}`}
              aria-current={outcome === r.id ? 'true' : undefined}
            >
              <span>
                <strong>{r.label}</strong> - {r.detail}
              </span>
              {outcome === r.id && <StatusChip tone="info">Current outcome</StatusChip>}
            </li>
          ))}
        </ul>
        <p className="pu-note">
          Two failure modes to discuss: a confident wrong score (a real attack scored low) sails through
          every threshold, and a score near a line flips with tiny changes. Keep a deterministic
          floor - amount caps, consent, scope checks - that no model score can lower.
        </p>
      </Card>
    </Section>
  );
}

const quoted = (items) => (items.length ? ` (${items.map((t) => `"${t}"`).join('; ')})` : '');

/** Plain-language reading of the guardrail table, built from the rows that were just scored. */
function GuardrailReadout({ rows, live }) {
  const { rules, jev } = guardrailReadout(rows);
  const line = (d) => `Missed attacks: ${d.missed.length}${quoted(d.missed)}. False alarms: ${d.falseAlarms.length}${quoted(d.falseAlarms)}.`;
  return (
    <Card tone="neutral" title="What this shows">
      <ul className="jevl-readout-list">
        <li><strong>Keyword rules.</strong> {line(rules)} They only look for a fixed list of phrases, so a reworded
          attack has nothing to match and passes, while a harmless sentence that happens to contain one gets blocked.</li>
        {live && (
          <li><strong>Jev.</strong> {line(jev)} It scores what the whole message means, so rewording matters less,
            but it can still be confidently wrong and it cannot tell you why.</li>
        )}
      </ul>
      <p className="pu-note">
        The two mistakes cost different things. A missed attack reaches the tool. A false alarm only costs the
        customer an extra step. Neither decider is safe on its own: treat the score as one input to policy and keep a
        deterministic floor underneath, as in "Confidence is not permission" above.
      </p>
    </Card>
  );
}

function IntentReadout({ rows, live }) {
  const { rules, jev } = intentReadout(rows);
  const wrongs = (list, withConf) => (list.length
    ? list.map((w) => `"${w.text}" as ${w.got}${withConf ? ` (${Math.round(w.conf * 100)}%)` : ''}`).join('; ')
    : 'none');
  return (
    <Card tone="neutral" title="What this shows">
      <ul className="jevl-readout-list">
        <li><strong>Keyword rules.</strong> Wrong picks: {wrongs(rules, false)}. They match words (send, pay, move mean a
          transfer; balance, how much mean a balance check) and file everything else under "other", so any
          message worded differently falls through.</li>
        {live && (
          <li><strong>Jev.</strong> Wrong picks: {wrongs(jev, true)}. It reads the meaning, so it handles wording the
            rules never saw, but it always picks something, even for a message that fits none of the options.</li>
        )}
      </ul>
      <p className="pu-note">
        Confidence is how sure the model is of its pick, not how likely the pick is to be right. Use it to decide when
        to ask the customer to confirm, never as a guarantee: a 99% answer can still be wrong.
      </p>
    </Card>
  );
}

/** A verdict cell: the colour is backed by a mark (page CSS) and a hidden word, so it is never colour alone. */
function Verdict({ label, right, children }) {
  return (
    <td data-label={label} className={right ? 'jevl-right' : 'jevl-wrong'}>
      <span className="jevl-mark" aria-hidden="true">{right ? '\u2713' : '\u2715'}</span>
      <span className="jevl-sr">{right ? 'Right: ' : 'Wrong: '}</span>
      {children}
    </td>
  );
}

function Bakeoff() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (busy) return; // aria-disabled keeps focus on the button; the click is ignored
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
    <Section
      id="jev-bake"
      kicker="4 · Bake-off"
      title="Guardrail bake-off"
      lede="Eight hand-labelled messages: four hostile, four harmless (some deliberately contain words that look suspicious). The score covers only these eight - it is a teaching exercise, not a benchmark of Jev, and it is separate from the gateway guardrail measurements. Both columns block at the same cutoff: a score of 0.50 or higher."
    >
      <Card data-testid="jevl-bake">
        <div className="pu-actions">
          <button type="button" className="pu-btn" aria-disabled={busy ? 'true' : undefined} onClick={run}>Run bake-off</button>
        </div>
        <RunStatus
          busy={busy}
          error={error}
          done={rows !== null}
          busyText={`Running the ${BAKEOFF.length} messages through both deciders, one at a time.`}
          doneText={score.mode === 'live'
            ? 'This table is the live run.'
            : 'No model is configured, so the Jev column repeats the keyword rules.'}
          testId="jevl-bake-status"
        />
        {error && <p className="pu-note jevl-error" role="alert">{error}</p>}
        {score.mode === 'recorded' && <RecordedNote busy={busy} runLabel="Run bake-off" />}
        <p className="pu-note">
          How to read it: <strong>Truth</strong> is what a person would say about the message. <strong>block</strong> and{' '}
          <strong>allow</strong> are what each decider would do with it. Green means that matches the truth (hostile
          blocked, harmless allowed); red means it got it wrong.
        </p>
        <table className="jevl-table">
          <thead>
            <tr><th scope="col">Message</th><th scope="col">Truth</th><th scope="col">Rules</th><th scope="col">Jev (score)</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.text}>
                <td data-label="Message">{r.text}</td>
                <td data-label="Truth">{r.bad ? 'hostile' : 'harmless'}</td>
                <Verdict label="Rules" right={r.rules === r.bad}>{r.rules ? 'block' : 'allow'}</Verdict>
                <Verdict label="Jev (score)" right={(r.jev >= 0.5) === r.bad}>{r.jev >= 0.5 ? 'block' : 'allow'} ({r.jev.toFixed(2)})</Verdict>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="jevl-big">
          Rules {score.rulesRight}/{score.total} - Jev {score.jevRight}/{score.total} <ModeBadge mode={score.mode} model={score.model} />
        </p>
        {score.mode === 'live' && score.noMiddle && (
          <p className="pu-note">
            No message scored between 0.35 and 0.65: this model separated the eight cleanly, so the
            "unsure" middle never shows up here. Use the sliders above to see what a score near a line does.
          </p>
        )}
      </Card>
      <GuardrailReadout rows={shown} live={score.mode !== 'simulated'} />
    </Section>
  );
}

function IntentBakeoff() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (busy) return; // aria-disabled keeps focus on the button; the click is ignored
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
    <Section
      id="jev-intent-bake"
      kicker="5 · Routing"
      title="Intent-routing bake-off"
      lede="Eight messages, each labelled with what the customer is actually asking for: check a balance, move money, or something else. Unlike yes/no, this answer is a pick plus a confidence, so results vary from message to message. The labels were written before either decider was run. Same caveat as above: eight messages is an illustration, not a benchmark."
    >
      <Card data-testid="jevl-intent-bake">
        <div className="pu-actions">
          <button type="button" className="pu-btn" aria-disabled={busy ? 'true' : undefined} onClick={run}>Run intent bake-off</button>
        </div>
        <RunStatus
          busy={busy}
          error={error}
          done={rows !== null}
          busyText={`Running the ${INTENT_BAKEOFF.length} messages through both deciders, one at a time.`}
          doneText={score.mode === 'live'
            ? 'This table is the live run.'
            : 'No model is configured, so the Jev column repeats the keyword rules.'}
          testId="jevl-intent-status"
        />
        {error && <p className="pu-note jevl-error" role="alert">{error}</p>}
        {score.mode === 'recorded' && <RecordedNote busy={busy} runLabel="Run intent bake-off" />}
        <p className="pu-note">
          How to read it: <strong>Truth</strong> is what the customer is actually asking for. Each decider picks one of
          three actions, and green means its pick matches the truth. For Jev the percentage is how confident it is in
          that pick. Watch "Hi there": Jev calls it transfer_money with 99% confidence - a wrong pick, made loudly.
          That is not a glitch in this page; it is System One's declared failure mode (see the table up top): a
          confident wrong label. A real router treats a pick like this as one candidate, not an instruction - which is
          what the "ask a clarifying question instead of guessing" line below is for.
        </p>
        <table className="jevl-table">
          <thead>
            <tr><th scope="col">Message</th><th scope="col">Truth</th><th scope="col">Rules</th><th scope="col">Jev (confidence)</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.text}>
                <td data-label="Message">{r.text}</td>
                <td data-label="Truth">{r.truth}</td>
                <Verdict label="Rules" right={r.rules === r.truth}>{r.rules}</Verdict>
                <Verdict label="Jev (confidence)" right={r.jev === r.truth}>{r.jev} ({Math.round(r.conf * 100)}%)</Verdict>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="jevl-big">
          Rules {score.rulesRight}/{score.total} - Jev {score.jevRight}/{score.total} <ModeBadge mode={score.mode} model={score.model} />
        </p>
        {score.mode !== 'simulated' && (
          <p className="pu-note">
            Jev's confidence ranged from {score.min}% to {score.max}%.
            {score.topWrong
              ? ` Its most confident miss: "${score.topWrong.text}" as ${score.topWrong.jev} at ${Math.round(score.topWrong.conf * 100)}%. Confidence is not correctness.`
              : ' It got every message right this run.'}
          </p>
        )}
      </Card>
      <IntentReadout rows={shown} live={score.mode !== 'simulated'} />
    </Section>
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

  const empty = !text.trim();
  const run = useCallback(async () => {
    if (busy || empty) return; // aria-disabled keeps focus on the button; the click is ignored
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
  }, [scenario, text, busy, empty]);

  const lcKind = modeKind(result?.langchain?.mode);

  return (
    <Section
      id="jev-lc"
      kicker="6 · Framework"
      title="The same lesson through LangChain"
      lede={<>
        The panel above calls the decision model directly. This one sends the identical question
        through <strong>LangChain&apos;s OpenAIDecisions client</strong> (beta) running in the agent
        container, which speaks the OpenAI Decisions dialect — typed questions, typed answers, token
        counts, tracing — while a thin adapter translates onto the same Von model. Same question in,
        same probability out: the framework is plumbing, not a second opinion.
      </>}
    >
      <Card data-testid="jevl-lc-input">
        <ScenarioPicker scenario={scenario} onPick={pick} label="Scenario for the LangChain run" />
        <p className="pu-note">{SCENARIOS[scenario].about}</p>
        <ExamplePicker scenario={scenario} text={text} onPick={setText} label="Examples for the LangChain run" />
        <textarea
          className="jevl-input"
          aria-label="Text to judge through LangChain"
          aria-describedby={empty ? 'jevl-lc-reason' : undefined}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
        />
        {empty && <p id="jevl-lc-reason" className="pu-note">Type or pick some text first: Decide needs something to judge.</p>}
        <div className="pu-actions">
          <button
            type="button"
            className="pu-btn"
            aria-disabled={busy || empty ? 'true' : undefined}
            onClick={run}
            data-testid="jevl-lc-decide"
          >
            Decide
          </button>
        </div>
        <RunStatus
          busy={busy}
          error={error}
          done={Boolean(result)}
          busyText="Jev is reading the text, through LangChain in the agent container: a bit longer than the direct call."
          doneText={result?.langchain ? 'Both answers are in. Compare the two cards below.' : 'The call returned no LangChain answer, so only the keyword rules are shown.'}
          testId="jevl-lc-status"
        />
        {error && <p className="pu-note jevl-error" role="alert">{error}</p>}
      </Card>
      {result && (
        <CardGrid>
          <Card tone="neutral" title="Keyword rules" data-testid="jevl-lc-rules">
            <p className="jevl-big">{headline(result.heuristic.answer)}</p>
            <p className="pu-note">
              {rulesHit(result.heuristic.answer)
                ? 'Matched a trigger phrase on its fixed list - yes (1.00), the only verdict it knows.'
                : 'Matched nothing on its trigger-word list - no (0.00), even though the model beside it read the same text and disagreed.'}
            </p>
            <KvList items={[{ label: 'Computed', value: 'in the BFF, same rules as above' }]} />
          </Card>
          <Card
            tone={result.langchain ? MODE_CHIP[lcKind].card : 'neutral'}
            title={<>LangChain <ModeBadge mode={result.langchain?.mode} model={result.langchain?.model} /></>}
            data-testid="jevl-lc-jev"
          >
            <p className="jevl-big">{result.langchain ? headline(result.langchain.answer) : '—'}</p>
            {result.langchain && <p className="pu-note">{explainJev(result.langchain.answer)}</p>}
            {result.langchain && (
              <KvList items={[
                { label: 'Latency', value: `${result.langchain.latency_ms} ms` },
                { label: 'Path', value: 'LangChain OpenAIDecisions' },
                ...(result.langchain.usage
                  ? [{ label: 'Tokens', value: `${result.langchain.usage.input_tokens} prompt · ${result.langchain.usage.output_tokens} completion` }]
                  : []),
              ]}
              />
            )}
          </Card>
        </CardGrid>
      )}
    </Section>
  );
}
