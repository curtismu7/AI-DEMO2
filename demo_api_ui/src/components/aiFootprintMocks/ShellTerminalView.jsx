import { useEffect, useRef } from "react";
import { ShellGate, ShellLatestCall, ShellPrompt, ShellRoutingBar, ShellToolsList, themeAttr } from "./ShellParts";
import "./PrivilegeShellViews.css";

export function ShellTerminalView({ session }) {
  const logRef = useRef(null);
  const { messages, thinking } = session;
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking]);
  return (
    <div className="pvs pvs--coding pvs-term" data-testid="pvs-terminal" data-pvs-theme={themeAttr(session)}>
      <ShellGate session={session}>
        <ShellRoutingBar session={session} />
        <div ref={logRef} className="pvs-term__log" role="log" aria-label="Terminal">
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="pvs-term__you">&gt; {m.content}</div>
            ) : (
              <div key={m.id} className={`pvs-term__out pvs-term__out--${m.role}`}>
                {m.steps.map((s, i) => (
                  <div key={`${i}-${s}`} className="pvs-term__tool">&#9679; {s}</div>
                ))}
                {m.execution ? <pre className="pvs-term__res">{JSON.stringify(m.execution, null, 2)}</pre> : null}
                <div>{m.content}</div>
              </div>
            ),
          )}
          {thinking ? <div className="pvs-term__tool">&#9679; thinking…</div> : null}
        </div>
        <ShellToolsList session={session} collapsible />
        <ShellLatestCall latestCall={session.latestCall} />
        <ShellPrompt session={session} className="pvs-term__prompt" />
      </ShellGate>
    </div>
  );
}
