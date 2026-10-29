import { useState } from "react";
import apiClient from "../../services/apiClient";

// RFC 8693 at PingFederate: user token -> agent token -> MCP token, each hop adding to the act chain.
function Hop({ view }) {
  const c = view.claims || {};
  return (
    <div className="pf-ai-agent__result" data-testid={`exchange-hop-${view.hop}`}>
      <h3>{view.hop === "agent" ? "Hop 1: token for the agent" : "Hop 2: token for the MCP server"}</h3>
      <dl>
        <div><dt>sub (still the user)</dt><dd>{String(c.sub ?? "")}</dd></div>
        <div><dt>aud</dt><dd>{Array.isArray(c.aud) ? c.aud.join(" ") : String(c.aud ?? "")}</dd></div>
        <div><dt>scope</dt><dd>{Array.isArray(c.scope) ? c.scope.join(" ") : String(c.scope ?? "")}</dd></div>
      </dl>
      <p className="pf-ai-agent__hint">act (who is acting for the user):</p>
      <pre className="ptrace__code">{JSON.stringify(c.act ?? null, null, 2)}</pre>
    </div>
  );
}

export default function PfTokenExchangeSection({ provider }) {
  const [busy, setBusy] = useState("");
  const [hops, setHops] = useState([]);
  const [error, setError] = useState(null);
  const pfSession = provider === "pingfederate";

  async function run() {
    setHops([]);
    setError(null);
    try {
      setBusy("Exchanging for the agent");
      const agent = (await apiClient.post("/api/pf-ai-agent/token-exchange/agent")).data;
      setHops([agent]);
      setBusy("Exchanging for the MCP server");
      const mcp = (await apiClient.post("/api/pf-ai-agent/token-exchange/mcp")).data;
      setHops([agent, mcp]);
    } catch (failure) {
      setError({ code: failure?.response?.data?.error || "pf_ai_exchange_failed", detail: failure?.response?.data?.detail || "" });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="pf-ai-agent__flow pf-ai-agent__flow--delegation" aria-labelledby="pf-ai-delegation-title" id="token-exchange">
      <div className="pf-ai-agent__flow-title">
        <p className="pf-ai-agent__eyebrow">Delegation</p>
        <h2 id="pf-ai-delegation-title">Token exchange: agent acting for a user</h2>
        <p>Two RFC 8693 exchanges at PingFederate. The user stays the subject; the act claim records each actor.</p>
      </div>
      <div className="pf-ai-agent__flow-body">
        <button className="pf-ai-agent__action" type="button" onClick={run} disabled={!pfSession || Boolean(busy)}>
          {busy || "Run both exchanges"}
        </button>
        {!pfSession && (
          <p className="pf-ai-agent__hint" data-testid="delegation-needs-pf">
            Needs an app session signed in with PingFederate: the exchange starts from that session&apos;s token.
          </p>
        )}
        {error && (
          <p className="pf-ai-agent__error" role="alert">
            The exchange failed. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
        {hops.map((view) => <Hop key={view.hop} view={view} />)}
      </div>
    </section>
  );
}
