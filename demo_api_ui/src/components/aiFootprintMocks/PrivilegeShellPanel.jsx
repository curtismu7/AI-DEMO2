// demo_api_ui/src/components/aiFootprintMocks/PrivilegeShellPanel.jsx
// Privilege MCP client hosted inside a footprint costume shell: discover tools
// from the Privilege MCP gateway and call them, styled per costume skin.
// Backend is the same BFF relay the /privilege-mcp-client page uses.
import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../../services/apiClient";
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
  const [selected, setSelected] = useState("");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
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

  const runTool = async () => {
    setBusy(true);
    setResult("");
    try {
      const parsed = JSON.parse(args || "{}");
      const { data } = await apiClient.post(`${API_BASE}/tools/call`, {
        name: selected,
        arguments: parsed,
      });
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setResult(JSON.stringify({ error: errText(err) }, null, 2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pvs pvs--${skin}`} data-testid="privilege-shell-panel">
      <div className="pvs-head">
        <strong>Privilege MCP</strong>
        <span>PingOne Privilege client</span>
      </div>
      {notice ? <div className="pvs-notice">{notice}</div> : null}
      {phase === "loading" ? (
        <div className="pvs-empty">Checking Privilege session…</div>
      ) : null}
      {phase === "signed-out" ? (
        <div className="pvs-connect">
          <p>Connect this tool to the Privilege MCP gateway to discover tools.</p>
          <button type="button" onClick={connect} disabled={busy}>
            Sign in with Privilege
          </button>
        </div>
      ) : null}
      {phase === "ready" ? (
        <>
          {scopes.length ? (
            <div className="pvs-scopes">
              {scopes.map((s) => (
                <code key={s}>{s}</code>
              ))}
            </div>
          ) : null}
          <div className="pvs-tools">
            {tools.map((t) => (
              <button
                key={t.name}
                type="button"
                className={`pvs-tool${t.name === selected ? " is-on" : ""}`}
                onClick={() => {
                  setSelected(t.name);
                  setResult("");
                }}
              >
                <span className="pvs-tool-name">{t.name}</span>
                {t.description ? (
                  <span className="pvs-tool-desc">{t.description}</span>
                ) : null}
              </button>
            ))}
            {tools.length === 0 ? (
              <div className="pvs-empty">No tools discovered.</div>
            ) : null}
          </div>
          {selected ? (
            <div className="pvs-call">
              <label>
                <span>Arguments (JSON) — {selected}</span>
                <textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  rows={3}
                  spellCheck={false}
                />
              </label>
              <button type="button" onClick={runTool} disabled={busy}>
                Call tool
              </button>
            </div>
          ) : null}
          {result ? <pre className="pvs-result">{result}</pre> : null}
        </>
      ) : null}
    </div>
  );
}
