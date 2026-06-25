/**
 * CopilotAgent — standalone chat surface for a Microsoft Copilot Studio agent.
 *
 * Part 2 of the Copilot Studio round-trip (our-app -> Copilot). Fully isolated:
 * it shares no state with the banking agent (AIAgent.js). Entra sign-in (MSAL)
 * and the Copilot Studio client live in ../copilot/copilotClient.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadPublicConfig } from "../services/configService";
import {
  conversationIdFrom,
  isCopilotConfigured,
  messageTextsFrom,
  signInAndCreateClient,
} from "../copilot/copilotClient";
import "./CopilotAgent.css";

export default function CopilotAgent() {
  const [cfg, setCfg] = useState(null);
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | connecting | ready | error
  const [error, setError] = useState("");
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const clientRef = useRef(null);
  const conversationIdRef = useRef(undefined);
  const scrollRef = useRef(null);

  useEffect(() => {
    loadPublicConfig()
      .then((c) => setCfg(c || {}))
      .catch(() => setCfg({}))
      .finally(() => setCfgLoaded(true));
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const configured = isCopilotConfigured(cfg);

  const connect = useCallback(async () => {
    setError("");
    setStatus("connecting");
    try {
      const { client } = await signInAndCreateClient(cfg);
      clientRef.current = client;
      const activities = await client.startConversationAsync(true);
      conversationIdRef.current = conversationIdFrom(activities);
      const greeting = messageTextsFrom(activities).map((text) => ({ role: "assistant", text }));
      setMessages(greeting);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e?.message === "copilot_not_configured" ? "Copilot is not configured." : friendly(e));
    }
  }, [cfg]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !clientRef.current) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const activities = await clientRef.current.askQuestionAsync(text, conversationIdRef.current);
      if (!conversationIdRef.current) conversationIdRef.current = conversationIdFrom(activities);
      const replies = messageTextsFrom(activities).map((t) => ({ role: "assistant", text: t }));
      setMessages((m) => [...m, ...replies]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `Error: ${friendly(e)}` }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!cfgLoaded) {
    return <div className="copilot-surface copilot-empty">Loading…</div>;
  }

  if (!configured) {
    return (
      <div className="copilot-surface copilot-empty">
        <h2>Copilot agent</h2>
        <p className="copilot-notice">
          This surface is not configured yet. Set the Entra and Copilot Studio values on the
          Configuration page, then reload.
        </p>
        <ul className="copilot-missing">
          <li>copilot_entra_client_id</li>
          <li>copilot_entra_tenant_id</li>
          <li>copilot_environment_id</li>
          <li>copilot_agent_schema_name</li>
        </ul>
        <p className="copilot-hint">See demo_api_ui/COPILOT_SETUP.md for the Microsoft-side setup.</p>
      </div>
    );
  }

  return (
    <div className="copilot-surface">
      <header className="copilot-header">
        <h2>Copilot agent</h2>
        <span className={`copilot-status copilot-status-${status}`}>{statusLabel(status)}</span>
      </header>

      {status !== "ready" ? (
        <div className="copilot-connect">
          <p>Sign in with your Microsoft account to start a conversation with the Copilot agent.</p>
          <button className="copilot-btn" onClick={connect} disabled={status === "connecting"}>
            {status === "connecting" ? "Connecting…" : "Sign in with Microsoft"}
          </button>
          {error ? <p className="copilot-error">{error}</p> : null}
        </div>
      ) : (
        <>
          <div className="copilot-messages" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`copilot-msg copilot-msg-${m.role}`}>
                <span className="copilot-msg-role">{m.role === "user" ? "You" : "Copilot"}</span>
                <div className="copilot-msg-text">{m.text}</div>
              </div>
            ))}
            {busy ? <div className="copilot-msg copilot-msg-assistant copilot-typing">Copilot is typing…</div> : null}
          </div>
          <div className="copilot-input-row">
            <input
              className="copilot-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Message the Copilot agent…"
              disabled={busy}
            />
            <button className="copilot-btn" onClick={send} disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function statusLabel(s) {
  if (s === "connecting") return "Connecting";
  if (s === "ready") return "Connected";
  if (s === "error") return "Error";
  return "Not connected";
}

function friendly(e) {
  const msg = e?.message || String(e || "Unknown error");
  // MSAL popup blocked / closed by the user.
  if (/popup/i.test(msg)) return "Sign-in popup was blocked or closed. Allow popups and retry.";
  return msg;
}
