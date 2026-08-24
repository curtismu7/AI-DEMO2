// Polls GET /api/mcp/audit/mine — the signed-in user's own external-door MCP
// calls (LM Studio, or any direct client, calling Agent Gateway outside the
// BFF chat pipeline). Same 15s-poll shape as TokenChainContext's own poller,
// deliberately independent of it: this data has nothing to do with a BFF
// chat run, so it gets its own small hook rather than another field bolted
// onto that already-large context.
import { useEffect, useRef, useState } from "react";
import apiClient from "../services/apiClient";

const POLL_INTERVAL_MS = 15000;

export function useExternalDoorAudit({ enabled = true } = {}) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await apiClient.get("/api/mcp/audit/mine", { _silent: true });
        if (!cancelled) {
          setEvents(Array.isArray(res.data) ? res.data : []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load external-door activity");
      } finally {
        if (!cancelled) timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled]);

  return { events, error };
}
