import { useEffect, useRef } from "react";
import { ShellGate, ShellLatestCall, ShellPrompt, ShellSteps, ShellToolsList, themeAttr } from "./ShellParts";
import { ShellActivity } from "./ShellActivity";
import "./PrivilegeShellViews.css";

export function ShellVsCodeView({ session }) {
  const logRef = useRef(null);
  const { messages, thinking, latestCall } = session;
  const withOutput = messages.filter((m) => m.role === "assistant" && (m.steps.length || m.execution));
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking]);
  return (
    <div className="pvs pvs--vscode pvs-vsc" data-testid="pvs-vscode" data-pvs-theme={themeAttr(session)}>
      <ShellGate session={session} routingBar={false}>
        <div ref={logRef} className="pvs-vsc__chat" role="log" aria-label="Chat">
          {messages.map((m) => (
            <div key={m.id} className={`pvs-vsc__msg pvs-vsc__msg--${m.role}`}>
              <strong>{m.role === "user" ? "You" : m.role === "assistant" ? "Copilot" : "System"}</strong>
              <div>{m.content}</div>
            </div>
          ))}
          {thinking ? <div className="pvs-vsc__msg">Working…</div> : null}
        </div>
        <ShellToolsList session={session} collapsible />
        <ShellPrompt session={session} placeholder="Ask Copilot…" />
        <section className="pvs-vsc__drawer" aria-label="Tool output">
          <header>TOOL OUTPUT</header>
          {withOutput.map((m) => (
            <div key={m.id}>
              <ShellSteps steps={m.steps} />
              {m.execution ? <pre>{JSON.stringify(m.execution, null, 2)}</pre> : null}
            </div>
          ))}
          <ShellLatestCall latestCall={latestCall} />
        </section>
        <ShellActivity />
      </ShellGate>
    </div>
  );
}
