// demo_api_ui/src/hooks/useAgentSurfaceHost.js
// Registers a DOM node as the BankingAgent portal host (same pattern as TalkPane).
import { useCallback, useEffect, useState } from "react";
import { useAgentUiMode } from "../context/AgentUiModeContext";

/**
 * @param {{ autoOpen?: boolean }} [opts]
 * @returns {(node: HTMLElement | null) => void}
 */
export function useAgentSurfaceHost({ autoOpen = true } = {}) {
  const { setSurfaceHostEl } = useAgentUiMode();
  const [hostEl, setHostEl] = useState(null);
  const hostRef = useCallback((node) => setHostEl(node), []);

  useEffect(() => {
    setSurfaceHostEl(hostEl);
    return () => setSurfaceHostEl((cur) => (cur === hostEl ? null : cur));
  }, [hostEl, setSurfaceHostEl]);

  useEffect(() => {
    if (!autoOpen || !hostEl) return undefined;
    const t = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("banking-agent-open"));
    }, 80);
    return () => clearTimeout(t);
  }, [autoOpen, hostEl]);

  return hostRef;
}
