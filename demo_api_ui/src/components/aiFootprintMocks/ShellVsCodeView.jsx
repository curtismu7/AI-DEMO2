import { useEffect, useRef } from "react";
import ToolsTable from "../privilege/ToolsTable";
import { ShellGate, ShellPrompt, ShellSteps } from "./ShellParts";
import "./PrivilegeShellViews.css";

export function ShellVsCodeView({ session }) {
  const logRef = useRef(null);
  const { messages, thinking, tools, latestCall, runTool } = session;
  const withOutput = messages.filter((m) => m.role === "assistant" && (m.steps.length || m.execution));
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thinking]);
  return (
    <div className="pvs pvs--vscode pvs-vsc" data-testid="pvs-vscode">
      <ShellGate session={session}>
        <div ref={logRef} className="pvs-vsc__chat" role="log" aria-label="Chat">
          {messages.map((m) => (
            <div key={m.id} className={`pvs-vsc__msg pvs-vsc__msg--${m.role}`}>
              <strong>{m.role === "user" ? "You" : m.role === "assistant" ? "Copilot" : "System"}</strong>
              <div>{m.content}</div>
            </div>
          ))}
          {thinking ? <div className="pvs-vsc__msg">Working…</div> : null}
        </div>
        <ShellPrompt session={session} placeholder="Ask Copilot…" />
        {tools.length ? (
          <details className="pvs-vsc__tools">
            <summary>Tools ({tools.length})</summary>
            <ToolsTable tools={tools} onExecute={runTool} />
          </details>
        ) : null}
        <section className="pvs-vsc__drawer" aria-label="Tool output">
          <header>TOOL OUTPUT</header>
          {withOutput.map((m) => (
            <div key={m.id}>
              <ShellSteps steps={m.steps} />
              {m.execution ? <pre>{JSON.stringify(m.execution, null, 2)}</pre> : null}
            </div>
          ))}
          {latestCall ? (
            <div>
              <strong>{latestCall.name}</strong> {latestCall.ok ? "ok" : "error"}
              <pre>{latestCall.response}</pre>
            </div>
          ) : null}
        </section>
      </ShellGate>
    </div>
  );
}
