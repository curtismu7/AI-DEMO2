// PreviewBanner.jsx — shown at the top of every Agent Studio (Preview) page.
// Keeps the "this is simulated" framing and Platform Gaps link impossible to
// miss while clicking through screens that otherwise look fully functional.
import React from "react";
import { Link } from "react-router-dom";

export default function PreviewBanner() {
  return (
    <div className="asp-banner">
      Simulated preview — no real backend calls.{" "}
      <Link to="/platform-gaps">See Platform Gaps →</Link>
    </div>
  );
}
