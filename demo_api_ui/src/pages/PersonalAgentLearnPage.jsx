import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import AgentClientSkin from '../components/AgentClientSkin';
import OtpStepUpModal from '../components/OtpStepUpModal';
import TokenChainFilmstrip from '../components/TokenChainFilmstrip';
import PageHeader from '../components/common/PageHeader';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import { useTokenChainOptional } from '../context/TokenChainContext';
import { useThemeOptional } from '../context/ThemeContext';
import { startFlowTracedRun } from '../utils/flowTracedRun';
import { openSignIn } from '../utils/signInService';
import { governanceFrom } from '../utils/dotGovernance';
import { airlineSuggestions } from '../config/dotSuggestions';
import { GATE_COPY, LESSONS, badgeLabel, gateStatus, gateResult, explainRun, effectiveGates } from '../config/studioLearn';
import { deriveGates } from './PersonalAgentStudioPage';
import './PersonalAgentLearnPage.css';

// The page is the standalone, teaching-first view of the Personal Agent Studio: the same real agent,
// gates and token chain as /personal-agent, laid out as a learning path. Nothing here is simulated.
const SKINS = [['privilege', 'Privilege'], ['claude', 'Claude'], ['claude-terminal', 'Terminal'], ['gpt', 'ChatGPT'], ['gemini', 'Gemini']];
const INITIAL_MESSAGES = [
  { role: 'agent', text: "Hello! I'm your digital assistant. I can access your MileagePlus account and help manage your upcoming flights. Pick a step on your path, or ask me anything." },
];

