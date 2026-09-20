import { PROVENANCE } from "../../learning/provenance";

const LABELS = Object.freeze({
  [PROVENANCE.LIVE_CLOUD]: "LIVE CLOUD",
  [PROVENANCE.LIVE_LOCAL]: "LIVE LOCAL",
  [PROVENANCE.RECORDED]: "RECORDED",
  [PROVENANCE.SIMULATED]: "SIMULATED",
});

export default function LessonProvenanceBadge({ provenance, detail }) {
  const label = LABELS[provenance] || (provenance ? provenance : "PREFERRED");

  return (
    <div className="lesson-shell__provenance" data-provenance={provenance || "PREFERRED"}>
      <span className="lesson-shell__provenance-label">{label}</span>
      {detail && <span className="lesson-shell__provenance-detail">{detail}</span>}
    </div>
  );
}
