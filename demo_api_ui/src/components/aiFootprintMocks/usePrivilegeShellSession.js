// Privilege MCP client session shared by every footprint costume: sign-in state,
// discovered tools, the latest tool run, and the chat transcript. Lives in
// FootprintLiveShellPage (one route for all skins) so a skin switch keeps it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../../services/apiClient";
import { navigateWithOverlay } from "../../utils/navigateWithOverlay";

import { LLM_POLICY_DENIED, chatReplyMessage, llmDenialMessage, llmReplyMessage } from "../privilege/privilegeChat";
import { requestAuthStart, isSilentAuthUrl } from "../privilege/privilegeAuth";
import { usePrivilegeRouting } from "../privilege/usePrivilegeRouting";

const API_BASE = "/api/privilege-mcp";
const SILENT_TRIED_KEY = "pvs_silent_signin_tried";

const request = (path, { method = "GET", body } = {}) =>
  (method === "POST"
    ? apiClient.post(`${API_BASE}${path}`, body)
    : apiClient.get(`${API_BASE}${path}`)
  ).then((r) => r.data);

export function errText(err) {
  return err?.response?.data?.error || err?.message || "Request failed";
}

// onBeforeConnect: runs just before every sign-in redirect (the Sign in button and a
// chat reply that asks for sign-in), so the page can remember what it was showing.
export function usePrivilegeShellSession({ onBeforeConnect } = {}) {
  // The load-time silent handshake runs in an effect that must not re-run per render, so
  // it reads the latest callback through a ref.
  const beforeConnectRef = useRef(onBeforeConnect);
  beforeConnectRef.current = onBeforeConnect;
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState("loading"); // loading | signed-out | ready
  const [scopes, setScopes] = useState([]);
  const [tools, setTools] = useState([]);
  const [latestCall, setLatestCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  // Force light/dark on the shell independent of the costume's own brightness.
  // Lives here (not in a view) so it survives a skin switch.
  const [pvsTheme, setPvsTheme] = useState("auto"); // auto | light | dark
  const cyclePvsTheme = useCallback(
    () => setPvsTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto")),
    [],
  );
  const nextId = useRef(1);
  const [notice, setNotice] = useState(() => {
    if (searchParams.get("auth") !== "error") return "";
    return `OAuth failed: ${searchParams.get("reason") || "unknown"}`;
  });

  const routing = usePrivilegeRouting({ request });
  const { hydrate, setLlmGatewayUrl } = routing;

  const listTools = useCallback(async () => {
    const { data } = await apiClient.post(`${API_BASE}/tools/list`);
    setTools(data.tools || []);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    // Reuse the main-app PingOne session to sign in to the gateway without a login
    // page (prompt=none). Once per tab and never after an ?auth= return, so a
    // failed attempt falls back to the button instead of looping; if the gateway
    // can't do it silently there is nothing to redirect to and the button stays.
    const trySilentSignIn = async (state) => {
      if (!state.mainAppAuthenticated || new URLSearchParams(window.location.search).has("auth")) return;
      try {
        if (sessionStorage.getItem(SILENT_TRIED_KEY)) return;
        const { data } = await apiClient.post(`${API_BASE}/auth/start`, { returnTo: window.location.pathname });
        if (!alive || new URL(data?.authUrl).searchParams.get("prompt") !== "none") return;
        sessionStorage.setItem(SILENT_TRIED_KEY, "1");
        beforeConnectRef.current?.();
        navigateWithOverlay(data.authUrl, { message: "Signing in...", assign: true });
      } catch {
        /* stay on the Sign in button */
      }
    };
    apiClient
      .get(`${API_BASE}/state`)
      .then(async ({ data }) => {
        if (!alive) return;
        hydrate(data);
        if (data.oauth?.scope) {
          setScopes(String(data.oauth.scope).split(" ").filter(Boolean));
        }
        if (!data.oauth?.authenticated) {
          setPhase("signed-out");
          await trySilentSignIn(data);
          return;
        }
        if (data.tools?.length) {
          setTools(data.tools);
          setPhase("ready");
          return;
        }
        await listTools();
      })
      .catch((err) => {
        if (!alive) return;
        setNotice(errText(err));
        setPhase("signed-out");
      });
    return () => {
      alive = false;
    };
  }, [listTools, hydrate]);

  useEffect(() => {
    request("/llm/config")
      .then((c) => setLlmGatewayUrl(c?.gatewayUrl || ""))
      .catch(() => {});
  }, [setLlmGatewayUrl]);

  const runTool = async (name, argsStr) => {
    const request = argsStr || "{}";
    try {
      const parsed = JSON.parse(request);
      const { data } = await apiClient.post(`${API_BASE}/tools/call`, {
        name,
        arguments: parsed,
      });
      const response = JSON.stringify(data, null, 2);
      setLatestCall({ name, request, response, ok: !data?.error && !data?.result?.isError });
      return response;
    } catch (err) {
      const response = JSON.stringify({ error: errText(err) }, null, 2);
      setLatestCall({ name, request, response, ok: false });
      return response;
    }
  };

  const retryTools = async () => {
    setBusy(true);
    setNotice("");
    try {
      await listTools();
    } catch (err) {
      setNotice(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await apiClient.post(`${API_BASE}/auth/logout`);
    } catch {
      /* ignore — clear locally regardless */
    }
    setTools([]);
    setScopes([]);
    setLatestCall(null);
    setPhase("signed-out");
    setBusy(false);
  };

  const push = useCallback((role, content, extra = {}) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role, content, steps: [], decision: null, execution: null, ...extra },
    ]);
  }, []);

  // Start a sign-in. silentOnly: follow the redirect only when it is a prompt=none URL —
  // returns false (the caller leaves the gate showing) when the gateway cannot do it
  // silently. Returns true after navigating, undefined for a door that needs no sign-in
  // (its tools are loaded instead). `remember` runs onBeforeConnect just before navigating.
  const startSignIn = useCallback(async ({ silentOnly = false, returnTo, remember = true } = {}) => {
    const start = await requestAuthStart(request, { returnTo });
    if (start.kind === "no-auth-required") {
      push("system", "This door needs no sign-in — its upstream owns identity. Loading tools.");
      await listTools();
      return undefined;
    }
    if (silentOnly && !isSilentAuthUrl(start.authUrl)) return false;
    if (remember) beforeConnectRef.current?.();
    navigateWithOverlay(start.authUrl, { message: "Signing in...", assign: true });
    return true;
  }, [push, listTools]);

  const connect = async () => {
    setBusy(true);
    setNotice("");
    try {
      onBeforeConnect?.();
      const started = await startSignIn({ returnTo: location.pathname, remember: false });
      // true: the page is leaving, so busy stays on. undefined: tools were loaded here.
      if (started === undefined) setBusy(false);
    } catch (err) {
      setNotice(errText(err));
      setBusy(false);
    }
  };

  const send = useCallback(
    async (text) => {
      const prompt = String(text || "").trim();
      if (!prompt) return;
      push("user", prompt);
      setThinking(true);
      if (routing.llmPath) {
        try {
          const { data } = await apiClient.post(`${API_BASE}/llm/call`, { provider: routing.llmPath, prompt });
          const m = llmReplyMessage(routing.llmPath, data);
          push("assistant", m.content, m.extra);
        } catch (err) {
          const d = err?.response?.data || {};
          if (d.code === LLM_POLICY_DENIED) {
            const m = llmDenialMessage(routing.llmPath, { ...d, message: errText(err) });
            push("assistant", m.content, m.extra);
          } else {
            push("assistant", `Error: ${errText(err)}`);
          }
        } finally {
          setThinking(false);
        }
        return;
      }
      try {
        const { data } = await apiClient.post(`${API_BASE}/chat`, { prompt });
        if (data.authUrl) {
          push("system", "Opening sign-in…");
          await connect();
          return;
        }
        const m = chatReplyMessage(data);
        push("assistant", m.content, m.extra);
        if (data.tools) {
          setTools(data.tools);
          setPhase("ready");
        }
      } catch (err) {
        if (err?.response?.status === 401) {
          setPhase("signed-out");
          push("system", "Sign in is required to access the gateway.");
        } else {
          push("assistant", `Error: ${errText(err)}`);
        }
      } finally {
        setThinking(false);
      }
    },
    [push, connect, routing.llmPath],
  );

  const afterSwitch = useCallback(async (result, failPrefix) => {
    if (!result.ok) {
      setNotice(`${failPrefix}: ${errText(result.error)}`);
      return;
    }
    if (result.llm) return;
    setTools([]);
    const authed = result.saved?.oauth?.destinationAuthenticated ?? result.saved?.oauth?.authenticated;
    if (!authed) {
      setPhase("signed-out");
      return;
    }
    try {
      await listTools();
    } catch (err) {
      setNotice(errText(err));
    }
  }, [listTools]);

  const pickPath = useCallback(async (key) => {
    setBusy(true);
    setNotice("");
    try {
      await afterSwitch(await routing.selectPath(key), "Gateway switch failed");
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectPath]);

  const pickDoor = useCallback(async (url) => {
    setBusy(true);
    setNotice("");
    try {
      await afterSwitch(await routing.selectDoor(url), "Failed to switch door");
    } finally {
      setBusy(false);
    }
  }, [afterSwitch, routing.selectDoor]);

  return {
    pvsTheme, cyclePvsTheme,
    phase, scopes, tools, latestCall, busy, notice, messages, thinking,
    connect, retryTools, signOut, runTool, send,
    routing: {
      gatewayMode: routing.gatewayMode,
      config: routing.config,
      presets: routing.presets,
      llmPath: routing.llmPath,
      llmGatewayUrl: routing.llmGatewayUrl,
      loaded: routing.loaded,
    },
    pickPath, pickDoor,
  };
}
