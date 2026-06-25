/**
 * HitlSequencePage.jsx — /architecture/hitl
 *
 * Interactive sequence diagram for the HITL consent challenge flow.
 * Diagram and step-by-step panel are provided by HitlSequenceDiagram.js.
 * Source reference: hitl-sequence.mmd at the repo root.
 */
import HitlSequenceDiagram from "./HitlSequenceDiagram";
import { DiagramLegend } from "./diagram";

const HITL_PATHS = [
  { key: "homegrown", label: "Path 1 — Homegrown OTP",              color: "#bbf7d0", description: "BFF-generated HMAC OTP emailed directly. Feature flag: mode=homegrown." },
  { key: "onetime",   label: "Path 2 — PingOne One-Time (default)", color: "#bfdbfe", description: "PingOne sends OTP to user's email/phone on file. No enrolled device required. Feature flag: mode=onetime." },
  { key: "device",    label: "Path 3 — PingOne Device Picker",      color: "#fed7aa", description: "User picks from enrolled devices (EMAIL, SMS, FIDO2). Requires amount >= $500. Feature flag: mode=device_picker." },
];

export default function HitlSequencePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "1rem 1.5rem 0.75rem", flexShrink: 0 }}>
        <p style={{ fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280", margin: "0 0 0.2rem" }}>
          HITL Consent Challenge
        </p>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111827", margin: "0 0 0.4rem" }}>
          Sequence Diagram — All Paths
        </h1>
        <p style={{ color: "#6b7280", fontSize: "0.82rem", margin: "0 0 0.6rem" }}>
          Full request/response flow for the three HITL consent modes. Controlled by{" "}
          <code style={{ background: "#f3f4f6", padding: "0.1em 0.3em", borderRadius: 4 }}>hitl_consent_mfa_mode</code>{" "}
          config flag.
        </p>
        <DiagramLegend items={HITL_PATHS} />
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <HitlSequenceDiagram />
      </div>
    </div>
  );
}
