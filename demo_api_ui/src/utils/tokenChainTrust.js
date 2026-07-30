// demo_api_ui/src/utils/tokenChainTrust.js
// Shared DPoP / RAR trust-posture helpers for Token Chain surfaces.

/**
 * Returns true when a feature-flag API value is on.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFlagOn(value) {
  return value === true || value === "true";
}

/**
 * Derives Token Exchange, DPoP, and RAR posture from token-chain events (or tokenEvents).
 * Shape varies by mode — defensive field access matches TokenChainDisplay.
 * @param {Array<object>|null|undefined} events
 * @returns {{ jkt: string|null, details: object|null, dpopBound: boolean, rarScoped: boolean, exchanged: boolean, exchangeAudience: string|null }}
 */
export function deriveTrustPosture(events) {
  const evs = Array.isArray(events) ? events : [];
  const exchangeEv = evs.find((e) => e && e.id === "token-exchange");
  const dpopEv = evs.find((e) => e && (e.id === "dpop-binding" || e.cnf || e.claims?.cnf));
  const rarEv = evs.find((e) => e && (
    e.id === "rar-authorization"
    || e.id === "intent-binding-verified"
    || e.id === "sim-rar-grant"
    || e.id === "sim-rar-armed"
    || e.authorization_details
    || e.claims?.authorization_details
  ));
  const jkt = dpopEv?.cnf?.jkt || dpopEv?.claims?.cnf?.jkt || null;
  const details = rarEv?.authorization_details || rarEv?.claims?.authorization_details || null;
  const d0 = Array.isArray(details) ? details[0] : (details && typeof details === "object" ? details : null);
  return {
    jkt: jkt ? String(jkt) : null,
    details: d0,
    dpopBound: !!jkt,
    rarScoped: !!d0 || !!(rarEv && (rarEv.id === "intent-binding-verified" || rarEv.id === "sim-rar-grant")),
    exchanged: !!exchangeEv && !exchangeEv.failed,
    exchangeAudience: exchangeEv?.audience || null,
  };
}

/**
 * Trust tab is relevant for DPoP / RAR / Token Exchange use cases: flags armed, or live evidence.
 * @param {{ ffDpop?: boolean, ffRar?: boolean, events?: Array<object>|null }} opts
 * @returns {boolean}
 */
export function shouldShowTrustTab({ ffDpop = false, ffRar = false, events = null } = {}) {
  if (ffDpop || ffRar) return true;
  const posture = deriveTrustPosture(events);
  return posture.dpopBound || posture.rarScoped || posture.exchanged;
}
