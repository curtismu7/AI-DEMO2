// banking_api_ui/src/components/AgentUiModeToggle.js
import React, { useCallback } from "react";
import { notifyInfo, notifyWarning } from "../utils/appToast";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { persistAgentUi } from "../services/demoScenarioService";
import { setDashboardLayout } from "../utils/dashboardLayout";
import "./AgentUiModeToggle.css";

/**
 * Middle / Float + optional FAB when embedded.
 * Persists to demo scenario when signed in; always updates localStorage via context.
 *
 * @param {'landing' | 'eduBar' | 'config'} props.variant
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel]
 */
export default function AgentUiModeToggle({
  variant = "config",
  className = "",
  ariaLabel,
}) {
  const { placement, fab, setAgentUi } = useAgentUiMode();
  const idPrefix = `agent-ui-${variant}`;

  const applyAndReload = useCallback(
    async (next, opts = { reload: true }) => {
      if (opts.reload) {
        // Write to localStorage only — do NOT update React context state here.
        // Updating context would move the FAB/dock immediately on screen (visual jump)
        // before the page reloads. The reload will re-init context from localStorage.
        try {
          localStorage.setItem("banking_agent_ui_v2", JSON.stringify(next));
        } catch (_) {}
      } else {
        setAgentUi(next);
      }
      const saved = await persistAgentUi(next);
      if (!saved) {
        notifyWarning(
          "Agent layout could not be saved on the server yet. It stays in this browser; refresh may revert if the server still has the old value.",
          { autoClose: 4500 },
        );
      }
      notifyInfo("Applying agent layout…", { autoClose: 1200 });
      if (opts.reload) {
        window.setTimeout(() => {
          window.location.reload();
        }, 350);
      }
    },
    [setAgentUi],
  );

  const handlePlacement = useCallback(
    async (p) => {
      if (p === placement) return;
      if (p === "middle") {
        setDashboardLayout("split3");
        await applyAndReload({ placement: "middle", fab }, { reload: false });
        return;
      }
      if (p === "bottom") {
        setDashboardLayout("default");
        await applyAndReload({ placement: "bottom", fab }, { reload: true });
        return;
      }
      await applyAndReload({ placement: "none", fab: true }, { reload: true });
    },
    [placement, fab, applyAndReload],
  );

  const handleFabToggle = useCallback(
    async (e) => {
      const checked = e.target.checked;
      if (placement === "none") return;
      await applyAndReload({ placement, fab: checked }, { reload: true });
    },
    [placement, applyAndReload],
  );

  const label =
    variant === "landing"
      ? "Agent"
      : variant === "eduBar"
        ? "Agent UI"
        : "Choose layout";

  const isLandingNav = variant === "landing";

  return (
    <div
      className={`agent-ui-mode-toggle agent-ui-mode-toggle--${variant} ${className}`.trim()}
      role="group"
      aria-label={
        ariaLabel ||
        (isLandingNav
          ? "AI banking agent: float"
          : "AI banking agent: embedded or float; optional FAB")
      }
    >
      <span className="agent-ui-mode-toggle__label" id={`${idPrefix}-legend`}>
        {label}
      </span>
      <div
        style={{
          display: "inline-flex",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <div
          className="agent-ui-mode-toggle__segmented"
          role="toolbar"
          aria-labelledby={`${idPrefix}-legend`}
        >
          {!isLandingNav && (
            <>
              <button
                type="button"
                className={`agent-ui-mode-toggle__btn${placement === "middle" ? " agent-ui-mode-toggle__btn--active" : ""}`}
                onClick={() => void handlePlacement("middle")}
                aria-pressed={placement === "middle"}
                title="Embedded assistant (Split dashboard: token | agent | banking)"
              >
                Embedded
              </button>
              <button
                type="button"
                className={`agent-ui-mode-toggle__btn${placement === "bottom" ? " agent-ui-mode-toggle__btn--active" : ""}`}
                onClick={() => void handlePlacement("bottom")}
                aria-pressed={placement === "bottom"}
                title="Bottom dock assistant (Full-width dashboard with agent at bottom)"
              >
                Bottom
              </button>
            </>
          )}

          <button
            type="button"
            className={`agent-ui-mode-toggle__btn${placement === "none" ? " agent-ui-mode-toggle__btn--active" : ""}`}
            onClick={() => void handlePlacement("none")}
            aria-pressed={placement === "none"}
            title="Floating FAB only (no embedded assistant)"
          >
            Float
          </button>
        </div>
        {placement !== "none" && (
          <label
            className="agent-ui-mode-toggle__fab"
            style={{
              marginLeft: "12px",
              display: "flex",
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={fab}
              onChange={(e) => void handleFabToggle(e)}
              aria-label="Always show float agent"
            />
            <span style={{ marginLeft: "6px" }}>Always float</span>
          </label>
        )}
      </div>
    </div>
  );
}
