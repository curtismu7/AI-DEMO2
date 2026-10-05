// Privilege MCP client session shared by every footprint costume: sign-in state,
// discovered tools, the latest tool run, and the chat transcript. Lives in
// FootprintLiveShellPage (one route for all skins) so a skin switch keeps it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../../services/apiClient";

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

export function usePrivilegeShellSession() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [phase, setPhase] = useState("loading"); // loading | signed-out | ready
  const [scopes, setScopes] = useState([]);
  const [tools, setTools] = useState([]);
  const [latestCall, setLatestCall] = useState(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
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
        window.location.assign(data.authUrl);
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

  const connect = async () => {
    setBusy(true);
    setNotice("");
    try {
      const { data } = await apiClient.post(`${API_BASE}/auth/start`, {
        returnTo: location.pathname,
      });
      window.location.assign(data.authUrl);
    } catch (err) {
      setNotice(errText(err));
      setBusy(false);
    }
  };

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

  const send = useCallback(
    async (text) => {
      const prompt = String(text || "").trim();
      if (!prompt) return;
      push("user", prompt);
      setThinking(true);
      if (routing.llmPath) {
        try {
          const { data } = await apiClient.post(`${API_BASE}/llm/call`, { provider: routing.llmPath, prompt });
          push("assistant", data.reply, { steps: [`${routing.llmPath} · ${data.route} · ${data.latencyMs} ms`] });
        } catch (err) {
          const d = err?.response?.data || {};
          if (d.code === "llm_policy_denied") {
            push("assistant", `⚠️ Privilege denied this call. ${d.reason || errText(err)}`, {
              steps: [`${d.provider || routing.llmPath} · ${d.route || ""} · denied by policy`],
            });
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
        push("assistant", data.reply || "Done.", {
          steps: data.steps || [],
          decision: data.decision || null,
          execution: data.execution || null,
        });
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
