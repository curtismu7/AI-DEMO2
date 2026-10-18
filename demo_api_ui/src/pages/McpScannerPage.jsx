// MCP Metadata Scanner (/mcp-scanner) — the blue-team scanner, run live in the
// browser. It executes the same detection as standalone/mcp-scanner (imported
// from utils/mcpScanner) over the hostile server's captured tool catalog, or over
// any tools/list JSON you paste. No backend, no shell-out — the detection is pure
// regex, so it runs client-side and always works for the demo.
import { useState } from "react";
import { scan, scanPrompts, scanResources, HOSTILE_PROMPTS, HOSTILE_RESOURCES, HOSTILE_TOOLS } from "../utils/mcpScanner";
import PageHeader from "../components/common/PageHeader";
import "./McpScannerPage.css";

export default function McpScannerPage() {
  const [findings, setFindings] = useState(null); // null = not run yet
  const [scanned, setScanned] = useState(null); // {source, tools:[names]}
  const [json, setJson] = useState("");
  const [error, setError] = useState("");

  const runHostile = () => {
    setError("");
    setFindings([...scan(HOSTILE_TOOLS), ...scanResources(HOSTILE_RESOURCES), ...scanPrompts(HOSTILE_PROMPTS)]);
    setScanned({
      source: "the hostile MCP server (libre)",
      tools: HOSTILE_TOOLS.map((t) => t.name),
      resources: HOSTILE_RESOURCES.map((r) => r.name || r.uri),
      prompts: HOSTILE_PROMPTS.map((p) => p.name),
    });
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
      <PageHeader
        className="mcps-hero"
        eyebrow="Blue-team · defense in depth"
        title="MCP Content Scanner"
        summary={
          <>
            The Privilege gateway polices tool <em>calls</em>, not arbitrary MCP <em>content</em> — so poisoned tool
            metadata, resources, and prompts can reach an agent unfiltered. This scanner reads those surfaces and flags the
            poison <b>before</b> the agent ingests it. Same detection as{" "}
            <code className="mcps-code">standalone/mcp-scanner</code>, run here in your browser.
          </>
        }
      />

      <section className="mcps-panel">
        <div className="mcps-run-row">
          <button type="button" className="mcps-btn mcps-btn-primary" onClick={runHostile}>
            Scan the hostile MCP server
          </button>
          <span className="mcps-run-hint">Scans tools, resources, and prompts: get_weather · account-verification · account_review</span>
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
            Scanned {scanned.tools.length} tool(s), {scanned.resources?.length || 0} resource(s), and {scanned.prompts?.length || 0} prompt(s) from {scanned.source}.
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
