import { useEffect, useRef, useState } from "react";
import "./OAuthAcademyPage.css";
import { useEducationUIOptional } from "../context/EducationUIContext";
import { useTokenChainOptional } from "../context/TokenChainContext";
import { sendAgentMessage } from "../services/demoAgentService";
import AgentConsentModal from "./AgentConsentModal";
import InlineTokenChainView from "./InlineTokenChainView";

// OAuth Academy is its own page (modeled on Code Explorer) but its agent IS the
// real `oauth-teaching` vertical: every message is pinned to that vertical via the
// `vertical` body param on /api/agent/invoke, so the in-process LangGraph agent
// (processAgentMessage) runs the teacher persona, the explain/demonstrate tools,
// the education-panel directives, and the live token chain — without the user
// having to switch their session-wide active vertical.
const PINNED_VERTICAL = "oauth-teaching";

// Action prompts ("demonstrate ...", "show the token chain", "inspect/decode token")
// must run the vertical's deterministic tools (demonstrate_hitl, show_flow_diagram,
// inspect_token, ...) rather than the OAuth-teacher LLM — which is instructed to avoid
// banking terminology and so refuses / doesn't invoke the demonstrate tools. Sending
// these with forceHeuristic dispatches the tool directly (same as the dashboard agent,
// which always forces heuristic for vertical actions). Explain/"what is" prompts and
// free-text stay on the LLM teacher for richer answers.
const FORCE_HEURISTIC_RE =
  /\b(demonstrate|inspect|decode)\b|\bshow\b[\s\S]*\b(token chain|flow|diagram|exchange)\b/i;

// Mirrors config/verticals/oauth-teaching/manifest.json `dashboard.chips10`.
// Hardcoded here exactly as Code Explorer hardcodes its starter chips; keep in
// sync with the manifest if those teaching prompts change. The last chip runs the
// real HITL demonstration (an over-threshold transfer → approve-and-retry).
const STARTER_CHIPS = [
  "why does my AI agent need oauth",
  "what scopes should an AI agent request",
  "how does token exchange work for AI agents",
  "what is act and may_act delegation",
  "how do I limit what an AI agent can do",
  "what is human in the loop approval",
  "demonstrate hitl approval",
  "how does pkce protect AI agent flows",
  "what is a confused deputy attack",
  "show token chain",
];

