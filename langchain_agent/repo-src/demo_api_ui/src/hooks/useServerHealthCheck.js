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
        setDownServers([
          {
            name: "Banking API Server",
            key: "api_server",
            up: false,
            startCmd: "cd demo_api_server && npm start",
            description: "Express BFF",
            port: 3001,
          },
          {
            name: "Banking MCP Server",
            key: "mcp_server",
            up: false,
            startCmd: "cd demo_mcp_server && npm run dev",
            description: "MCP tool server",
            port: 8080,
          },
        ]);
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
