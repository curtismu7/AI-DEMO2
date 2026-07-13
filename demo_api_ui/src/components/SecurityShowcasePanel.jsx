import React, { useState } from "react";
import "./SecurityShowcasePanel.css";
import { chipPermState } from "../utils/chipPermissions";

// Join truthy class names with spaces (skips false/null/"" branches).
const cx = (...xs) => xs.filter(Boolean).join(" ");

// Manifest-driven "Security Showcase" — a curated, all-verticals set of chips that
// each fire ONE security behavior live (defense or attack) against the real
// pipeline. Rendered as a single panel with Defenses / AI Reasoning / Attacks
// tabs (manifest `dashboard.securityShowcase.tabs`). Clicks go through the same
// onChipClick contract as the regular chip rail, carrying the chip's `showcase`
// action key + presenter `caption` so AIAgent can dispatch the right harness and
// append the plain-language outcome line.
export default function SecurityShowcasePanel({
  securityShowcase,
  onChipClick,
  isLoading,
  llmAvailable = true,
  isHelixMode = false,
  isAdmin = false,
  toolPermissions = {},
  toolsError = false,
  onDeniedChip,
}) {
  const allTabs = Array.isArray(securityShowcase?.tabs) ? securityShowcase.tabs : [];
  // adminOnly tabs (e.g. PingOne Admin) are hidden for non-admins.
  const tabs = allTabs.filter((t) => !t.adminOnly || isAdmin);
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id || null);
  if (!tabs.length) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const isAttacks = activeTab?.id === "attacks";
  // PingOne Admin chips call the hosted PingOne MCP server (worker token) via the
  // existing pingone-admin path keyed on chip id — they are not user-LLM-gated.
  const isPingoneTab = activeTab?.id === "pingone";

  return (
    <div className="banking-chips-dropdown__section sec-showcase">
      <div className="banking-chips-dropdown__label sec-showcase__label">
        <span className="sec-showcase__shield" aria-hidden="true">🛡</span>
        Security Showcase
      </div>
      <div className="sec-showcase__tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTab.id}
            className={cx(
              "sec-showcase__tab",
              tab.id === activeTab.id && "sec-showcase__tab--on",
              tab.id === "attacks" && "sec-showcase__tab--attacks",
            )}
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.label}
            <span className="sec-showcase__tab-count">{(tab.chips || []).length}</span>
          </button>
        ))}
      </div>
      <div
        className={cx(
          "banking-chips-dropdown__grid banking-chips-dropdown__grid--heuristic sec-showcase__grid",
          isAttacks && "sec-showcase__grid--attacks",
        )}
        role="tabpanel"
      >
        {(activeTab.chips || []).map((chip) => {
          const isLlm = chip.mode === "llm" && !isPingoneTab;
          const llmDisabled = isLlm && !llmAvailable;
          const perm = chipPermState(chip, toolPermissions, toolsError);
          if (!perm.show) return null;
          const deniedReason = perm.denied
            ? perm.reason || "not permitted by Authorize for the current scope"
            : null;
          const chipTitle = perm.unverified
            ? "Authorize unavailable — couldn't reach PingOne or the demo authorize server. Retry shortly."
            : perm.denied
            ? `Denied by Authorize: ${deniedReason}`
            : llmDisabled
            ? "Needs an LLM — switch to llama.cpp, Anthropic, or Helix mode"
            : chip.caption || chip.message;
          return (
            <button
              type="button"
              key={chip.id}
              data-chip-id={chip.id}
              data-showcase={chip.showcase || undefined}
              className={cx(
                "banking-chips-dropdown__button sec-showcase__chip",
                `sec-showcase__chip--${activeTab.id}`,
                perm.denied && "banking-chips-dropdown__button--denied",
                perm.unverified && "banking-chips-dropdown__button--unverified",
              )}
              onClick={() => {
                if (perm.denied) {
                  if (onDeniedChip) onDeniedChip({ id: chip.id, label: chip.label, tool: chip.tool }, deniedReason);
                  return;
                }
                if (onChipClick) {
                  onChipClick({
                    message: chip.message,
                    label: chip.label,
                    requiresLlm: isLlm,
                    chipId: chip.id,
                    direct: chip.mode === "direct",
                    showcase: chip.showcase,
                    caption: chip.caption,
                    stepUpMethod: chip.stepUpMethod,
                    denyTool: chip.denyTool,
                    useCaseId: chip.useCaseId,
                  });
                }
              }}
              aria-disabled={perm.denied || undefined}
              disabled={isLoading || llmDisabled || perm.unverified}
              title={chipTitle}
            >
              {chip.label}
              {isPingoneTab && <span className="banking-chips-dropdown__mcp-badge">MCP</span>}
              {isLlm && isHelixMode && <span className="banking-chips-dropdown__helix-badge">Helix</span>}
              {isLlm && !isHelixMode && <span className="banking-chips-dropdown__mcp-badge">LLM</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
