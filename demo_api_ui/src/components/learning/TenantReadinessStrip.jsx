import { useEffect, useState } from "react";
import { PROVENANCE } from "../../learning/provenance";
import { getTenantReadiness } from "../../services/lessonExecutionService";
import "./TenantReadinessStrip.css";

const PROVENANCE_LABELS = Object.freeze({
  [PROVENANCE.LIVE_CLOUD]: "LIVE CLOUD",
  [PROVENANCE.LIVE_LOCAL]: "LIVE LOCAL",
  [PROVENANCE.RECORDED]: "RECORDED",
  [PROVENANCE.SIMULATED]: "SIMULATED",
});

function checkedTime(value) {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Check time unavailable";
  return `Checked ${date.toLocaleTimeString()}`;
}

export default function TenantReadinessStrip({
  loadReadiness = getTenantReadiness,
  pollIntervalMs = 30000,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loadState, setLoadState] = useState("loading");

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const next = await loadReadiness();
        if (!active) return;
        setSnapshot(next);
        setLoadState("loaded");
      } catch {
        if (!active) return;
        setSnapshot(null);
        setLoadState("error");
      }
    };

    load();
    const interval =
      pollIntervalMs > 0 ? setInterval(load, pollIntervalMs) : null;
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, [loadReadiness, pollIntervalMs]);

  if (loadState === "loading") {
    return (
      <section
        className="tenant-readiness tenant-readiness--loading"
        aria-label="Tenant readiness"
      >
        <strong>Checking tenant readiness</strong>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section
        className="tenant-readiness tenant-readiness--error"
        aria-label="Tenant readiness"
      >
        <div>
          <strong>Readiness unavailable</strong>
          <span>Tenant readiness could not be checked.</span>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`tenant-readiness tenant-readiness--${snapshot.ready ? "ready" : "warning"}`}
      aria-label="Tenant readiness"
    >
      <div
        className="tenant-readiness__summary"
        role="status"
        aria-live="polite"
      >
        <strong>{snapshot.ready ? "Tenant ready" : "Needs attention"}</strong>
        <span>{snapshot.environment.label}</span>
        <time dateTime={snapshot.lastCheckedAt}>
          {checkedTime(snapshot.lastCheckedAt)}
        </time>
      </div>

      <ul className="tenant-readiness__dependencies">
        {snapshot.dependencies.map((item) => (
          <li
            key={item.id}
            className={`tenant-readiness__dependency tenant-readiness__dependency--${item.status}`}
          >
            <span className="tenant-readiness__label">{item.label}</span>
            <span className="tenant-readiness__detail">{item.detail}</span>
            <span
              className="tenant-readiness__provenance"
              data-provenance={item.provenance}
            >
              {PROVENANCE_LABELS[item.provenance] || item.provenance}
            </span>
          </li>
        ))}
      </ul>

      {snapshot.warnings.length > 0 && (
        <ul
          className="tenant-readiness__warnings"
          aria-label="Readiness warnings"
        >
          {snapshot.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
