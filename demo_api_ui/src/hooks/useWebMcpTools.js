// useWebMcpTools — WebMCP mock surface for the /webmcp explainer page.
//
// Coverage plan row "WebMCP (Google)" — MOCK: expose two banking tools through
// the WebMCP proposal surface so the browser-agent path is visible in the demo.
// When the browser implements navigator.modelContext (Chrome flag / future
// builds), the page registers two READ-ONLY tools the user's own in-browser
// agent can call, session-cookie authenticated like any BFF call. Browsers
// without the API get a clear "not available here" card instead — the demo
// never fakes a working registration.

import { useEffect, useState } from 'react';

const TOOLS = [
  {
    name: 'get_my_accounts',
    description: 'List the signed-in demo customer’s bank accounts (read-only).',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const res = await fetch('/api/accounts/my', { credentials: 'include' });
      const data = await res.json();
      return JSON.stringify(data);
    },
  },
  {
    name: 'get_my_transactions',
    description: 'List the signed-in demo customer’s recent transactions (read-only).',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const res = await fetch('/api/transactions/my', { credentials: 'include' });
      const data = await res.json();
      return JSON.stringify(data);
    },
  },
];

export function useWebMcpTools() {
  const [supported] = useState(() => typeof navigator !== 'undefined' && !!navigator.modelContext);
  const [registered, setRegistered] = useState([]);

  useEffect(() => {
    if (!navigator?.modelContext?.registerTool) return undefined;
    // registerTool is expected to be idempotent per name; the page may remount.
    for (const tool of TOOLS) {
      try {
        navigator.modelContext.registerTool(tool);
      } catch {
        // A browser that accepts the API but rejects registration is treated
        // as unsupported rather than half-registered.
        return undefined;
      }
    }
    setRegistered(TOOLS.map((t) => t.name));
    return () => setRegistered([]);
  }, []);

  return { supported, registered, tools: TOOLS };
}
