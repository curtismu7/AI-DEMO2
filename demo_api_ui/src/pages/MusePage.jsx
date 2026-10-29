import { useCallback, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import PageHeader from "../components/common/PageHeader";
import "./MusePage.css";

// Real "Muse" personal agent: Muse asks the gateway with no token (401), PingOne signs the user in, then Muse acts
// for the user (RFC 8693 delegation) and retries. Tokens stay on the BFF; this page only sees claims and steps.
const POINTS_PROMPT = "Show my airline points";
const AUTO_KEY = "muse.autoPingOne";
const MFA_KEY = "muse.p1mfa";
const LANE_KEY = "muse.lane";
const read = (k, dflt) => { try { const v = window.localStorage.getItem(k); return v === null ? dflt : v; } catch { return dflt; } };
const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const pretty = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
const errText = (e) => e?.response?.data?.error || e?.message || "Something went wrong.";

export default function MusePage() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [auto, setAuto] = useState(() => read(AUTO_KEY, "0") === "1");
  const [mfa, setMfa] = useState(() => read(MFA_KEY, "1") !== "0");
  const [lane, setLane] = useState(() => (read(LANE_KEY, "gateway") === "privilege" ? "privilege" : "gateway"));
  const [assistant, setAssistant] = useState(null);

  const refresh = useCallback(async () => {
    try { setState((await apiClient.get("/api/muse/state")).data); setLoadError(null); } catch (e) { setLoadError(errText(e)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const guarded = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const signIn = () => guarded(async () => {
    await apiClient.post("/api/muse/register");
    const r = await apiClient.post("/api/muse/signin", { mfa: mfa ? "on" : "off" });
    window.location.assign(r.data.url);
  });
  const ask = (text) => guarded(async () => {
    const r = await apiClient.post("/api/muse/ask", { prompt: text, lane });
    await refresh(); setOpen(null);
    if (r.data?.state === "auth_required" && auto) setTimeout(() => signIn(), 1500);
  });
  const userSignIn = () => guarded(async () => {
    const r = await apiClient.post("/api/muse/user-signin", { lane, mfa: mfa ? "on" : "off" });
    window.location.assign(r.data.url);
  });
  const assistantSignIn = (key) => guarded(async () => {
    const r = await apiClient.post("/api/muse/assistant-signin", { lane, assistant: key, mfa: mfa ? "on" : "off" });
    window.location.assign(r.data.url);
  });
  const reset = () => guarded(async () => { await apiClient.post("/api/muse/reset"); await refresh(); setOpen(null); });

  if (!state) return <main className="muse"><PageHeader eyebrow="Personal Agents" title="Muse" />{loadError ? <p role="alert" className="muse__bad">{loadError}</p> : <p className="muse__muted">Loading…</p>}</main>;

  const la = state.liveAuth;
  // The tab shown: the one picked, else the one just connected, else the first.
  const assistants = state.assistants ?? [];
  const pickedAssistant = assistants.find((x) => x.key === (assistant ?? state.assistant?.key)) ?? assistants[0] ?? { key: null, name: "" };
  const toggleAuto = (on) => { setAuto(on); write(AUTO_KEY, on ? "1" : "0"); };
  const toggleMfa = (on) => { setMfa(on); write(MFA_KEY, on ? "1" : "0"); };
  const pickLane = (l) => { setLane(l); write(LANE_KEY, l); };

  return (
    <main className="muse" data-testid="muse-page">
      <PageHeader eyebrow="Personal Agents" title="Muse" summary="A personal agent that asks first, gets a 401, sends you to PingOne to sign in, then acts on your behalf." />
      <p className="muse__muted"><a href="/how-muse-works.html">How it works</a></p>
      {!state.configured ? (
        <p role="alert" className="muse__notice" data-testid="muse-not-configured">
          Muse is not configured. Set <code>pingone_muse_client_secret</code> (env <code>PINGONE_MUSE_CLIENT_SECRET</code>) on the BFF, then reload.
        </p>
      ) : (
        <section className="muse__chat" aria-label="Muse">
          <div className="muse__lanes seg" role="group" aria-label="Gateway lane">
            <button type="button" aria-pressed={lane === "gateway"} onClick={() => pickLane("gateway")} disabled={busy}>Agent Gateway</button>
            <button type="button" aria-pressed={lane === "privilege"} onClick={() => pickLane("privilege")} disabled={busy}>Agent Privilege, then Agent Gateway</button>
          </div>
          {lane === "privilege" && <p className="muse__muted">Goes through the Agent Privilege app in front of the gateway. It needs <code>MUSE_PRIVILEGE_URL</code> on the BFF.</p>}
          <div className="muse__feed" role="log" aria-live="polite">
            {!la.ask && <p className="muse__muted muse__center">Ask Muse for something, for example: {POINTS_PROMPT.toLowerCase()}.</p>}
            {la.ask && <div className="muse__bubble muse__bubble--user">{la.ask.prompt}</div>}
            {la.ask && la.steps.length > 0 && (
              <div className="muse__msg">
                <span className="muse__avatar" aria-hidden="true">M</span>
                <div className="muse__bubble muse__bubble--muse">
                  <span>I called the gateway without a token and it answered <strong>401</strong>. {la.signedIn ? "You signed in, so I asked again with a token for you." : auto ? "Taking you to PingOne to sign in…" : "I need you to sign in at PingOne first."}</span>
                  {!la.signedIn && !auto && <button type="button" className="muse__primary" onClick={signIn} disabled={busy}>Continue to PingOne</button>}
                </div>
              </div>
            )}
            {la.answer && (
              <div className="muse__msg">
                <span className="muse__avatar" aria-hidden="true">M</span>
                <div className="muse__bubble muse__bubble--muse" data-testid="answer">You have <strong>{Number(la.answer.points).toLocaleString()} points</strong> ({la.answer.tier}).</div>
              </div>
            )}
          </div>
          <form className="muse__composer" onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) { ask(prompt.trim()); setPrompt(""); } }}>
            <label className="muse__sr" htmlFor="muse-ask-input">Ask Muse</label>
            <input id="muse-ask-input" type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='Ask Muse, e.g. "show my airline points"' autoComplete="off" disabled={busy} />
            <button type="submit" className="muse__primary" disabled={busy || !prompt.trim()}>Send</button>
          </form>
          <div className="muse__prompts" role="group" aria-label="Prompts">
            <button type="button" className="muse__chip" onClick={() => ask(POINTS_PROMPT)} disabled={busy}>{POINTS_PROMPT}</button>
            <button type="button" className="muse__chip" onClick={reset} disabled={busy} title="Clear this session and start again">Reset</button>
            <label className="muse__toggle" title="On: PingOne asks for MFA when the risk is medium. Off: MFA is skipped for this sign-in.">
              <input type="checkbox" role="switch" checked={mfa} onChange={(e) => toggleMfa(e.target.checked)} /><span>PingOne MFA</span>
            </label>
            <label className="muse__toggle" title="On: no button. Muse goes to PingOne after the 401, and answers when you return.">
              <input type="checkbox" role="switch" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} /><span>Run all the way through</span>
            </label>
          </div>
        </section>
      )}
      {la.steps.length > 0 && <p className="muse__small"><strong>What Muse did</strong>, step by step (click a step for the raw request and response):</p>}
      <ol className="muse__steps">
        {la.steps.map((s) => (
          <li key={s.n} className={s.skipped ? "muse__skipped" : ""}>
            <button type="button" className="muse__head" aria-expanded={open === s.n} onClick={() => setOpen(open === s.n ? null : s.n)}>
              <b>{s.n}</b> {s.title}
              {s.response && <code className={s.response.status >= 400 ? "muse__bad" : "muse__ok"}>{s.response.status}</code>}
              {s.skipped && <code>not contacted</code>}
            </button>
            <p className="muse__small">{s.note}</p>
            {open === s.n && (
              <div className="muse__raw">
                <pre>{`${s.request.method} ${s.request.url}${s.request.body ? `\n\n${pretty(s.request.body)}` : ""}${s.request.form ? `\n\n${pretty(s.request.form)}` : ""}`}</pre>
                {s.response && <pre>{`${s.response.status}${Object.entries(s.response.headers ?? {}).map(([k, v]) => `\n${k}: ${v}`).join("")}\n\n${pretty(s.response.body)}`}</pre>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {la.stopped && <p role="alert" className="muse__small muse__bad">Stopped: {la.stopped}</p>}
      {(error || la.error) && <p role="alert" className="muse__small muse__bad">{error || la.error}</p>}
      {state.userLogin && (
        <section className="muse__chat muse__user" aria-label="Just a user, no agent" data-testid="muse-user-panel">
          <strong>Just a user, no agent</strong>
          <p className="muse__small">Sam signs in as himself through a different PingOne app: no "AI agent detected" screen, no consent, and nothing is exchanged. His own token then goes straight to the gateway.</p>
          <div className="muse__prompts"><button type="button" className="muse__primary" onClick={userSignIn} disabled={busy}>Sign in as Sam (no agent)</button></div>
          {state.user && (
            <div data-testid="muse-user-result">
              {state.user.error && <p role="alert" className="muse__small muse__bad">{state.user.error}</p>}
              {state.user.claims && <p className="muse__small">Token claims: <code>{JSON.stringify({ sub: state.user.claims.sub, aud: state.user.claims.aud, scope: state.user.claims.scope, act: state.user.claims.act ?? "none" })}</code></p>}
              <ol className="muse__steps">
                {state.user.steps.map((x) => (
                  <li key={x.n}><span className="muse__head"><b>{x.n}</b> {x.title}{x.response && <code className={x.response.status >= 400 ? "muse__bad" : "muse__ok"}>{x.response.status}</code>}</span><p className="muse__small">{x.note}</p></li>
                ))}
              </ol>
              {state.user.denied === true && <p className="muse__small" data-testid="muse-user-denied"><strong>Denied.</strong> The gateway refused Sam's own token. Only a token that names an agent acting for him gets through.</p>}
              {state.user.denied === false && <p className="muse__small" data-testid="muse-user-allowed"><strong>Allowed.</strong> The gateway accepted Sam's own token.</p>}
            </div>
          )}
        </section>
      )}
      {state.assistants?.length > 0 && (
        <section className="muse__chat muse__user" aria-label="Connect from your assistant" data-testid="muse-assistant-panel">
          <strong>Connect from your assistant</strong>
          <p className="muse__small">Customers never type a server address. The airline lists its connector once in each assistant's directory; a customer finds it there, clicks Connect and signs in at PingOne.</p>
          <div className="muse__lanes seg" role="group" aria-label="Assistant">
            {state.assistants.map((x) => (
              <button key={x.key} type="button" aria-pressed={x.key === pickedAssistant.key} onClick={() => setAssistant(x.key)} disabled={busy}>{x.name}</button>
            ))}
          </div>
          <div className="muse__msg" data-testid="muse-assistant-card">
            <span className="muse__avatar" aria-hidden="true">U</span>
            <div className="muse__bubble muse__bubble--muse">
              <span className="muse__small">{pickedAssistant.name}: apps and connectors</span>
              <span><strong>United Airlines</strong>. Check your points and loyalty status. Published by United.</span>
              <button type="button" className="muse__primary" onClick={() => assistantSignIn(pickedAssistant.key)} disabled={busy} data-testid="muse-assistant-connect">Connect</button>
            </div>
          </div>
          {state.assistant && state.assistant.key === pickedAssistant.key && (
            <div data-testid="muse-assistant-result">
              {state.assistant.answer && <p className="muse__small"><strong>Connected in {state.assistant.name}.</strong> Asked "How many points do I have?": {Number(state.assistant.answer.points).toLocaleString()} points ({state.assistant.answer.tier}).</p>}
              {state.assistant.claims && <p className="muse__small">Token claims: <code>{JSON.stringify({ sub: state.assistant.claims.sub, act: state.assistant.claims.act ?? "none" })}</code>, {state.assistant.name} acting for the customer.</p>}
              {state.assistant.error && <p role="alert" className="muse__small muse__bad">{state.assistant.error}</p>}
            </div>
          )}
          <p className="muse__small">The card stands in for the assistant's directory listing; the airline has to be approved by each vendor before it appears. Everything after Connect is real.</p>
        </section>
      )}
      {la.claims && <p className="muse__small" data-testid="claims">Token claims (the token itself stays on the Muse server): <code>{JSON.stringify(la.claims)}</code></p>}
    </main>
  );
}
