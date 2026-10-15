import { useEffect, useState } from "react";
import { resolveApiBaseUrl } from "../../utils/resolveApiBaseUrl";

const MAX = 5;

// Subscribes to the signed-in user's live OBO events (Claude Code's calls). Newest first.
export default function useOboLive(enabled) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return undefined;
    let es;
    try { es = new EventSource(`${resolveApiBaseUrl()}/api/obo/events`, { withCredentials: true }); } catch (_e) { return undefined; }
    es.onmessage = (msg) => {
      let ev;
      try { ev = JSON.parse(msg.data); } catch (_e) { return; }
      setEvents((prev) => [ev, ...prev].slice(0, MAX));
    };
    // No onerror handler: the browser reconnects on its own, and the BFF replays the last 5 events on connect.
    return () => { try { es.close(); } catch (_e) { /* already closed */ } };
  }, [enabled]);
  return events;
}
