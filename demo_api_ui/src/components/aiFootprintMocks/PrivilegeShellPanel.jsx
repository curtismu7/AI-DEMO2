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
  const [consoleCurl, setConsoleCurl] = useState("");
  const [consoleInfo, setConsoleInfo] = useState(null);
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

  // Use a Privilege console token (the gateway rejects the PingOne-minted bearer;
  // the console cookie is accepted). Paste a Copy-as-cURL or raw request headers.
  const applyConsoleToken = async () => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await apiClient.post(`${API_BASE}/dev/console-token`, {
        curl: consoleCurl,
      });
      setConsoleInfo(data);
      setScopes(["console-token"]);
      await listTools();
    } catch (err) {
      setConsoleInfo(null);
      setNotice(errText(err));
    } finally {
      setBusy(false);
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
    setSelected("");
    setResult("");
    setConsoleInfo(null);
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
        <strong>Privilege MCP</strong>
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

      {import.meta.env.DEV ? (
        <div className="pvs-console-token">
          <span className="pvs-ct-title">Console token (dev)</span>
          <textarea
            value={consoleCurl}
            onChange={(e) => setConsoleCurl(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="Paste Copy-as-cURL or request headers (auth_token=…)"
          />
          <button
            type="button"
            onClick={applyConsoleToken}
            disabled={busy || !consoleCurl.trim()}
          >
            Use console token
          </button>
          {consoleInfo ? (
            <span className="pvs-ct-status">
              {consoleInfo.kidMatchesGateway ? "✓" : "⚠️"} {consoleInfo.user} — {consoleInfo.expiresInMinutes} min
            </span>
          ) : null}
        </div>
      ) : null}
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