const OAuthAcademyPage = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Pending HITL approval raised by a demonstrate tool: { challengeId, tool, reason, prompt }.
  const [hitlPending, setHitlPending] = useState(null);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  // Monotonic id for stable React keys — messages are append-only, never reordered.
  const nextIdRef = useRef(0);
  const edu = useEducationUIOptional();
  const tokenChain = useTokenChainOptional();

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll must re-run on every new message; the effect reads only the (stable) ref but depends on the messages render.
  useEffect(() => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.parentElement;
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const mkMsg = (role, content, extra = {}) => ({
    id: nextIdRef.current++,
    role,
    content,
    ...extra,
  });

  const addAssistantPlaceholder = () =>
    setMessages((prev) => [...prev, mkMsg("assistant", "", { pending: true })]);

  const setLastAssistant = (patch) => {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      updated[updated.length - 1] =
        typeof patch === "function" ? patch(last) : { ...last, ...patch };
      return updated;
    });
  };

  // Apply the shared side effects of an agent response (education panel + token chain).
  const applySideEffects = (data) => {
    if (data?.education?.panel && edu) {
      edu.open(data.education.panel, data.education.tab || null);
    }
    if (
      Array.isArray(data?.tokenEvents) &&
      data.tokenEvents.length > 0 &&
      tokenChain
    ) {
      tokenChain.setTokenEvents("oauth-academy", data.tokenEvents);
    }
  };

  const sendQuestion = async (question) => {
    if (!question.trim() || isSending || hitlPending) return;

    const abort = new AbortController();
    abortRef.current = abort;

    setIsSending(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      mkMsg("user", question),
      mkMsg("assistant", "", { pending: true }),
    ]);

    try {
      const data = await sendAgentMessage(question, null, {
        vertical: PINNED_VERTICAL,
        forceHeuristic: FORCE_HEURISTIC_RE.test(question),
        signal: abort.signal,
      });

      if (
        data._status === 401 ||
        data.need_auth ||
        data.error === "TOKEN_INACTIVE"
      ) {
        setLastAssistant({
          content:
            "Please sign in first — then I can run real OAuth flows and show every token hop.",
          pending: false,
        });
        return;
      }

      setLastAssistant({
        content: data.reply || data.message || "(no reply)",
        pending: false,
      });
      applySideEffects(data);

      // A demonstrate tool raised a real human-in-the-loop challenge. Open the
      // approval modal; on approve we record the receipt and retry carrying the
      // challenge id, so the policy verifies it and PERMITs.
      if (data.error === "hitl_required" && data.hitlChallengeId) {
        setHitlPending({
          challengeId: data.hitlChallengeId,
          tool: data.action || "demonstrate_hitl",
          reason:
            data.reply ||
            "This action requires your approval before it can run.",
          prompt: question,
        });
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setLastAssistant({ pending: false });
      } else {
        setLastAssistant({
          content:
            "Failed to reach the OAuth Academy agent. Is the BFF agent running?",
          pending: false,
        });
      }
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  };

  // User approved the HITL challenge in AgentConsentModal: record the approval
  // (receipt) in demo_hitl_service, then retry the demonstrate tool carrying the
  // challenge id so the receipt-aware policy PERMITs and the transfer executes.
  const handleHitlApprove = async () => {
    const { challengeId, prompt } = hitlPending;
    setHitlPending(null);
    setIsSending(true);
    addAssistantPlaceholder();
    try {
      const approveResp = await fetch(
        `/api/mcp/decision/${challengeId}/approve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!approveResp.ok) {
        const e = await approveResp.json().catch(() => ({}));
        throw new Error(e.message || `Approval failed: ${approveResp.status}`);
      }

      const data = await sendAgentMessage(prompt, null, {
        vertical: PINNED_VERTICAL,
        // Force the deterministic vertical-tool dispatch so the retry re-runs
        // demonstrate_hitl (carrying the approved challenge id) instead of asking
        // the teacher LLM, which would refuse the banking action.
        forceHeuristic: true,
        consentGiven: true,
        hitlChallengeId: challengeId,
      });
      setLastAssistant({
        content: data.reply || data.message || "Approved.",
        pending: false,
      });
      applySideEffects(data);
    } catch (err) {
      setLastAssistant({
        content: `Failed to approve: ${err.message}`,
        pending: false,
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleHitlDismiss = () => {
    setHitlPending(null);
    setMessages((prev) => [
      ...prev,
      mkMsg(
        "assistant",
        "Approval cancelled — no money moved. Ask again any time to retry the demonstration.",
      ),
    ]);
  };

  const handleStop = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendQuestion(input);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="oauth-academy-page">
      {/* Hero — always visible but compact when messaging */}
      <div className={`oauth-academy-hero${isEmpty ? '' : ' oauth-academy-hero--compact'}`}>
        <div className="oauth-academy-avatar">OA</div>
        <h1>OAuth Academy</h1>
        <p>
          An interactive teacher for OAuth 2.0 &middot; 2.1 and OIDC. Ask a
          question to get a plain-language explanation, or pick a topic below
          to watch a real authorization flow run live — PKCE, scopes, RFC 8693
          token exchange, act/may_act delegation, and human-in-the-loop
          approval — with the actual token chain shown at every hop.
        </p>
      </div>

      {/* Messages */}
      {!isEmpty && (
        <div className="messages-container">
          {messages.map((msg, idx) => {
            const isLastAssistant =
              msg.role === "assistant" && idx === messages.length - 1;
            const showTyping =
              isLastAssistant && msg.pending && msg.content === "";

            if (showTyping) {
              return (
                <div key={msg.id} className="message-row assistant">
                  <div className="msg-avatar">OA</div>
                  <div className="typing-indicator">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`message-row ${msg.role}`}>
                <div className="msg-avatar">
                  {msg.role === "user" ? "You" : "OA"}
                </div>
                <div className="message-bubble">{msg.content}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <div className="input-wrapper">
        <form className="input-area" onSubmit={handleSubmit}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about OAuth, OIDC, scopes, token exchange…"
            disabled={isSending}
          />
          {!isEmpty && (
            <button
              type="button"
              className="clear-btn"
              onClick={() => setMessages([])}
            >
              Clear
            </button>
          )}
          {isSending ? (
            <button
              type="button"
              className="send-btn stop-btn"
              onClick={handleStop}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="currentColor"
                role="img"
                aria-label="Stop"
              >
                <title>Stop</title>
                <rect x="2" y="2" width="10" height="10" rx="2" />
              </svg>
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!input.trim()}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Send"
              >
                <title>Send</title>
                <line x1="8" y1="13" x2="8" y2="3" />
                <polyline points="4,7 8,3 12,7" />
              </svg>
            </button>
          )}
        </form>
      </div>

      {/* Chips */}
      <div className="starter-chips">
        {STARTER_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip}
            className="starter-chip"
            onClick={() => sendQuestion(chip)}
            disabled={isSending}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Token chain — shows live token hop steps after a flow runs */}
      <div className="oa-token-chain-wrapper">
        <InlineTokenChainView />
      </div>

      {/* HITL approve-and-retry modal — same component the dashboard agent uses. */}
      {hitlPending && (
        <AgentConsentModal
          hitlContext={{ tool: hitlPending.tool, reason: hitlPending.reason }}
          onAccept={handleHitlApprove}
          onDismiss={handleHitlDismiss}
        />
      )}
    </div>
  );
};

export default OAuthAcademyPage;
