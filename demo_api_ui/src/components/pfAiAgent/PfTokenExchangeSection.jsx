import { useState } from "react";
import apiClient from "../../services/apiClient";
import { Card, KvList, StatusChip } from "../pingUi";
import { FlowSection, RunStatus, actionClass } from "./shared";

// RFC 8693 at PingFederate: user token -> agent token -> MCP token, each hop adding to the act chain.
function Hop({ view }) {
  const c = view.claims || {};
  return (
    <Card tone="ok" title={view.hop === "agent" ? "Hop 1: token for the agent" : "Hop 2: token for the MCP server"} data-testid={`exchange-hop-${view.hop}`}>
      <div className="pu-status-line"><StatusChip tone="ok">Issued</StatusChip></div>
      <KvList
        items={[
          { label: "sub (still the user)", value: String(c.sub ?? "") },
          { label: "aud", value: Array.isArray(c.aud) ? c.aud.join(" ") : String(c.aud ?? "") },
          { label: "scope", value: Array.isArray(c.scope) ? c.scope.join(" ") : String(c.scope ?? "") },
        ]}
      />
      <p className="pu-note">act (who is acting for the user):</p>
      <pre className="ptrace__code">{JSON.stringify(c.act ?? null, null, 2)}</pre>
    </Card>
  );
}

export default function PfTokenExchangeSection({ provider, lead = false }) {
  const [busy, setBusy] = useState("");
  const [hops, setHops] = useState([]);
  const [error, setError] = useState(null);
  const pfSession = provider === "pingfederate";

  async function run() {
    if (!pfSession || busy) return;
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
    <FlowSection
      anchor="token-exchange"
      id="pf-ai-delegation-title"
      kicker="Delegation"
      title="Token exchange: agent acting for a user"
      lede="Two RFC 8693 exchanges at PingFederate. The user stays the subject; the act claim records each actor."
    >
      <Card>
        <div className="pu-actions">
          <button className={actionClass(lead)} type="button" onClick={run} aria-disabled={!pfSession || busy ? "true" : undefined}>
            Run both exchanges
          </button>
        </div>
        <RunStatus tone={busy ? "info" : "ok"} word={busy ? "Running" : hops.length === 2 ? "Done" : ""}>
          {busy ? `${busy}.` : "Both exchanges completed at PingFederate."}
        </RunStatus>
        {!pfSession && (
          <p className="pu-note" data-testid="delegation-needs-pf">
            Needs an app session signed in with PingFederate: the exchange starts from that session&apos;s token.
          </p>
        )}
        {error && (
          <p className="pfai-error" role="alert">
            The exchange failed. Reason: <code>{error.code}</code>{error.detail && <> {error.detail}</>}
          </p>
        )}
      </Card>
      {hops.map((view) => <Hop key={view.hop} view={view} />)}
    </FlowSection>
  );
}
