// MCP Metadata Scanner (/mcp-scanner) — the blue-team scanner, run live in the
// browser. It executes the same detection as standalone/mcp-scanner (imported
// from utils/mcpScanner) over the hostile server's captured tool catalog, or over
// any tools/list JSON you paste. No backend, no shell-out — the detection is pure
// regex, so it runs client-side and always works for the demo.
//
// Honesty: the detection is real (it runs here, on the content it is given). The
// "hostile server" is a captured copy bundled with the page, not a live fetch, and
// the Privilege gateway is never called: a result is scanner output, not a gateway
// decision.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) on the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips,
// P9 buttons. Skipped: P6 (not an inspector) and P8 (no diagram). The standalone shell
// bar is not added (the app has its own).
//
// P9, one primary per view state: "Scan the hostile MCP server" is the only primary in
// every state (nothing scanned, a result, a parse error). "Scan JSON" is a secondary:
// it is aria-disabled while the box is empty so it keeps keyboard focus.
import { useState } from "react";
import { scan, scanPrompts, scanResources, HOSTILE_PROMPTS, HOSTILE_RESOURCES, HOSTILE_TOOLS } from "../utils/mcpScanner";
import PageHeader from "../components/common/PageHeader";
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from "../components/pingUi";
import "./McpScannerPage.css";

const KIND_META = {
  "hidden-instruction": { label: "Hidden instruction", tone: "danger" },
  "sensitive-action": { label: "Sensitive action", tone: "danger" },
  "exfil-sink": { label: "Exfil sink", tone: "warn" },
};
const kindMeta = (kind) => KIND_META[kind] || { label: kind, tone: "warn" };

const names = (list) => (list && list.length ? list.join(", ") : "none");

export default function McpScannerPage() {
  const [findings, setFindings] = useState(null); // null = not run yet
  const [scanned, setScanned] = useState(null); // {source, tools:[names]}
  const [json, setJson] = useState("");
  const [error, setError] = useState("");

  const runHostile = () => {
    setError("");
    setFindings([...scan(HOSTILE_TOOLS), ...scanResources(HOSTILE_RESOURCES), ...scanPrompts(HOSTILE_PROMPTS)]);
    setScanned({
      source: "the captured hostile MCP server sample (libre)",
      tools: HOSTILE_TOOLS.map((t) => t.name),
      resources: HOSTILE_RESOURCES.map((r) => r.name || r.uri),
      prompts: HOSTILE_PROMPTS.map((p) => p.name),
    });
  };

  const emptyJson = !json.trim();

  const runJson = () => {
    if (emptyJson) return; // aria-disabled: the button keeps focus but does nothing
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
    <PingPage className="mcps-page">
      <SimBanner data-testid="mcps-banner">
        <strong>REAL SCAN, CAPTURED SAMPLE</strong> — the detection runs here in your browser on whatever content it is
        given, so a result is real for that content. The hostile server is a fixed copy of its catalog bundled with this
        page, not fetched from a running server. Nothing is sent anywhere and the Privilege gateway is not called: a
        finding is scanner output, not a gateway decision.
      </SimBanner>
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
      <PageFrame>
        <Section id="mcps-choose" kicker="1 · Choose what to scan" title="A captured hostile server, or your own tools/list">
          <CardGrid>
            <Card title="Captured hostile sample" data-testid="mcps-sample-card">
              <p className="pu-note">
                Scans the tools, resources and prompts of the hostile MCP server as captured:
                <span className="pu-mono"> get_weather · account-verification · account_review</span>.
              </p>
              <div className="pu-actions">
                <button type="button" className="pu-btn pu-btn--primary" data-testid="mcps-scan-hostile" onClick={runHostile}>
                  Scan the hostile MCP server
                </button>
              </div>
            </Card>
            <Card title="Your own tools/list JSON" data-testid="mcps-json-card">
              <label className="pu-label" htmlFor="mcps-json">An MCP tools/list array, or an object with a tools array</label>
              <textarea
                id="mcps-json"
                className="mcps-textarea"
                data-testid="mcps-json"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder='[{"name":"get_weather","description":"..."}]'
                rows={6}
                spellCheck={false}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? "mcps-error" : undefined}
              />
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn"
                  data-testid="mcps-scan-json"
                  onClick={runJson}
                  aria-disabled={emptyJson ? "true" : undefined}
                >
                  Scan JSON
                </button>
              </div>
              {error && (
                <p id="mcps-error" className="pu-status-line mcps-error" role="alert" data-testid="mcps-error">
                  <StatusChip tone="danger">Not scanned</StatusChip> {error}
                </p>
              )}
            </Card>
          </CardGrid>
        </Section>

        <Section id="mcps-result" kicker="2 · Result" title="What the scanner found">
          <div aria-live="polite" data-testid="mcps-results">
            {findings === null ? (
              <p className="pu-note pu-empty" data-testid="mcps-empty">
                {error ? "No result: the pasted text could not be parsed." : "Nothing scanned yet. Run a scan above."}
              </p>
            ) : (
              <>
                <Card
                  tone={findings.length === 0 ? "ok" : "danger"}
                  title="Scan summary"
                  data-testid="mcps-summary"
                >
                  <p className="pu-status-line">
                    {findings.length === 0 ? (
                      <StatusChip tone="ok">Clean</StatusChip>
                    ) : (
                      <StatusChip tone="danger">{`${findings.length} finding${findings.length === 1 ? "" : "s"}`}</StatusChip>
                    )}
                    {findings.length === 0
                      ? "No poisoned metadata found."
                      : "This metadata would reach an agent unfiltered. Do not trust these tools."}
                  </p>
                  <KvList
                    items={[
                      { label: "Source", value: scanned.source },
                      { label: "Tools", value: `${scanned.tools.length}: ${names(scanned.tools)}`, mono: true },
                      { label: "Resources", value: `${scanned.resources?.length || 0}: ${names(scanned.resources)}`, mono: true },
                      { label: "Prompts", value: `${scanned.prompts?.length || 0}: ${names(scanned.prompts)}`, mono: true },
                    ]}
                  />
                  {findings.length === 0 && (
                    <p className="pu-note">The rules are pattern-based, so a clean result is not proof the server is safe.</p>
                  )}
                </Card>
                {findings.length > 0 && (
                  <ul className="pu-card-grid mcps-findings" data-testid="mcps-findings">
                    {findings.map((f, i) => {
                      const meta = kindMeta(f.kind);
                      return (
                        <li key={i}>
                          <Card tone={meta.tone} data-testid="mcps-finding">
                            <p className="pu-status-line"><StatusChip tone={meta.tone}>{meta.label}</StatusChip></p>
                            <h3 className="pu-h3 pu-mono">{f.tool}</h3>
                            <p className="pu-note mcps-detail">{f.detail}</p>
                          </Card>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
