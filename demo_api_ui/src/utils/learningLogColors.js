// demo_api_ui/src/utils/learningLogColors.js
/**
 * Color helpers for Learning Log — severity, category, correlation tint.
 */

const CATEGORY_HUES = {
  oauth: "#2563eb",
  token_exchange: "#7c3aed",
  mcp: "#0891b2",
  delegation: "#db2777",
  hitl: "#ea580c",
  authorize: "#059669",
  gateway_path: "#4f46e5",
  threshold: "#ca8a04",
  introspection: "#0d9488",
  helix: "#9333ea",
  agent: "#0284c8",
  agent_prompt: "#0369a1",
  session: "#64748b",
  jwks: "#78716c",
  auth_lifecycle: "#475569",
  config: "#71717a",
};

/**
 * @param {string} severity
 * @returns {{ stripe: string, badge: string, glyph: string }}
 */
export function severityStyle(severity) {
  const s = String(severity || "info").toLowerCase();
  if (s === "error") {
    return { stripe: "#ef4444", badge: "#ef4444", glyph: "❌" };
  }
  if (s === "warn" || s === "warning") {
    return { stripe: "#f59e0b", badge: "#f59e0b", glyph: "⚠️" };
  }
  if (s === "debug") {
    return { stripe: "#94a3b8", badge: "#64748b", glyph: "" };
  }
  return { stripe: "#2563eb", badge: "#334155", glyph: "✅" };
}

/**
 * @param {string} category
 * @returns {string}
 */
export function categoryColor(category) {
  return CATEGORY_HUES[category] || "#64748b";
}

/**
 * Stable pastel wash from a correlation id.
 * @param {string | null | undefined} id
 * @returns {string | null} CSS background color or null
 */
export function correlationTint(id) {
  if (!id) return null;
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsla(${hue}, 55%, 92%, 0.95)`;
}

/**
 * Resolve correlation id from Learn or Debug row shapes.
 * @param {object} row
 * @returns {string | null}
 */
export function resolveCorrelationId(row) {
  if (!row || typeof row !== "object") return null;
  return (
    row.correlationId ||
    row.flowId ||
    row.requestId ||
    row.metadata?.correlationId ||
    row.metadata?.flowId ||
    null
  );
}
