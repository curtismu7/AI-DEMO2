import React, { useEffect, useState } from "react";
import DemoAuthzFallbackModal from "./DemoAuthzFallbackModal";
import sessionStorageService from "../services/sessionStorageService";

/**
 * App-root listener for the per-decision "PingOne Authorize fell back" signal.
 *
 * The BFF emits a structured `authorizeFallback` object on the transaction and
 * agent/MCP responses whenever a GENUINE live PingOne call fails and the
 * failover policy takes over. demoAgentService.emitAuthorizeFallback() turns
 * that into a window `authorize:fallback` CustomEvent. Mounting this once at the
 * app root surfaces the heads-up modal on BOTH surfaces (transactions + agent),
 * regardless of which page is mounted.
 *
 * Dedupes once per browser session via its OWN sessionStorage key — distinct
 * from AIAgent's discovery-degradation modal ("authzFallbackModalShown") so a
 * page-load discovery blip does not suppress this per-decision debug signal (and
 * vice versa). The two are different events; each shows at most once per session.
 */
const AUTHZ_FALLBACK_SHOWN_KEY = "authzPerDecisionFallbackShown";

export default function AuthorizeFallbackListener() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    function onFallback(e) {
      const alreadyShown =
        sessionStorageService.getItem(AUTHZ_FALLBACK_SHOWN_KEY, false) === true;
      if (alreadyShown) return;
      sessionStorageService.setItem(AUTHZ_FALLBACK_SHOWN_KEY, true);
      setDetail(e?.detail || null);
      setOpen(true);
    }
    window.addEventListener("authorize:fallback", onFallback);
    return () => window.removeEventListener("authorize:fallback", onFallback);
  }, []);

  return (
    <DemoAuthzFallbackModal
      open={open}
      detail={detail}
      onClose={() => setOpen(false)}
    />
  );
}
