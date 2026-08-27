import React, { useState } from "react";
import TokenChainFilmstrip from "./TokenChainFilmstrip";

/**
 * ReelDock — the pinned movie reel.
 *
 * `.tcfs-float-host` is sticky to the bottom of the viewport and capped at 40vh
 * (see TokenChainFilmstrip.css). That is a lot of screen in float and dock mode,
 * whose whole point is an unobstructed dashboard, so the dock carries a collapse
 * toggle: collapsed leaves only the bar, still pinned, one click from the reel.
 *
 * Collapsed state is session-only React state and is NEVER written to storage,
 * and it defaults to EXPANDED. A persisted "hidden" is exactly how the reel
 * disappeared for a whole browser profile in PR #1896 — across reloads, deploys
 * and demos, with no self-heal. A reload must always bring the reel back.
 *
 * Also the one place the wrapper markup lives: it was copy-pasted at three call
 * sites, and `.tcfs` is display:contents, so the reel needs this grid host to
 * lay out at all.
 */
export default function ReelDock() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={`tcfs-float-host${collapsed ? " tcfs-float-host--collapsed" : ""}`}
    >
      <button
        type="button"
        className="tcfs-dock-toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
        title={
          collapsed
            ? "Show the token chain reel"
            : "Collapse the token chain reel — it returns on reload"
        }
      >
        {collapsed ? "Show token chain" : "Collapse token chain"}
      </button>
      <TokenChainFilmstrip />
    </div>
  );
}
