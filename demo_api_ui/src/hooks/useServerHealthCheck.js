import { useCallback, useEffect, useState } from "react";

const DISMISSED_KEY = "demo_server_check_dismissed";

export function useServerHealthCheck() {
  const [downServers, setDownServers] = useState(null);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return;
    let cancelled = false;
    fetch("/api/health/demo-status", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const down = (data.servers || []).filter((s) => !s.up);
        setDownServers(down);
      })
      .catch(() => {
        if (cancelled) return;
        // Network error or server unreachable — don't assume both servers are
        // down; leave state as null (indeterminate) so the modal isn't shown
        // on transient network blips (e.g. laptop wake, offline).
        setDownServers(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markAllUp = useCallback(() => setDownServers([]), []);

  const dismissForSession = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDownServers([]);
  }, []);

  return { downServers, markAllUp, dismissForSession };
}