export default function PersonalAgentLearnPage({ user = null }) {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [agentMode, setAgentMode] = usePageAgentMode('personal-agent', 'heuristics');
  const [skin, setSkin] = useState('privilege');
  const [learn, setLearn] = useState(true);
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [phase, setPhase] = useState('idle');
  const [errorText, setErrorText] = useState('');
  const [done, setDone] = useState(() => new Set());
  const [mfaChallenge, setMfaChallenge] = useState(null);
  // A prompt that came back 428 (consent required) and is waiting for PingOne MFA, then a retry.
  const [consentRetry, setConsentRetry] = useState(null);

  const tokenChain = useTokenChainOptional();
  const setTokenEvents = tokenChain?.setTokenEvents;
  const events = tokenChain?.events || [];
  // The sign-in gate is silent for a plain read; once the request has run and you are signed in it is a pass.
  const gates = effectiveGates(deriveGates(events), { phase, signedIn: Boolean(user) });
  const mfaVerified = events.some((e) => e.id === 'mfa' && ['success', 'valid', 'active', 'permit'].includes(e.status));
  const userLabel = user?.email || user?.username || '';
  const summary = explainRun(gates, { phase, errorText });
  const lessonFor = (text) => LESSONS.find((l) => l.prompt.toLowerCase() === String(text).trim().toLowerCase());

  // In-app MFA: a passkey registered for this app's domain works here and cannot work on PingOne's hosted page.
  const startChallenge = useCallback(async () => {
    const response = await fetch('/api/auth/mfa/challenge', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`MFA initiation failed: ${response.status}`);
    const { daId, devices } = await response.json();
    setMfaChallenge({ daId, devices: devices || [] });
  }, []);

  const send = useCallback((text, { retry = false } = {}) => {
    if (!user) { openSignIn({}); return; }
    setPhase('running');
    setErrorText('');
    if (!retry) setMessages((prev) => [...prev, { role: 'user', text }]);
    setMessages((prev) => [...prev, { role: 'agent', typing: true, text: '' }]);
    // Traced end to end: the id makes the BFF stream every step (intent, agent token, exchange, gateway, Authorize, the
    // tool, its result) to the reel, and settle() completes the trace so it does not stop at "in flight".
    const run = startFlowTracedRun(text, { setTokenEvents });
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt: text, vertical: 'airlines', agentMode, flowTraceId: run.flowTraceId }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (response.status === 428 && data.requiresConsent) throw Object.assign(new Error(data.message || 'This needs your approval.'), { consent: true });
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => {
        run.ingestResponse(data);
        setMessages((prev) => [
          ...prev.filter((m) => !m.typing),
          { role: 'agent', text: data.reply || 'The digital assistant completed the request.', governance: governanceFrom(data) },
        ]);
        // The BFF answers 200 with step_up_required when the sign-in had no MFA.
        if (data.step_up_required) { run.abandon(); setPhase('held'); return; }
        run.settle(data.success !== false, data.success === false ? data.reply : null);
        setPhase('done');
        const lesson = lessonFor(text);
        if (lesson) setDone((prev) => new Set(prev).add(lesson.id));
      })
      .catch((error) => {
        if (error.consent) {
          // Consent required: PingOne MFA is the approval. Start the challenge now; finishing it asks again as a NEW run.
          run.abandon();
          setPhase('held');
          setMessages((prev) => [...prev.filter((m) => !m.typing), { role: 'agent', text: `${error.message} Verify with PingOne MFA to continue.` }]);
          setConsentRetry({ prompt: text });
          startChallenge().catch(() => {
            setConsentRetry(null);
            setPhase('error');
            setErrorText('MFA could not be started.');
            setMessages((prev) => [...prev, { role: 'agent', text: 'MFA could not be started. Try the request again.' }]);
          });
          return;
        }
        run.settle(false, error.message || null);
        setPhase('error');
        setErrorText(error.message || '');
        setMessages((prev) => [...prev.filter((m) => !m.typing), { role: 'agent', text: error.message || 'The digital assistant could not complete the request.' }]);
      });
  }, [user, agentMode, setTokenEvents, startChallenge]);

  const finishStepUp = () => {
    setMfaChallenge(null);
    if (consentRetry) {
      const { prompt } = consentRetry;
      setConsentRetry(null);
      send(prompt, { retry: true });
    }
  };

  const running = phase === 'running';
  return (
    <div className="pal" data-theme={darkMode ? 'dark' : 'light'} data-testid="learn-page">
      <PageHeader
        title="Personal agent studio"
        summary="Run an AI assistant as a signed-in person, and watch Ping decide every step."
        actions={(
          <>
            <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} />
            <button type="button" className="pal-ghost" onClick={toggleDarkMode}>{darkMode ? 'Light mode' : 'Dark mode'}</button>
            <Link className="pal-ghost" to="/personal-agent">Classic studio</Link>
          </>
        )}
      />

      <div className="pal-wrap">
        <section className="pal-path" aria-labelledby="pal-path-h">
          <div className="pal-path-head">
            <h2 id="pal-path-h">Your path</h2>
            <span className="pal-prog" data-testid="learn-progress">{done.size} of {LESSONS.length} complete</span>
            <div className="pal-bar" aria-hidden="true"><i style={{ width: `${(done.size / LESSONS.length) * 100}%` }} /></div>
            <label className="pal-learn-toggle">
              Learn mode
              <button type="button" role="switch" aria-checked={learn} aria-label="Learn mode" className="pal-sw" onClick={() => setLearn((v) => !v)} />
            </label>
          </div>
          {!user && (
            <p className="pal-signin" role="status">
              You are not signed in. <button type="button" className="pal-link" onClick={() => openSignIn({})}>Sign in</button> to run the agent.
            </p>
          )}
          <div className="pal-steps">
            {LESSONS.map((lesson, i) => (
              <button key={lesson.id} type="button" className={`pal-lesson${done.has(lesson.id) ? ' is-done' : ''}`} disabled={running} onClick={() => send(lesson.prompt)}>
                <span className="pal-n" aria-hidden="true">{done.has(lesson.id) ? '✓' : i + 1}</span>
                <span className="pal-go">{done.has(lesson.id) ? 'Done · run again' : 'Run →'}</span>
                <h3>{lesson.title}</h3>
                <p>{lesson.learn}</p>
                <span className="pal-prompt">{lesson.prompt}</span>
              </button>
            ))}
          </div>
        </section>

        <main className={`pal-grid${learn ? ' is-learn' : ''}`}>
          <section className="pal-card pal-agent" aria-label="Agent client">
            <div className="pal-card-h">
              <h2>The agent</h2><span className="pal-sub">What the user sees in their own AI app</span>
              <div className="pal-pills" role="group" aria-label="Client look">
                {SKINS.map(([id, label]) => (
                  <button key={id} type="button" className="pal-pill" aria-pressed={skin === id} onClick={() => setSkin(id)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="pal-client">
              <AgentClientSkin skin={skin} theme={darkMode ? 'dark' : 'light'} messages={messages} onSend={send} suggestions={airlineSuggestions(skin)} showPopOutButton={false} />
            </div>
          </section>

          <aside className="pal-card pal-rail" aria-label="What just happened">
            <div className="pal-card-h"><h2>What just happened</h2><span className="pal-sub">Plain English, in order</span></div>
            <p className={`pal-says pal-says--${summary?.tone || 'empty'}`} data-testid="learn-summary" aria-live="polite">
              {summary ? summary.text : 'Run a step on your path. This panel explains each decision as it happens, so you learn why, not just what.'}
            </p>
            <ol className="pal-gates">
              {GATE_COPY.map((copy, i) => {
                const gate = gates.find((g) => g.id === copy.id) || { id: copy.id, status: 'waiting' };
                const s = gateStatus(gate, phase);
                return (
                  <li key={copy.id} className="pal-gate" data-s={s} data-testid={`gate-${copy.id}`}>
                    <span className="pal-ic" aria-hidden="true">{s === 'permit' ? '✓' : s === 'deny' ? '✕' : s === 'held' ? '!' : i + 1}</span>
                    <div>
                      <h3>{copy.title} <span className={`pal-badge pal-badge--${s}`}>{badgeLabel(s)}</span></h3>
                      <p className="pal-q">{copy.question}</p>
                      <p className="pal-res">{gateResult(gate, phase, { userLabel, mfaVerified })}</p>
                      <p className="pal-why">Why it matters: {copy.why}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="pal-rail-foot">These are the same three gates as the security rail on the classic studio, read from the live token events.</p>
          </aside>
        </main>

        <section className="pal-card" aria-labelledby="pal-reel-h">
          <div className="pal-card-h"><h2 id="pal-reel-h">Movie reel and token chain</h2><span className="pal-sub">The request hop by hop, with every token under it</span></div>
          <p className="pal-intro">Each hop trades one token for a narrower one. Click a step in the reel to read the token behind it. The <code>act</code> claim is what proves a person delegated this to an agent.</p>
          <div className="tcfs-float-host tcfs-float-host--stacked pal-reel"><TokenChainFilmstrip /></div>
        </section>

        <section className="pal-card" aria-label="Who owns what">
          <div className="pal-card-h"><h2>Who owns what</h2><span className="pal-sub">The client boundary, in one glance</span></div>
          <div className="pal-own">
            <div><h3><span className="pal-chip pal-chip--client">Client</span> The conversation</h3><p>Chat window, skin, history. Swap Claude for ChatGPT and nothing about security changes.</p></div>
            <div><h3><span className="pal-chip pal-chip--ping">Ping</span> Identity, consent, policy</h3><p>Who the user is, what they approved, and whether this exact call is allowed. Checked every time.</p></div>
            <div><h3><span className="pal-chip pal-chip--tools">Tools</span> The protected data</h3><p>Airline, banking and other APIs. They only ever see a short-lived token that names the user and the agent.</p></div>
          </div>
          <nav className="pal-deeper" aria-label="Go deeper">
            <strong>Go deeper:</strong>
            <Link to="/personal-agent?tab=obo">Delegation proof (OBO)</Link>
            <Link to="/personal-agent-design">Design: Agent Gateway</Link>
            <Link to="/personal-agent-review">Design review</Link>
            <Link to="/personal-agent/dot/full">Persona agent (Dot)</Link>
          </nav>
        </section>
      </div>

      <OtpStepUpModal
        show={Boolean(mfaChallenge)}
        mode="p1mfa"
        allowFido
        contextLine={consentRetry?.prompt || ''}
        daId={mfaChallenge?.daId}
        devices={mfaChallenge?.devices}
        onP1MfaComplete={finishStepUp}
        onPasskeyRegistered={startChallenge}
        onSubmit={() => {}}
        onCancel={() => { setMfaChallenge(null); setConsentRetry(null); setPhase('idle'); }}
      />
    </div>
  );
}
