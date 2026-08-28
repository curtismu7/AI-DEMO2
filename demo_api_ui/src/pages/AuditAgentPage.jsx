// demo_api_ui/src/pages/AuditAgentPage.jsx
//
// /audit-agent — an agent that can reach PingOne's audit log and nothing else.
//
// The relay points at the `audit` façade door, whose upstream is the SHARED
// Agent Gateway — the same one that serves the full banking surface. What
// narrows this page to three tools is the door's advertised scope: it serves
// scopes_supported: ['audit:read'], the relay's OAuth asks for only that, and
// the gateway filters tools/list to what the token permits.
//
// So nothing here filters the tool list, deliberately. A client-side allowlist
// would render the same screen whether the scope narrowing worked or not, which
// would make the page prove nothing.
//
// (The original design routed through Privilege. That was abandoned once the
// hosted PingOne MCP stopped accepting worker client_credentials.)
//
// Backend is the same BFF relay the /privilege-mcp-client page uses; this page
// only points it at the `audit` preset first.
import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../services/apiClient";
import ToolsTable from "../components/privilege/ToolsTable";
import "./AuditAgentPage.css";

const API_BASE = "/api/privilege-mcp";
// Matches the preset label in demo_api_server/routes/privilegeMcpClient.js.
// Selected by label rather than hardcoding the URL so an operator can repoint
// AUDIT_MCP_URL without a UI change.
const AUDIT_PRESET = /pingone audit/i;

function errText(err) {
  return err?.response?.data?.error || err?.message || "Request failed";
}

export default function AuditAgentPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState("loading"); // loading | signed-out | ready
  const [tools, setTools] = useState([]);
  const [gatewayUrl, setGatewayUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState(null);
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

  // Point the shared relay at the audit application before anything else. The
  // BFF keeps ONE gateway config per express session, so a visit here retargets
  // it — same behaviour as picking a preset on /privilege-mcp-client.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: state } = await apiClient.get(`${API_BASE}/state`);
        if (!alive) return;
        const preset = (state.presets || []).find((p) => AUDIT_PRESET.test(p.label || ""));
        if (!preset) {
          setNotice(
            "No audit gateway preset is configured. Set AUDIT_MCP_URL on the BFF.",
          );
          setPhase("signed-out");
          return;
        }
        setGatewayUrl(preset.url);
        if (state.config?.mcpUrl !== preset.url) {
          await apiClient.post(`${API_BASE}/config`, { mcpUrl: preset.url });
        }
        if (!state.oauth?.authenticated) {
          setPhase("signed-out");
          return;
        }
        await listTools();
      } catch (err) {
        if (!alive) return;
        setNotice(errText(err));
        setPhase("signed-out");
      }
    })();
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
      const { data } = await apiClient.post(`${API_BASE}/tools/call`, {
        name,
        arguments: JSON.parse(request),
      });
      return JSON.stringify(data, null, 2);
    } catch (err) {
      return JSON.stringify({ error: errText(err) }, null, 2);
    }
  };

  const ask = async (event) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const { data } = await apiClient.post(`${API_BASE}/chat`, { prompt });
      setAnswer(data);
    } catch (err) {
      setAnswer({ error: errText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="audit-agent-page">
      <header className="aap-head">
        <h1>Audit Agent</h1>
        <p className="aap-sub">
          An agent restricted to PingOne&apos;s audit log by gateway scope — not by this page.
        </p>
      </header>

      {notice && <div className="aap-notice">{notice}</div>}

      <section className="aap-scope">
        <div className="aap-scope-row">
          <span className="aap-label">Door</span>
          <code>{gatewayUrl || "—"}</code>
        </div>
        <div className="aap-scope-row">
          <span className="aap-label">Tools allowed</span>
          <strong>{phase === "ready" ? tools.length : "—"}</strong>
          <span className="aap-hint">
            The same gateway serves the full banking surface; this door&apos;s token cannot reach it.
          </span>
        </div>
      </section>

      {phase === "signed-out" && (
        <section className="aap-connect">
          <p>Sign in to the gateway to see which tools this door&apos;s scope allows.</p>
          <button type="button" onClick={connect} disabled={busy}>
            {busy ? "Connecting…" : "Connect to gateway"}
          </button>
        </section>
      )}

      {phase === "ready" && (
        <>
          <section className="aap-ask">
            <form onSubmit={ask}>
              <label htmlFor="aap-prompt">Ask the audit agent</label>
              <input
                id="aap-prompt"
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Which applications changed in the last 7 days?"
              />
              <button type="submit" disabled={busy || !prompt.trim()}>
                {busy ? "Asking…" : "Ask"}
              </button>
            </form>
            <p className="aap-hint">
              PingOne keeps roughly 7 days of audit history — older ranges come back empty.
            </p>
            {answer && (
              <pre className="aap-answer">{JSON.stringify(answer, null, 2)}</pre>
            )}
          </section>

          <section className="aap-tools">
            <h2>Tools this agent may call</h2>
            <ToolsTable tools={tools} onExecute={runTool} />
          </section>
        </>
      )}
    </div>
  );
}
