import React from "react";
import ControlPlaneRoster from "../components/ControlPlaneRoster";

// Standalone page so ANY logged-in user (not just admins) can reach the AI
// Control Plane. Also embedded on the Admin Agent Safety tab for admins.
export default function AiControlPlanePage() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>
      <ControlPlaneRoster />
    </div>
  );
}
