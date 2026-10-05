// demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellPanel.jsx
// Privilege MCP client hosted inside a footprint costume shell: discover tools
// from the Privilege MCP gateway and call them, styled per costume skin.
// Backend is the same BFF relay the /privilege-mcp-client page uses.
import ToolsTable from "../privilege/ToolsTable";
import { ShellTerminalView } from "./ShellTerminalView";
import { ShellVsCodeView } from "./ShellVsCodeView";
import { ShellDesktopView } from "./ShellDesktopView";
import { ShellActivity } from "./ShellActivity";
import "./PrivilegeShellPanel.css";

/**
 * @param {{ skin?: 'coding'|'vscode'|'chatgpt'|'saas', session: ReturnType<typeof import('./usePrivilegeShellSession').usePrivilegeShellSession> }} props
 */
export function PrivilegeShellPanel({ skin = "vscode", session }) {
  const { phase, scopes, tools, latestCall, busy, notice, connect, retryTools, signOut, runTool } = session;
  // Force light/dark on the panel independent of the costume skin's own
  // brightness ("even if the skin is the opposite"). auto = inherit the skin.
  // State lives in the session so every costume shares one setting.
  const { pvsTheme, cyclePvsTheme } = session;

  if (skin === "coding") return <ShellTerminalView session={session} />;
  if (skin === "vscode") return <ShellVsCodeView session={session} />;
  if (skin === "claude-desktop") return <ShellDesktopView session={session} />;

  return (
    <div
      className={`pvs pvs--${skin}`}
      data-pvs-theme={pvsTheme === "auto" ? undefined : pvsTheme}
      data-testid="privilege-shell-panel"
    >
      <div className="pvs-head">
        <strong>AI Agent Gateway</strong>
        <span>PingOne Privilege client</span>
        <button
          type="button"
          className="pvs-theme-toggle"
          title="Force light/dark — overrides this skin's theme"
          onClick={cyclePvsTheme}
        >
          {pvsTheme === "auto" ? "Theme: Auto" : pvsTheme === "light" ? "Theme: Light" : "Theme: Dark"}
        </button>
      </div>
      {notice ? <div className="pvs-notice">{notice}</div> : null}

      {phase === "loading" ? (
        <div className="pvs-empty">Checking Privilege session…</div>
      ) : null}
      {phase === "signed-out" ? (
        <div className="pvs-connect">
          <p>Connect this tool to the AI Agent Gateway to discover tools.</p>
          <button type="button" onClick={connect} disabled={busy}>
            Get MCP tools
          </button>
        </div>
      ) : null}
      {phase === "ready" ? (
        <>
          <div className="pvs-actions">
            <button type="button" onClick={retryTools} disabled={busy}>
              Retry tools
            </button>
            <button type="button" onClick={signOut} disabled={busy}>
              Sign out
            </button>
          </div>
          {scopes.length ? (
            <div className="pvs-scopes">
              {scopes.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
          ) : null}
          {tools.length ? (
            <ToolsTable tools={tools} onExecute={runTool} />
          ) : (
            <div className="pvs-empty">No tools discovered.</div>
          )}
          {latestCall ? (
            <section className="pvs-exchange" aria-label="Latest tool request and result">
              <header>
                <strong>{latestCall.name}</strong>
                <span className={latestCall.ok ? "is-ok" : "is-error"}>{latestCall.ok ? "Success" : "Error"}</span>
              </header>
              <div className="pvs-exchange-grid">
                <div><span>Request</span><pre>{latestCall.request}</pre></div>
                <div><span>Result</span><pre>{latestCall.response}</pre></div>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      <ShellActivity />
    </div>
  );
}
