/**
 * Shared participant palette for every use-case diagram. One look across all
 * UCs: role -> { label, bg }. bg is always a theme token so the diagrams are
 * light/dark aware. A new participant role starts here, not in a UC config.
 */
export const PARTICIPANT_GROUPS = {
  user: { label: "User", bg: "var(--th-status-info)" },
  agent: { label: "Agent", bg: "var(--th-bg-emphasis)" },
  gateway: { label: "Gateway", bg: "var(--th-status-warning)" },
  pingone: { label: "PingOne", bg: "var(--th-status-success)" },
  resource: { label: "Resource server", bg: "var(--th-border-strong)" },
  external: { label: "External", bg: "var(--th-text-faint)" },
};
