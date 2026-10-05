// Privilege MCP client session shared by every footprint costume: sign-in state,
// discovered tools, the latest tool run, and the chat transcript. Lives in
// FootprintLiveShellPage (one route for all skins) so a skin switch keeps it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../../services/apiClient";

const API_BASE = "/api/privilege-mcp";

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

  const listTools = useCallback(async () => {
    const { data } = await apiClient.post(`${API_BASE}/tools/list`);
    setTools(data.tools || []);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let alive = true;
    apiClient
      .get(`${API_BASE}/state`)
      .then(async ({ data }) => {
        if (!alive) return;
        if (data.oauth?.scope) {
          setScopes(String(data.oauth.scope).split(" ").filter(Boolean));
        }
        if (!data.oauth?.authenticated) {
          setPhase("signed-out");
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
  }, [listTools]);

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
      try {
        const { data } = await apiClient.post(`${API_BASE}/chat`, { prompt });
        if (data.authUrl) {
          push("system", "Opening sign-in…");
          window.location.assign(data.authUrl);
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
    [push],
  );

  return {
    phase, scopes, tools, latestCall, busy, notice, messages, thinking,
    connect, retryTools, signOut, runTool, send,
  };
}
