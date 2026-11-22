import { useCallback, useEffect, useRef, useState } from "react";
import "./SpiffePrivilegePage.css";
import PageHeader from "./common/PageHeader";

const SHAPES = [
  {
    id: "raw-svid",
    label: "Raw SVID",
    tagline: "The SPIRE JWT-SVID itself, verbatim. sub is a spiffe:// URI — no client_id, no act.",
    expectation: "The honest test: does the Privilege gateway verify SPIFFE workload identity directly?",
  },
  {
    id: "pf-exchanged",
    label: "PF-exchanged token",
    tagline: "PingFederate mints an access token in exchange for the SVID as actor_token (RFC 8693).",
    expectation: "The composite story: SVID → PF → gateway, carrying client_id/act.sub like the verified PF pattern.",
  },
  {
    id: "pf-client-credentials",
    label: "PF client-credentials baseline",
    tagline: "A plain PingFederate client-credentials token. No SPIFFE anywhere in it.",
    expectation: "The control: what a workload-identity-free token looks like to the same door.",
  },
];

function classifyGateway(status, body) {
  if (status === 200) {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    if (/tools|ListIndexTool|result/.test(text)) {
      return { tone: "ok", verdict: "PERMIT — gateway verified the workload identity and returned real tools" };
    }
    return { tone: "ok", verdict: "PERMIT — gateway accepted the call (HTTP 200)" };
  }
  if (status === 401) {
    if (body && typeof body === "object" && body.error === "unauthorized") {
      return { tone: "refused", verdict: "Refused at the gateway front door — bearer challenge (RFC 9728 resource metadata returned)" };
    }
    return { tone: "refused", verdict: "401 — gateway refused the token" };
  }
  if (status === 403) {
    return { tone: "refused", verdict: "403 — token reached policy evaluation and was denied" };
  }
  return { tone: "error", verdict: `Unexpected gateway status ${status ?? "—"}` };
}

function formatJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function redactToken(token) {
  if (typeof token !== "string" || token.length < 24) return "<short token>";
  return `${token.slice(0, 12)}…${token.slice(-8)} (${token.length} chars, not displayed)`;
}

function ShapeCard({ shape, state, onRun, disabled }) {
  const result = state.result;
  const verdict = result && result.gateway ? classifyGateway(result.gateway.status, result.gateway.body) : null;
  const running = state.running;

  return (
    <section className={`spfp-card spfp-card--${verdict ? verdict.tone : "idle"}`}>
      <header className="spfp-card__head">
        <h3>{shape.label}</h3>
        {verdict ? (
          <span className={`spfp-pill spfp-pill--${verdict.tone}`}>{verdict.tone === "ok" ? "✓ PERMIT" : verdict.tone === "refused" ? "❌ REFUSED" : "⚠ ERROR"}</span>
        ) : (
          <span className="spfp-pill spfp-pill--idle">idle</span>
        )}
      </header>
      <p className="spfp-card__tagline">{shape.tagline}</p>
      <p className="spfp-card__expectation">{shape.expectation}</p>
      {verdict && <p className={`spfp-card__verdict spfp-card__verdict--${verdict.tone}`}>{verdict.verdict}</p>}
      {running && <p className="spfp-card__running">⚡ running — minting token, calling the gateway…</p>}
      {result && result.error && <p className="spfp-card__error spfp-card__error">{result.error}</p>}
      <button type="button" className="spfp-card__run" onClick={() => onRun(shape.id)} disabled={disabled || running}>
        {running ? "Running…" : result ? "Run again" : "Run this shape"}
      </button>
      {result && !result.error && (
        <details className="spfp-details" open>
          <summary>Request / response inspector</summary>
          <div className="spfp-details__grid">
            <div>
              <h4>Decoded token claims</h4>
              <pre>{formatJson(result.claims)}</pre>
            </div>
            <div>
              <h4>Gateway response</h4>
              <pre>{`HTTP ${result.gateway.status} ${result.gateway.url}\n\n${typeof result.gateway.body === "string" ? result.gateway.body : formatJson(result.gateway.body)}`}</pre>
            </div>
            <div>
              <h4>Token presented (redacted)</h4>
              <pre>{redactToken(result.token)}</pre>
            </div>
          </div>
        </details>
      )}
      {result && result.error && (
        <details className="spfp-details">
          <summary>Error detail</summary>
          <pre>{result.detail || result.error}</pre>
        </details>
      )}
    </section>
  );
}

