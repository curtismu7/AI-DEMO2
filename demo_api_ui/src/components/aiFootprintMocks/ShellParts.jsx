import { useState } from "react";

export function ShellGate({ session, children }) {
  const { phase, notice, connect, busy } = session;
  return (
    <>
      {notice ? <div className="pvs-notice">{notice}</div> : null}
      {phase === "loading" ? <div className="pvs-empty">Checking Privilege session…</div> : null}
      {phase === "signed-out" ? (
        <div className="pvs-connect">
          <p>Connect this tool to the AI Agent Gateway to discover tools.</p>
          <button type="button" onClick={connect} disabled={busy}>Sign in with Privilege</button>
        </div>
      ) : null}
      {phase === "ready" ? (
        <>
          {children}
          <div className="pvs-gate-foot">
            <button type="button" onClick={session.signOut} disabled={session.busy}>Sign out</button>
          </div>
        </>
      ) : null}
    </>
  );
}

export function ShellPrompt({ session, placeholder = "Ask the agent…", className = "" }) {
  const [value, setValue] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (!value.trim() || session.thinking) return;
    session.send(value);
    setValue("");
  };
  return (
    <form className={`pvs-prompt ${className}`} onSubmit={submit}>
      <input
        aria-label="Prompt"
        value={value}
        placeholder={placeholder}
        disabled={session.thinking}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" disabled={session.thinking || !value.trim()}>Send</button>
    </form>
  );
}

export function ShellSteps({ steps }) {
  if (!steps?.length) return null;
  return <ul className="pvs-steps">{steps.map((s, i) => <li key={`${i}-${s}`}>{s}</li>)}</ul>;
}
