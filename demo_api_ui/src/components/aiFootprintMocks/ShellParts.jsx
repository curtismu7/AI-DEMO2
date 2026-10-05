import { useState } from "react";
import ToolsTable from "../privilege/ToolsTable";
import { doorName, doorsForMode } from "../privilege/privilegeRouting";

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

export function ShellRoutingBar({ session }) {
  const { routing, busy, pickPath, pickDoor } = session;
  const off = busy || !routing.loaded;
  const doors = doorsForMode(routing.presets, routing.gatewayMode);
  return (
    <div className="pvs-routing">
      <label>
        <span>Path</span>
        <select
          aria-label="Connection path"
          value={routing.llmPath ? `llm:${routing.llmPath}` : routing.gatewayMode}
          disabled={off}
          onChange={(e) => pickPath(e.target.value)}
        >
          <optgroup label="MCP path (tools)">
            <option value="direct">Direct</option>
            <option value="privilege">Privilege</option>
            <option value="facade">Façade</option>
          </optgroup>
          <optgroup label="LLM path (prompt)">
            <option value="llm:anthropic">Anthropic</option>
            <option value="llm:google">Google</option>
            <option value="llm:openai">OpenAI</option>
          </optgroup>
        </select>
      </label>
      <label>
        <span>Door</span>
        {doors.length ? (
          <select
            aria-label="MCP backend (door)"
            value={routing.config.mcpUrl || ""}
            disabled={off}
            onChange={(e) => pickDoor(e.target.value)}
          >
            {doors.map((url) => <option key={url} value={url}>{doorName(url) || url}</option>)}
          </select>
        ) : (
          <span>{doorName(routing.config.mcpUrl) || "—"}</span>
        )}
      </label>
    </div>
  );
}

export function ShellToolsList({ session, collapsible = false }) {
  const { routing, tools, runTool, retryTools, busy } = session;
  let body;
  if (routing.llmPath) {
    body = <p className="pvs-note">Tools apply to MCP paths.</p>;
  } else if (tools.length) {
    body = <ToolsTable tools={tools} onExecute={runTool} />;
  } else {
    body = (
      <div className="pvs-empty">
        No tools loaded.{" "}
        <button type="button" onClick={retryTools} disabled={busy}>Load tools</button>
      </div>
    );
  }
  if (!collapsible) return <div className="pvs-tools">{body}</div>;
  return (
    <details className="pvs-tools" open>
      <summary>Tools ({routing.llmPath ? 0 : tools.length})</summary>
      {body}
    </details>
  );
}

export function ShellLatestCall({ latestCall }) {
  if (!latestCall) return null;
  return (
    <section className="pvs-latest" aria-label="Latest tool run">
      <header>
        <strong>{latestCall.name}</strong> {latestCall.ok ? "Success" : "Error"}
      </header>
      <div><span>Request</span><pre>{latestCall.request}</pre></div>
      <div><span>Result</span><pre>{latestCall.response}</pre></div>
    </section>
  );
}
