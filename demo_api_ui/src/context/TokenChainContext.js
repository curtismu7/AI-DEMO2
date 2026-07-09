// banking_api_ui/src/context/TokenChainContext.js
//
// Shares live RFC 8693 token chain events across the UI.
// Events are produced by callMcpTool() (bankingAgentService) and consumed by
// TokenChainPanel and BankingAgent (inline chat messages).
// Also provides resolvedIdentity — friendly user/actor labels derived from the
// current BFF session, cached here so all token surfaces share one fetch.
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { isTokenChainRoute } from "../utils/embeddedAgentFabVisibility";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";

const TokenChainContext = createContext(null);

const TOKEN_CHAIN_HISTORY_KEY = "tokenChainHistory";
// Tracks which principal (user sub) owns the persisted history, so a
// different user logging in on the same browser cannot see stale history.
const TOKEN_CHAIN_HISTORY_OWNER_KEY = "tokenChainHistoryOwner";
// Persisted MCP tool-call history. The server-side audit stores (MCP server +
// BFF) are in-memory and wiped on every pod restart, so a plain poll would blank
// the MCP Results panel after any restart. We accumulate server results here
// (same per-principal ownership guard as the token chain) so past tool calls
// survive restarts. Owner is tracked by TOKEN_CHAIN_HISTORY_OWNER_KEY (shared).
const MCP_TOOL_CALLS_HISTORY_KEY = "mcpToolCallsHistory";
const MCP_HISTORY_CAP = 50;

// Production loop defenses: prevent infinite polling and event repetition
const POLL_MAX_CONSECUTIVE_FAILURES = 5; // Stop polling after N failures
const POLL_BACKOFF_MULTIPLIER = 1.5; // Exponential backoff factor
const POLL_MAX_BACKOFF_MS = 120000; // Cap backoff at 2 minutes
const POLL_BASE_INTERVAL_MS = 15000; // 15 seconds
const EVENT_MAX_AGE_MS = 3600000; // 1 hour — discard stale events

// Stable identity for an MCP tool-call record. Server/poll entries carry a real
// `id`; live SSE entries use a synthetic `sse-*` id and are reconciled by the
// next poll, so they never persist (only poll results feed history).
function mcpCallKey(call) {
  return call && (call.id || `${call.toolName}|${call.timestamp}`);
}

// Merge incoming tool calls into an existing list: incoming wins on key
// collision (fresher status), entries unique to `existing` are retained
// (this is what survives a restart). Sorted oldest-first to cap to the newest
// MCP_HISTORY_CAP entries, then reversed so the list reads newest-first.
function mergeMcpToolCalls(existing, incoming) {
  const byKey = new Map();
  for (const c of existing || []) byKey.set(mcpCallKey(c), c);
  for (const c of incoming || []) byKey.set(mcpCallKey(c), c);
  return Array.from(byKey.values())
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .slice(-MCP_HISTORY_CAP)
    .reverse();
}

