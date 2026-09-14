// MCP Metadata Scanner (/mcp-scanner) — the blue-team scanner, run live in the
// browser. It executes the same detection as standalone/mcp-scanner (imported
// from utils/mcpScanner) over the hostile server's captured tool catalog, or over
// any tools/list JSON you paste. No backend, no shell-out — the detection is pure
// regex, so it runs client-side and always works for the demo.
import { useState } from "react";
import { scan, HOSTILE_TOOLS } from "../utils/mcpScanner";
import "./McpScannerPage.css";

export default function McpScannerPage() {
  const [findings, setFindings] = useState(null); // null = not run yet
  const [scanned, setScanned] = useState(null); // {source, tools:[names]}
  const [json, setJson] = useState("");
  const [error, setError] = useState("");

  const runHostile = () => {
    setError("");
    setFindings(scan(HOSTILE_TOOLS));
    setScanned({ source: "the hostile MCP server (libre)", tools: HOSTILE_TOOLS.map((t) => t.name) });
  };

  const runJson = () => {
    setError("");
    let tools;
    try {
      const parsed = JSON.parse(json);
      tools = Array.isArray(parsed) ? parsed : parsed.tools;
      if (!Array.isArray(tools)) throw new Error("expected an array of tools, or an object with a `tools` array");
    } catch (e) {
      setFindings(null);
      setScanned(null);
      setError(`Could not parse that as a tools/list: ${e.message}`);
      return;
    }
    setFindings(scan(tools));
    setScanned({ source: "your pasted tools/list", tools: tools.map((t) => t?.name || "(unnamed)") });
  };

  return (
    <div className="mcps-page">
      <header className="mcps-hero">
        <p className="mcps-eyebrow">Blue-team · defense in depth</p>
        <h1 className="mcps-title">MCP Metadata Scanner</h1>
        <p className="mcps-lede">
          The Privilege gateway polices tool <em>calls</em>, not tool <em>metadata</em> — so a hostile server's poisoned
          <code className="mcps-code"> description</code> and <code className="mcps-code">inputSchema</code> reach an agent
          on <code className="mcps-code">tools/list</code> unfiltered. This scanner reads that metadata and flags the
          poison <b>before</b> the agent ingests it. Same detection as{" "}
          <code className="mcps-code">standalone/mcp-scanner</code>, run here in your browser.
        </p>
      </header>

      <section className="mcps-panel">
        <div className="mcps-run-row">
          <button type="button" className="mcps-btn mcps-btn-primary" onClick={runHostile}>
            Scan the hostile MCP server
          </button>
          <span className="mcps-run-hint">Scans the live poison catalog: get_weather · search_docs · create_transfer</span>
        </div>

        <details className="mcps-custom">
          <summary className="mcps-summary">Or scan your own tools/list JSON</summary>
          <textarea
            className="mcps-textarea"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder='Paste an MCP tools/list array or {"tools":[...]} here'
            rows={8}
            spellCheck={false}
          />
          <button type="button" className="mcps-btn" onClick={runJson} disabled={!json.trim()}>
            Scan JSON
          </button>
        </details>
      </section>

      {error && <p className="mcps-error" role="alert">{error}</p>}

      {findings !== null && (
        <section className="mcps-results" aria-live="polite">
          <p className="mcps-scanned">
            Scanned {scanned.tools.length} tool(s) from {scanned.source}: {scanned.tools.join(", ")}
          </p>
          {findings.length === 0 ? (
            <div className="mcps-clean">✓ No poisoned metadata found</div>
          ) : (
            <>
              <ul className="mcps-findings">
                {findings.map((f, i) => (
                  <li className={`mcps-finding mcps-kind-${f.kind}`} key={i}>
                    <span className="mcps-finding-head">
                      ⚠ <b>{f.tool}</b> — {f.kind}
                    </span>
                    <span className="mcps-finding-detail">{f.detail}</span>
                  </li>
                ))}
              </ul>
              <p className="mcps-verdict">
                {findings.length} finding(s). This metadata reaches an agent unfiltered — do not trust this server's tools.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
