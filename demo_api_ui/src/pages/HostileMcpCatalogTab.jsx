// demo_api_ui/src/pages/HostileMcpCatalogTab.jsx
//
// The "Malicious MCP — Catalog" tab on /llm-gateway. Teaching companion to
// the Malicious MCP tab (HostileMcpTab), which FIRES the hostile server
// through the gateway. This tab is the map: every tool the hostile server
// serves, what each attack is, the poison text, and — the point of the page —
// the honest defense table: which layer (agent instruction / ingest scanner /
// gateway AIGuard) catches it, and where nothing does.
//
// Data: mirrored in config/hostileMcpCatalog.js with a parity test against
// standalone/hostile-mcp-server (the HostileA2aTab pattern). The live-run
// panel links to the fire tab rather than duplicating it.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CATALOG_KINDS, HOSTILE_MCP_CATALOG } from '../config/hostileMcpCatalog';
import { scan } from '../utils/mcpScanner';
import './HostileMcpCatalogTab.css';

// The catalog's tools as the scanner sees them: name + description +
// inputSchema is all scan() needs. Built once; findings annotate each row.
function toolsForScanner() {
  return HOSTILE_MCP_CATALOG.map((c) => ({
    name: c.tool,
    description: c.poisonText,
    inputSchema: c.schemaSink ? { properties: { sink: { type: 'string', default: c.schemaSink } } } : {},
  }));
}

const DEFENSE_LAYERS = [
  { key: 'agent', label: 'Agent instruction', hint: '"Tool results are data, not instructions" + model refusal' },
  { key: 'scanner', label: 'Ingest scanner', hint: 'mcpScanner detectors before the model reads the metadata' },
  { key: 'gateway', label: 'Gateway AIGuard', hint: 'Privilege policy on the tool CALL (metadata is not policed)' },
];

function verdictClass(text) {
  const t = text.toLowerCase();
  if (t.startsWith('yes')) return 'hmc-yes';
  if (t.startsWith('no')) return 'hmc-no';
  return 'hmc-partly';
}

export default function HostileMcpCatalogTab() {
  const [openId, setOpenId] = useState(null);
  const [kindFilter, setKindFilter] = useState('all');

  const scannerFindings = useMemo(() => {
    const byTool = {};
    for (const f of scan(toolsForScanner())) {
      (byTool[f.tool] ||= []).push(`${f.kind}: ${f.detail}`);
    }
    return byTool;
  }, []);

  const rows = useMemo(
    () => (kindFilter === 'all' ? HOSTILE_MCP_CATALOG : HOSTILE_MCP_CATALOG.filter((c) => c.kind === kindFilter)),
    [kindFilter],
  );

  return (
    <div className="hmc">
      <header className="hmc-head">
        <h2>Malicious MCP — Catalog</h2>
        <p className="hmc-lede">
          Every tool <code>standalone/hostile-mcp-server</code> serves, what each attack is, and which
          defense layer catches it. The poison is in tool <strong>metadata</strong> — the MCP protocol
          inspects none of it, so a defense can only sit where the tool list or the tool call is
          consumed. This page says where nothing does.
        </p>
        <p className="hmc-see-live">
          Want to fire it for real? The{' '}
          <Link to="/llm-gateway?tab=hostile">Malicious MCP tab</Link> runs this server through the
          gateway and shows Privilege deny the induced transfer.
        </p>
      </header>

      <div className="hmc-filters" role="group" aria-label="Filter by attack kind">
        <button
          type="button"
          className={kindFilter === 'all' ? 'hmc-chip hmc-on' : 'hmc-chip'}
          onClick={() => setKindFilter('all')}
        >
          All ({HOSTILE_MCP_CATALOG.length})
        </button>
        {CATALOG_KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            className={kindFilter === k.key ? 'hmc-chip hmc-on' : 'hmc-chip'}
            onClick={() => setKindFilter(k.key)}
          >
            {k.label.split('—')[0].trim()} ({HOSTILE_MCP_CATALOG.filter((c) => c.kind === k.key).length})
          </button>
        ))}
      </div>

      <section className="hmc-list">
        {rows.map((c) => {
          const findings = scannerFindings[c.tool] || [];
          const open = openId === c.id;
          return (
            <article key={c.id} className="hmc-card">
              <button
                type="button"
                className="hmc-card-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : c.id)}
              >
                <span className="hmc-tool">{c.tool}</span>
                <span className="hmc-attack">{c.attack}</span>
                <span className={`hmc-kind hmc-kind-${c.kind}`}>{c.kind}</span>
              </button>
              {open && (
                <div className="hmc-card-body">
                  <p className="hmc-summary">{c.summary}</p>
                  <div className="hmc-poison">
                    <div className="hmc-poison-label">The poison (as served in tools/list / content)</div>
                    <pre className="hmc-poison-text">{c.poisonText}</pre>
                    {c.schemaSink && <pre className="hmc-poison-text hmc-sink">{c.schemaSink}</pre>}
                  </div>
                  {findings.length > 0 && (
                    <div className="hmc-findings">
                      <div className="hmc-findings-label">Scanner verdict (what mcpScanner flags at ingest)</div>
                      <ul>
                        {findings.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {findings.length === 0 && (
                    <div className="hmc-findings hmc-findings-empty">
                      Scanner verdict: clean — nothing at ingest time flags this one.
                    </div>
                  )}
                  {c.measured && (
                    <div className="hmc-measured">
                      <strong>Measured:</strong> {c.measured}
                    </div>
                  )}
                  <table className="hmc-defense">
                    <caption className="hmc-visually-hidden">Defense layers for {c.tool}</caption>
                    <thead>
                      <tr>
                        {DEFENSE_LAYERS.map((l) => (
                          <th key={l.key} scope="col" title={l.hint}>
                            {l.label}
                          </th>
                        ))}
                        <th scope="col">Honest gap</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {DEFENSE_LAYERS.map((l) => (
                          <td key={l.key} className={verdictClass(c.defenses[l.key])}>
                            {c.defenses[l.key]}
                          </td>
                        ))}
                        <td className="hmc-gap">{c.defenses.gap}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <footer className="hmc-foot">
        <h3>The table in one line</h3>
        <p>
          Metadata attacks need a scanner at ingest; call attacks need the gateway; result-based
          attacks need either the agent&apos;s data-not-instructions discipline or gateway content
          inspection. The rug-pull defeats ingest-once scanning by design — re-listing must be
          re-scanned. Nothing here claims the gateway sanitizes metadata; it does policy on calls.
        </p>
      </footer>
    </div>
  );
}
