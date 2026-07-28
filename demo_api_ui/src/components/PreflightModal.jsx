import React, { useEffect, useMemo, useState } from "react";
import DraggableModal from "./DraggableModal";
import "./PreflightModal.css";
import { useCheckRun } from "../hooks/useCheckRun";

/**
 * Demo-prep view over the /api/check registry.
 *
 * The same checks scripts/preflight-demo.sh runs from a terminal — including
 * container/repo drift and client-dispatched chip wiring — rendered as ONE
 * verdict you can read 10 minutes before showtime instead of scrolling stdout.
 *
 * Behind ff_preflight_modal (default OFF).
 *
 * Deliberately re-uses useCheckRun rather than calling /api/check/run itself:
 * that endpoint streams SSE, not JSON, and a second consumer would be a second
 * place to get the parsing wrong. Nothing here re-implements a check either —
 * every row comes from the registry, so this modal and the CLI cannot disagree
 * about what "ready" means. A second copy of that logic is how the
 * requiredDemoFlags mirror drifted and took 22 use cases down.
 */

const STATUS_ICON = { pass: "✅", warn: "⚠️", fail: "❌" };
const ORDER = { fail: 0, warn: 1, pass: 2 };

export default function PreflightModal({ isOpen, onClose }) {
  const { catalog, results, verdict, running, loadCatalog, runAll } = useCheckRun();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(null);
  const [ranAt, setRanAt] = useState(null);

  useEffect(() => {
    if (!isOpen || started) return;
    setStarted(true);
    (async () => {
      try {
        if (!catalog) await loadCatalog();
        await runAll({ includeHeavy: false });
        setRanAt(new Date());
      } catch (e) {
        // Name the failure. "Could not run" with no reason is precisely the
        // silent-pass shape this modal exists to surface elsewhere.
        setError(e && e.message ? e.message : "unknown error");
      }
    })();
  }, [isOpen, started, catalog, loadCatalog, runAll]);

  const rows = useMemo(() => Object.values(results || {}), [results]);
  const failed = rows.filter((r) => r.status === "fail").length;
  const warned = rows.filter((r) => r.status === "warn").length;
  const sorted = useMemo(
    () => [...rows].sort(
      (a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3)
        || String(a.name || a.id).localeCompare(String(b.name || b.id)),
    ),
    [rows],
  );

  const rerun = async () => {
    setError(null);
    try {
      await runAll({ includeHeavy: false });
      setRanAt(new Date());
    } catch (e) {
      setError(e && e.message ? e.message : "unknown error");
    }
  };

  let banner;
  if (running) banner = { text: "Running checks…", cls: "pf-verdict-run" };
  else if (error) banner = { text: `Could not run checks — ${error}`, cls: "pf-verdict-fail" };
  else if (!rows.length) banner = { text: "No results yet.", cls: "pf-verdict-run" };
  else if (failed > 0) banner = { text: `${failed} check${failed === 1 ? "" : "s"} failed — fix before showtime.`, cls: "pf-verdict-fail" };
  else if (warned > 0) banner = { text: `All blocking checks passed — ${warned} advisory.`, cls: "pf-verdict-warn" };
  else banner = { text: `All ${rows.length} checks passed — you're good to demo.`, cls: "pf-verdict-pass" };

  return (
    <DraggableModal
      isOpen={isOpen}
      onClose={onClose}
      title="Preflight — demo readiness"
      defaultWidth={780}
      defaultHeight={640}
    >
      <div className="pf-wrap">
        <div className={`pf-verdict ${banner.cls}`}>{banner.text}</div>

        <div className="pf-actions">
          <button type="button" className="pf-btn" onClick={rerun} disabled={running}>
            {running ? "Running…" : "Re-run"}
          </button>
          {ranAt && !running && <span className="pf-ranat">last run {ranAt.toLocaleTimeString()}</span>}
          {verdict && <span className="pf-ranat">verdict: {String(verdict)}</span>}
        </div>

        {sorted.map((r) => (
          <div key={r.id} className={`pf-row pf-${r.status}`}>
            <div className="pf-row-head">
              <span className="pf-icon" aria-hidden="true">{STATUS_ICON[r.status] || "⚠️"}</span>
              <span className="pf-name">{r.name || r.id}</span>
              {r.category && <span className="pf-cat">{r.category}</span>}
            </div>
            {r.detail && <div className="pf-detail">{r.detail}</div>}
            {r.status !== "pass" && r.nextAction && (
              <div className="pf-next"><strong>Fix:</strong> {r.nextAction}</div>
            )}
          </div>
        ))}

        {!running && !rows.length && !error && (
          <div className="pf-detail">Nothing ran — check that you are signed in and the BFF is reachable.</div>
        )}
      </div>
    </DraggableModal>
  );
}
