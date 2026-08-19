// demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellPanel.jsx
// Privilege MCP client hosted inside a footprint costume shell: discover tools
// from the Privilege MCP gateway and call them, styled per costume skin.
// Backend is the same BFF relay the /privilege-mcp-client page uses.
import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../../services/apiClient";
import ToolsTable from "../privilege/ToolsTable";
import "./PrivilegeShellPanel.css";

const API_BASE = "/api/privilege-mcp";

function errText(err) {
  return err?.response?.data?.error || err?.message || "Request failed";
}

/**
 * @param {{ skin?: 'coding'|'vscode'|'chatgpt'|'saas' }} props
 */
export function PrivilegeShellPanel({ skin = "vscode" }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState("loading"); // loading | signed-out | ready
  const [scopes, setScopes] = useState([]);
  const [tools, setTools] = useState([]);
  const [latestCall, setLatestCall] = useState(null);
  const [busy, setBusy] = useState(false);
  // Force light/dark on the panel independent of the costume skin's own
  // brightness ("even if the skin is the opposite"). auto = inherit the skin.
  const [pvsTheme, setPvsTheme] = useState("auto"); // auto | light | dark
  const [notice, setNotice] = useState(() => {
    if (searchParams.get("auth") !== "error") return "";
    const reason = searchParams.get("reason");
    return `OAuth failed: ${reason || "unknown"}`;
  });

  const listTools = useCallback(async () => {
    const { data } = await apiClient.post(`${API_BASE}/tools/list`);
    setTools(data.tools || []);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    apiClient
      .get(`${API_BASE}/state`)
      .then(async ({ data }) => {
        if (!alive) return;
        if (data.oauth?.scope) {
          setScopes(String(data.oauth.scope).split(" ").filter(Boolean));
        }
        if (!data.oauth?.authenticated) {
          setPhase("signed-out");
          return;
        }
        if (data.tools?.length) {
          setTools(data.tools);
          setPhase("ready");
          return;
        }
        await listTools();
      })
      .catch((err) => {
        if (!alive) return;
        setNotice(errText(err));
        setPhase("signed-out");
      });
    return () => {
      alive = false;
    };
  }, [listTools]);

  const connect = async () => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await apiClient.post(`${API_BASE}/auth/start`, {
        returnTo: location.pathname,
      });
      window.location.assign(data.authUrl);
    } catch (err) {
      setNotice(errText(err));
      setBusy(false);
    }
  };

  const runTool = async (name, argsStr) => {
    const request = argsStr || "{}";
    try {
      const parsed = JSON.parse(request);
      const { data } = await apiClient.post(`${API_BASE}/tools/call`, {
        name,
        arguments: parsed,
      });
      const response = JSON.stringify(data, null, 2);
      setLatestCall({ name, request, response, ok: !data?.error && !data?.result?.isError });
      return response;
    } catch (err) {
      const response = JSON.stringify({ error: errText(err) }, null, 2);
      setLatestCall({ name, request, response, ok: false });
      return response;
    }
  };

  const retryTools = async () => {
    setBusy(true);
    setNotice("");
    try {
      await listTools();
    } catch (err) {
      setNotice(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await apiClient.post(`${API_BASE}/auth/logout`);
    } catch {
      /* ignore — clear locally regardless */
    }
    setTools([]);
    setScopes([]);
    setLatestCall(null);
    setPhase("signed-out");
    setBusy(false);
  };

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
          onClick={() =>
            setPvsTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"))
          }
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
            Sign in with Privilege
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
    </div>
  );
}