export function TokenChainProvider({ children, activePath = "" }) {
  // Array of token event objects — latest tool call only (replaced on each call)
  const [events, setEvents] = useState([]);
  // NL routing info for the current request — set before token events arrive (step 0)
  const [nlRoutingEvent, setNlRoutingEventState] = useState(null);
  // Current login token set — the user access token plus the ID token and
  // refresh token issued at login (OIDC / RFC 6749). Shown when no tool events
  // exist (e.g., on dashboard load). Each entry renders as its own card.
  const [sessionTokenEvents, setSessionTokenEvents] = useState([]);
  // MCP tool call delegation trail (fetched from /api/token-chain).
  // `liveMcpToolCalls` is the ephemeral view (poll replaces, SSE appends);
  // `mcpToolCallsHistory` is the persisted accumulation that survives restarts.
  // Consumers read the merged `mcpToolCalls` exposed on the context value.
  const [liveMcpToolCalls, setLiveMcpToolCalls] = useState([]);
  const [mcpToolCallsHistory, setMcpToolCallsHistory] = useState(() => {
    try {
      const stored = localStorage.getItem(MCP_TOOL_CALLS_HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  // Current BFF token validation mode ('introspection' | 'jwt' | null)
  const [validationMode, setValidationMode] = useState(null);
  const [mcpAuthMode, setMcpAuthMode] = useState("consumer");
  // Resolved identity — friendly user/actor names derived from current BFF session.
  // { currentUser: { sub, name, email } | null, knownClients: { [clientId]: label } }
  const [resolvedIdentity, setResolvedIdentity] = useState(null);
  // History: array of { tool, timestamp, events[] } — hydrated from localStorage on mount
  const [history, setHistory] = useState(() => {
    try {
      const stored = localStorage.getItem(TOKEN_CHAIN_HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Loop defense: use useRef for dedup memory and failure tracking to avoid re-renders on every dedup hit.
  // useRef persists across renders without triggering re-renders; closure vars are simpler than state + closure dual-write.
  const pollStateRef = useRef({ failureCount: 0, interval: POLL_BASE_INTERVAL_MS });

  // Write-through to localStorage (debounced 300ms to avoid thrashing on rapid tool calls)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(TOKEN_CHAIN_HISTORY_KEY, JSON.stringify(history));
      } catch (e) {
        console.warn("[TokenChain] localStorage write failed:", e.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [history]);

  // Write-through the persisted MCP tool-call history (debounced, same as above).
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          MCP_TOOL_CALLS_HISTORY_KEY,
          JSON.stringify(mcpToolCallsHistory),
        );
      } catch (e) {
        console.warn("[TokenChain] MCP history write failed:", e.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [mcpToolCallsHistory]);

  /**
   * Called by bankingAgentService after each MCP tool call.
   * Replaces current events and prepends to history.
   *
   * @param {string} tool
   * @param {Array<{ id, label, status, decoded, explanation, credentialPath?, specRef?, ... }>} newEvents
   *   credentialPath: 'oauth_bearer' | 'api_key' | 'dual_token' — Phase 266
   *   When absent, downstream renderers default to 'oauth_bearer'.
   *   specRef: e.g. 'RFC 6750 §3', 'RFC 8693', 'RFC 8693 + draft-ietf-oauth-identity-chaining' — Phase 266 R3
   *   Used by TokenChainDisplay to render spec-citation pills with hover/click explainers.
   */
  const setTokenEvents = useCallback(
    (tool, newEvents) => {
      tokenChainTraceStore.ingestTokenEvents(Array.isArray(newEvents) ? newEvents : []);
      if (!Array.isArray(newEvents) || newEvents.length === 0) {
        // A real tool call that produced no events (e.g. failed before any
        // step). Do NOT keep the previous call's chain on screen with the
        // live dot — that misrepresents stale data as the current call. Clear
        // the live view; skip the empty history entry (nothing to record).
        setEvents([]);
        setSessionTokenEvents([]);
        return;
      }
      // Always persist to history so it's available when the user navigates to a token-chain page.
      setHistory((prev) => [
        { tool, timestamp: new Date().toISOString(), events: newEvents },
        ...prev.slice(0, 19),
      ]);
      // Always update live events — float agent and floating token-chain panel
      // are visible on any route, not only isTokenChainRoute pages.
      setEvents(newEvents);
      setSessionTokenEvents([]);
    },
    // Body uses only stable state setters — no activePath dependency. Listing
    // activePath here churned this callback's identity on every route change,
    // recreating the context value and re-rendering all consumers.
    [],
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
    setNlRoutingEventState(null);
    setSessionTokenEvents([]);
  }, []);

  /** Record the NL routing step (prompt + source + intent) for display as step 0 in the chain. */
  const setNlRoutingEvent = useCallback((event) => {
    setNlRoutingEventState(event);
  }, []);

  /**
   * Seed the session token card(s) shown on the dashboard before any tool calls.
   * Accepts a single event or an array (the login token set: user access token,
   * ID token, refresh token). Normalized to an array so each renders as its own card.
   */
  const setSessionToken = useCallback((tokenEventOrEvents) => {
    const next = Array.isArray(tokenEventOrEvents)
      ? tokenEventOrEvents.filter(Boolean)
      : tokenEventOrEvents
        ? [tokenEventOrEvents]
        : [];
    setSessionTokenEvents(next);
  }, []);

  /** Clears history from both state and localStorage (called on logout). */
  const clearHistory = useCallback(() => {
    setHistory([]);
    setEvents([]);
    setNlRoutingEventState(null);
    setSessionTokenEvents([]);
    setLiveMcpToolCalls([]);
    setMcpToolCallsHistory([]);
    pollStateRef.current = { failureCount: 0, interval: POLL_BASE_INTERVAL_MS };
    try {
      localStorage.removeItem(TOKEN_CHAIN_HISTORY_KEY);
      localStorage.removeItem(MCP_TOOL_CALLS_HISTORY_KEY);
      localStorage.removeItem(TOKEN_CHAIN_HISTORY_OWNER_KEY);
    } catch {}
  }, []);

  /** Clears only the MCP tool-call results (live + persisted). Wired to the
   *  Clear button on the MCP Results tab; leaves token-chain history intact. */
  const clearMcpToolCalls = useCallback(() => {
    setLiveMcpToolCalls([]);
    setMcpToolCallsHistory([]);
    try {
      localStorage.removeItem(MCP_TOOL_CALLS_HISTORY_KEY);
    } catch {}
  }, []);

  // Fetch MCP tool calls from /api/token-chain — only after authentication and
  // only on routes that actually render token-chain UI.
  // Includes production loop defenses: exponential backoff and max failures.
  useEffect(() => {
    let cancelled = false;
    let pollInterval = null;
    let pollActive = false;
    const state = pollStateRef.current;

    const stopPolling = () => {
      pollActive = false;
      if (pollInterval) {
        clearTimeout(pollInterval);
        pollInterval = null;
      }
    };

    const recordFailure = () => {
      state.failureCount++;
      if (state.failureCount >= POLL_MAX_CONSECUTIVE_FAILURES) {
        console.warn("[TokenChain] Poll failed", state.failureCount, "times — stopping");
        stopPolling();
        return true;
      }
      // Exponential backoff: 15s → 22.5s → 33.75s ... capped at 2 min
      state.interval = Math.min(
        state.interval * POLL_BACKOFF_MULTIPLIER,
        POLL_MAX_BACKOFF_MS,
      );
      return false;
    };

    // The poll returns the authoritative full chain and REPLACES the live list,
    // so it must NOT be deduped against previously-seen keys — doing so made every
    // poll after the first return [], wiping the live view and freezing tool-call
    // status (pending -> success) forever. Only drop genuinely stale (>1h) events.
    const filterStaleEvents = (newList) => {
      if (!newList?.length) return newList;
      const now = Date.now();
      return newList.filter((call) => {
        if (call.timestamp) {
          const callTime = new Date(call.timestamp).getTime();
          if (now - callTime > EVENT_MAX_AGE_MS) return false;
        }
        return true;
      });
    };

    const fetchMCPToolCalls = async () => {
      if (!isTokenChainRoute(activePath)) {
        stopPolling();
        return;
      }
      try {
        const res = await fetch("/api/token-chain", {
          credentials: "include",
          _silent: true,
        });
        if (!res.ok) {
          if (recordFailure()) return;
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          // Reset backoff on success
          state.failureCount = 0;
          state.interval = POLL_BASE_INTERVAL_MS;
          let serverList = data.mcpToolCallsChain || [];
          serverList = filterStaleEvents(serverList);
          setLiveMcpToolCalls(serverList);
          if (serverList.length) {
            setMcpToolCallsHistory((prev) =>
              mergeMcpToolCalls(prev, serverList),
            );
          }
          if (data.validationMode) setValidationMode(data.validationMode);
          if (data.metadata?.mcpAuthMode) setMcpAuthMode(data.metadata.mcpAuthMode);
        }
      } catch (err) {
        if (recordFailure()) return;
        console.debug("[TokenChain] /api/token-chain poll failed:", err?.message);
      }
    };

    // Self-rescheduling timer (not setInterval) so each tick reads the CURRENT
    // state.interval — recordFailure's exponential backoff is otherwise ignored
    // because setInterval captures the delay once at creation. pollActive guards
    // against spawning parallel loops when startPolling is called repeatedly.
    const scheduleNextPoll = async () => {
      if (!pollActive || cancelled) return;
      await fetchMCPToolCalls();
      if (!pollActive || cancelled || !isTokenChainRoute(activePath)) return;
      pollInterval = setTimeout(scheduleNextPoll, state.interval);
    };

    const startPolling = () => {
      if (!isTokenChainRoute(activePath)) {
        stopPolling();
        return;
      }
      if (pollActive) return;
      pollActive = true;
      void scheduleNextPoll();
    };

    const syncPollingForRoute = () => {
      if (isTokenChainRoute(activePath)) {
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Only start polling after confirming authentication to avoid 401 noise.
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.authenticated && !cancelled) syncPollingForRoute();
      })
      .catch(() => {});

    window.addEventListener("userAuthenticated", startPolling);

    return () => {
      cancelled = true;
      stopPolling();
      window.removeEventListener("userAuthenticated", startPolling);
    };
  }, [activePath]);

  // Real-time MCP result updates via SSE — APPEND new result so live order
  // matches the server's chronological (oldest-first) order. Previously this
  // prepended newest-first while the 15s poll replaced the list oldest-first,
  // so the displayed call order flipped depending on data source. We also no
  // longer fabricate chainIndex from array length (collides/skips vs the
  // server ordinal) nor assert scopes:[] / isDelegated:false (which positively
  // misstated a delegated, scoped call as "Direct user token, no scopes" until
  // the next poll). Unknown fields are left undefined so the UI can render
  // "pending poll" rather than a false negative.
  useEffect(() => {
    const handler = (e) => {
      const data = e.detail;
      if (!data || !data.toolName) return;
      // Append to the live view only. SSE entries are provisional (synthetic
      // sse-* id); the next /api/token-chain poll returns the authoritative
      // record and is what gets accumulated into the persisted history.
      setLiveMcpToolCalls((prev) => {
        const lastIdx = prev.reduce(
          (max, c) =>
            typeof c.chainIndex === "number" && c.chainIndex > max
              ? c.chainIndex
              : max,
          -1,
        );
        return [
          ...prev,
          {
            id: `sse-${Date.now()}`,
            timestamp: data.timestamp || new Date().toISOString(),
            toolName: data.toolName,
            status: data.status || "success",
            duration: data.duration || 0,
            chainIndex: lastIdx + 1,
            // Unknown until the authoritative poll arrives — do not assert.
            isDelegated:
              typeof data.isDelegated === "boolean"
                ? data.isDelegated
                : undefined,
            scopes: Array.isArray(data.scopes) ? data.scopes : undefined,
            pendingServerSync: true,
            requestJson: data.requestJson || null,
            resultJson: data.resultJson || null,
            resultSummary: data.resultSummary || null,
          },
        ];
      });
    };
    window.addEventListener("mcp-tool-result-sse", handler);
    return () => window.removeEventListener("mcp-tool-result-sse", handler);
  }, []);

  // Inject synthetic token events from external sources (e.g. kill switch, introspection denied).
  // Bypasses the isTokenChainRoute check so events appear immediately in any open Token Chain modal.
  useEffect(() => {
    const handler = (e) => {
      const { tool, events: injectedEvents } = e.detail || {};
      if (
        !tool ||
        !Array.isArray(injectedEvents) ||
        injectedEvents.length === 0
      )
        return;
      setHistory((prev) => [
        { tool, timestamp: new Date().toISOString(), events: injectedEvents },
        ...prev.slice(0, 19),
      ]);
      setEvents(injectedEvents);
      setSessionTokenEvents([]);
    };
    window.addEventListener("token-chain-inject", handler);
    return () => window.removeEventListener("token-chain-inject", handler);
  }, []);

  /** Fetch resolved identity once on mount (and on re-auth). Shared across all token surfaces. */
  const loadResolvedIdentity = useCallback(async () => {
    try {
      // Check session first; only load config if authenticated to avoid 401 loop
      const sessionRes = await fetch("/api/auth/session", {
        credentials: "include",
      });
      if (!sessionRes.ok) {
        // Not authenticated — skip config to avoid 401 loop
        setResolvedIdentity({ currentUser: null, knownClients: {} });
        return;
      }
      const configRes = await fetch("/api/pingone-test/config", {
        credentials: "include",
      });
      const sessionData = await sessionRes.json();
      const configData = configRes.ok ? await configRes.json() : null;
      const identity = { currentUser: null, knownClients: {} };
      if (sessionData?.authenticated && sessionData.user) {
        const u = sessionData.user;
        const name =
          [u.firstName, u.lastName].filter(Boolean).join(" ") ||
          u.email ||
          u.username ||
          "";
        identity.currentUser = { sub: u.id, name, email: u.email };
      }
      if (configData) {
        const clientLabels = {
          adminClientId: "AI Demo BFF (Admin)",
          userClientId: "AI Demo BFF (User)",
          mcpTokenExchangerClientId: "MCP Token Exchanger",
          aiAgentClientId: "AI Agent",
        };
        for (const [key, label] of Object.entries(clientLabels)) {
          const id = configData[key];
          if (id) identity.knownClients[id] = label;
        }
      }
      setResolvedIdentity(identity);
    } catch {
      /* non-fatal — falls back to raw UUIDs */
    }
  }, []);

  useEffect(() => {
    void loadResolvedIdentity();
  }, [loadResolvedIdentity]);

  // Identity-ownership guard: token-chain history is per-principal. If the
  // resolved current user differs from the principal that owns the persisted
  // history (e.g. user A logged out without a clean clearHistory — tab close,
  // session-expiry redirect — then user B logged in on the same browser),
  // wipe the stale history so user B never sees user A's tool calls and
  // decoded sub/scope claims. Owner sub is tracked in its own localStorage key
  // (the history payload itself is never trusted for ownership).
  useEffect(() => {
    const sub = resolvedIdentity?.currentUser?.sub || null;
    if (!sub) return; // unauthenticated / not yet resolved — leave as-is
    let owner = null;
    try {
      owner = localStorage.getItem(TOKEN_CHAIN_HISTORY_OWNER_KEY);
    } catch {}
    if (owner && owner !== sub) {
      // Different principal — clear everything tied to the previous user.
      setHistory([]);
      setEvents([]);
      setNlRoutingEventState(null);
      setSessionTokenEvents([]);
      setLiveMcpToolCalls([]);
      setMcpToolCallsHistory([]);
      try {
        localStorage.removeItem(TOKEN_CHAIN_HISTORY_KEY);
        localStorage.removeItem(MCP_TOOL_CALLS_HISTORY_KEY);
      } catch {}
    }
    if (owner !== sub) {
      try {
        localStorage.setItem(TOKEN_CHAIN_HISTORY_OWNER_KEY, sub);
      } catch {}
    }
  }, [resolvedIdentity]);

  // Re-fetch identity after login (e.g., session expiry re-auth)
  useEffect(() => {
    const onAuth = () => void loadResolvedIdentity();
    window.addEventListener("userAuthenticated", onAuth);
    return () => window.removeEventListener("userAuthenticated", onAuth);
  }, [loadResolvedIdentity]);

  const value = useMemo(() => {
    // Use tool events if available, otherwise show session token
    const displayEvents =
      events.length > 0
        ? events
        : sessionTokenEvents.length > 0
          ? sessionTokenEvents
          : [];
    // Merge persisted history with the live view (live wins on key collision
    // for fresh status; history-only entries — e.g. from before a restart —
    // are retained) so the MCP Results panel shows the full accumulated trail.
    const mcpToolCalls = mergeMcpToolCalls(mcpToolCallsHistory, liveMcpToolCalls);
    return {
      events: displayEvents,
      nlRoutingEvent,
      history,
      mcpToolCalls,
      validationMode,
      mcpAuthMode,
      resolvedIdentity,
      setTokenEvents,
      clearEvents,
      setNlRoutingEvent,
      setSessionToken,
      clearHistory,
      clearMcpToolCalls,
    };
  }, [
    events,
    nlRoutingEvent,
    sessionTokenEvents,
    history,
    mcpToolCallsHistory,
    liveMcpToolCalls,
    validationMode,
    mcpAuthMode,
    resolvedIdentity,
    setTokenEvents,
    clearEvents,
    setNlRoutingEvent,
    setSessionToken,
    clearHistory,
    clearMcpToolCalls,
  ]);

  return (
    <TokenChainContext.Provider value={value}>
      {children}
    </TokenChainContext.Provider>
  );
}

export function useTokenChain() {
  const ctx = useContext(TokenChainContext);
  if (!ctx) {
    throw new Error("useTokenChain must be used within TokenChainProvider");
  }
  return ctx;
}

/** Safe hook — returns null outside provider (e.g. tests) */
export function useTokenChainOptional() {
  return useContext(TokenChainContext);
}
