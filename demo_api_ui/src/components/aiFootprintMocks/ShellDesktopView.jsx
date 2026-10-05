import { useEffect, useRef } from "react";
import { ShellGate, ShellPrompt, ShellSteps } from "./ShellParts";
import "./PrivilegeShellViews.css";

export function ShellDesktopView({ session }) {
  const logRef = useRef(null);
  const { messages, thinking } = session;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking]);
  return (
    <div className="pvs pvs--claude-desktop pvs-desk" data-testid="pvs-desktop">
      <ShellGate session={session}>
        <div ref={logRef} className="pvs-desk__thread" role="log" aria-label="Conversation">
          {messages.map((m) => (
            <div key={m.id} className={`pvs-desk__msg pvs-desk__msg--${m.role}`}>
              {m.decision || m.execution ? (
                <article className="pvs-desk__card" aria-label="Tool call">
                  <header>{m.decision?.tool || "Tool call"}</header>
                  {m.execution ? <pre>{JSON.stringify(m.execution, null, 2)}</pre> : null}
                </article>
              ) : null}
              <div className="pvs-desk__bubble">{m.content}</div>
              {m.steps.length ? (
                <details><summary>Steps</summary><ShellSteps steps={m.steps} /></details>
              ) : null}
            </div>
          ))}
          {thinking ? <div className="pvs-desk__bubble">Thinking…</div> : null}
        </div>
        <ShellPrompt session={session} placeholder="Message Claude…" />
      </ShellGate>
    </div>
  );
}
