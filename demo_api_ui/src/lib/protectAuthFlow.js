export const PROTECT_AUTH_FLOW_KEY = "protect-auth-flow-v1";

export function readProtectAuthFlow() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PROTECT_AUTH_FLOW_KEY) || "null");
    if (parsed?.version === 1 && typeof parsed.flowId === "string" && parsed.flowId) {
      return { ...parsed, returnTo: parsed.returnTo === "product" ? "product" : "popout" };
    }
  } catch {
    // Malformed or unavailable session storage is treated as an ordinary OIDC callback.
  }
  return null;
}

export function protectAuthReturnPath(flow, result) {
  const status = result === "success" ? "success" : "error";
  return flow?.returnTo === "product"
    ? "/ai-products/protect?result=" + status
    : "/protect-auth-demo?popout=1&result=" + status;
}

export function clearProtectAuthFlow() {
  try { sessionStorage.removeItem(PROTECT_AUTH_FLOW_KEY); } catch { /* session storage may be disabled */ }
}