export default function SpiffePrivilegePage() {
  const [states, setStates] = useState(() => Object.fromEntries(SHAPES.map((s) => [s.id, { running: false, result: null }])));
  const [flagOk, setFlagOk] = useState(null);
  const anyRunning = Object.values(states).some((s) => s.running);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const runShape = useCallback(async (tokenMode) => {
    setStates((prev) => ({ ...prev, [tokenMode]: { running: true, result: prev[tokenMode]?.result ?? null } }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetch("/api/demo/spiffe/privilege/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_mode: tokenMode,
          resource: "/spire-mcp/mcp",
          audience: "priv-nhi-l5hp7w677rxl3somiehznpomuyxxlhdr",
          scopes: ["mcp:invoke"],
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw Object.assign(new Error(data?.error_description || data?.error || `HTTP ${res.status}`), { detail: data });
      }
      if (mounted.current) {
        setStates((prev) => ({ ...prev, [tokenMode]: { running: false, result: { gateway: data.gateway, claims: data.claims, token: data.access_token, issuer: data.issuer } } }));
      }
    } catch (err) {
      const body = err?.detail;
      const message = body?.error_description || body?.error || (err?.name === "AbortError" ? "timed out after 90s" : err?.message || "call failed");
      if (mounted.current) {
        setStates((prev) => ({ ...prev, [tokenMode]: { running: false, result: { error: message, detail: formatJson(body ?? (err?.name === "AbortError" ? { timeout_ms: 90000 } : err)) } } }));
      }
    } finally {
      clearTimeout(timer);
    }
  }, []);

  return (
    <div className="spfp-page">
      <PageHeader
        title="SPIFFE → Privilege gateway"
        summary="A SPIRE-issued workload identity as the only credential at a governed MCP door — three token shapes, honest verdicts, live."
      />
      <div className="spfp-intro">
        <p>
          The <code>spiffe</code> Docker profile runs a real SPIRE 1.15.2 server + agent (trust domain{" "}
          <code>bxfinance.demo</code>). This page mints a fresh, short-lived JWT-SVID and presents it to the
          Privilege gateway door <code>/spire-mcp/mcp</code> — no static secret, no Privilege-issued key. Three
          shapes are compared; the gateway&rsquo;s own decision is shown verbatim.
        </p>
        <p className="spfp-intro__chain">
          Workload → SPIRE agent (Workload API) → JWT-SVID → <strong>Privilege gateway</strong> (Non-Human
          Identity verify → policy) → MCP backend
        </p>
        {flagOk === false && (
          <p className="spfp-intro__warn">⚠ The route is flag-gated (<code>ff_spiffe_privilege</code>) and currently off, or the SPIRE profile is not running. Ask the operator to enable it.</p>
        )}
      </div>
      <div className="spfp-grid">
        {SHAPES.map((shape) => (
          <ShapeCard
            key={shape.id}
            shape={shape}
            state={states[shape.id]}
            onRun={runShape}
            disabled={flagOk === false}
          />
        ))}
      </div>
      <footer className="spfp-footer">
        <p>
          Setup and the reachability notes live in <code>spiffe/README.md</code>; the console objects (NHI{" "}
          <code>spire-ai-demo</code>, key <code>spire-agent</code>, app <code>spire-mcp</code>) are documented in{" "}
          <code>privilege/</code>. Raw tokens are never rendered — only decoded claims and a redacted preview.
        </p>
      </footer>
    </div>
  );
}
