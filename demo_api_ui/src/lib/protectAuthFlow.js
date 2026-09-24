import { decodeJWT } from "../services/tokenInspector";

export const PROTECT_AUTH_FLOW_KEY = "protect-auth-flow-v1";
const PROTECT_FLOW_TTL_MS = 10 * 60 * 1000;

function discardFlowMarker() {
  try { sessionStorage.removeItem(PROTECT_AUTH_FLOW_KEY); } catch { /* storage may be unavailable */ }
}

export function readProtectAuthFlow() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PROTECT_AUTH_FLOW_KEY) || "null");
    const now = Date.now();
    if (
      parsed?.version === 1 &&
      typeof parsed.flowId === "string" && parsed.flowId &&
      typeof parsed.userId === "string" && parsed.userId.trim() &&
      Number.isFinite(parsed.issuedAt) &&
      parsed.issuedAt <= now + 60_000 && now - parsed.issuedAt <= PROTECT_FLOW_TTL_MS
    ) {
      return { ...parsed, returnTo: parsed.returnTo === "product" ? "product" : "popout" };
    }
  } catch {
    // Malformed or unavailable session storage is treated as an ordinary OIDC callback.
  }
  discardFlowMarker();
  return null;
}

export function protectIdentityMatches(evaluatedUserId, idToken) {
  if (typeof evaluatedUserId !== "string" || !evaluatedUserId.trim()) return false;
  const decoded = decodeJWT(idToken);
  if (!decoded.isValid || !decoded.payload || typeof decoded.payload !== "object") return false;
  const expected = evaluatedUserId.trim().toLocaleLowerCase();
  return [decoded.payload.email, decoded.payload.preferred_username, decoded.payload.username]
    .some((value) => typeof value === "string" && value.trim().toLocaleLowerCase() === expected);
}

export function protectAuthReturnPath(flow, result) {
  const status = result === "success" ? "success" : "error";
  return flow?.returnTo === "product"
    ? "/ai-products/protect?result=" + status
    : "/protect-auth-demo?popout=1&result=" + status;
}

export function clearProtectAuthFlow() {
  discardFlowMarker();
}
