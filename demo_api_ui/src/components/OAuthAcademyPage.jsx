import { useEffect, useRef, useState } from "react";
import { HeroSection } from "./HeroSection";
import { HERO_VARIANTS } from "../config/heroVariants";
import "./OAuthAcademyPage.css";
import { useTokenChainOptional } from "../context/TokenChainContext";
import { sendAgentMessage } from "../services/demoAgentService";
import { tokenChainTraceStore } from "../services/tokenChainTrace/tokenChainTraceStore";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import AgentConsentModal from "./AgentConsentModal";
import TokenChainTraceRail from "./TokenChainTraceRail";
import { MarkdownContent } from "./shared/MarkdownText";
import { useThemeOptional } from "../context/ThemeContext";
import {
  Card,
  KvList,
  PageFrame,
  PingPage,
  Section,
  SimBanner,
  StatusChip,
} from "./pingUi";

// OAuth Academy is its own page (modeled on Code Explorer) but its agent IS the
// real `oauth-teaching` vertical: every message is pinned to that vertical via the
// `vertical` body param on /api/agent/invoke, so the in-process LangGraph agent
// (processAgentMessage) runs the teacher persona, the explain/demonstrate tools,
// the education-panel directives, and the live token chain — without the user
// having to switch their session-wide active vertical.
const PINNED_VERTICAL = "oauth-teaching";

// Starter-chip phrasing must hit the vertical's deterministic tools
// (explain_concept, demonstrate_hitl, show_flow_diagram, inspect_token, …) rather
// than the LLM reason loop. With agent_mode=llamacpp, heuristicRouting is off, so
// without forceHeuristic teach chips wait ~40s and the LLM calls explain_concept
// through MCP (Unknown tool). Free-text that does not match still uses the LLM.
const FORCE_HEURISTIC_RE =
  /\b(what\s+is|explain|how\s+does|tell\s+me\s+about|demonstrate|inspect|decode)\b|\bshow\b[\s\S]*\b(token chain|flow|diagram|exchange)\b/i;

// Mirrors config/verticals/oauth-teaching/manifest.json `dashboard.chips10`.
// Hardcoded here exactly as Code Explorer hardcodes its starter chips; keep in
// sync with the manifest if those teaching prompts change. The last chip runs the
// real HITL demonstration (an over-threshold transfer → approve-and-retry).
const STARTER_CHIPS = [
  "what is oauth",
  "what is the authorization code flow with pkce",
  "what is the difference between an id token and an access token",
  "explain scopes and least privilege",
  "explain refresh tokens",
  "what is the client credentials grant",
  "how does token exchange work (rfc 8693)",
  "what is act and may_act delegation",
  "what is token introspection",
  "what is step-up authentication",
  "demonstrate a real token exchange",
  "demonstrate hitl approval",
];

// Assistant answers may embed a real code snippet between ``` fences (the
// oauth-teaching explain_concept tool appends app implementation examples).
// Render fenced segments as <pre> blocks; plain segments go through the same
// markdown renderer the banking agent chat uses (bold, headings, lists, tables).
const renderBubbleContent = (content) => {
  const text = String(content);
  if (!text.includes("```")) return <MarkdownContent text={text} />;
  return text.split("```").map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/a11y/useSemanticElements: a <pre> cannot be a <section>; the region role names the code block
      <pre
        className="msg-code"
        key={i}
        // A code block scrolls sideways, so the keyboard must be able to reach it.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region, reachable by keyboard
        tabIndex={0}
        role="region"
        aria-label="Code example"
      >
        {part.replace(/^\n/, "")}
      </pre>
    ) : (
      <MarkdownContent key={i} text={part} />
    )
  );
};

const OAuthAcademyPage = () => {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Pending HITL approval raised by a demonstrate tool: { challengeId, tool, reason, prompt }.
  const [hitlPending, setHitlPending] = useState(null);
  // How many token events the rail below is showing right now. Read from the rail's own store, not counted from
  // answers: the rail keeps its run after Clear and after an answer with no events, so a page-side counter drifts.
  const [railEventCount, setRailEventCount] = useState(
    () => tokenChainTraceStore.getState().trace.tokenEvents.length,
  );
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  // Monotonic id for stable React keys — messages are append-only, never reordered.
  const nextIdRef = useRef(0);
  const tokenChain = useTokenChainOptional();

  useEffect(
    () => tokenChainTraceStore.subscribe((snap) => setRailEventCount(snap.trace.tokenEvents.length)),
    [],
  );

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

  // Token chain only — do not auto-open education drawers from Academy replies
  // (explain_concept still returns education.panel, but opening it here covers
  // the chat with banking-oriented panels like Least-Data / Sensitive Data).
  const applySideEffects = (data) => {
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
          needAuth: true,
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
      if (err.name === "AbortError" || err.name === "TimeoutError") {
        setLastAssistant({
          content:
            err.name === "TimeoutError"
              ? "Timed out waiting for the OAuth Academy agent. Try a starter chip, or ask again."
              : "Stopped — ask again whenever you are ready.",
          pending: false,
          ...(err.name === "TimeoutError"
            ? { failed: true }
            : { status: "Stopped" }),
        });
      } else {
        setLastAssistant({
          content:
            "Failed to reach the OAuth Academy agent. Is the BFF agent running?",
          pending: false,
          failed: true,
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
        failed: true,
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
        { status: "Approval cancelled" },
      ),
    ]);
  };

  const handleClear = () => {
    if (isSending) return;
    setMessages([]);
    // Clear empties the conversation only; the token rail keeps its run and the chip below reads the rail.
    // The Clear button unmounts with the conversation; keep the keyboard in the page.
    inputRef.current?.focus();
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
  const last = messages[messages.length - 1];
  const busy = isSending || !!hitlPending;

  // One primary per view state (P9): Send, which becomes Stop on the same element while the agent works;
  // Sign in while the last answer asked for it; none on the page while the approval dialog is open (the
  // dialog's own Agree & Continue is the only primary then).
  const signInPrimary = !!last?.needAuth && !isSending && !hitlPending;
  const sendPrimary = !hitlPending && !signInPrimary;
  const cannotSend = !isSending && (!input.trim() || !!hitlPending);

  // The chip says only what this page observed: it has no sign-in check of its own, so Ready is neutral.
  let chip = { tone: "neutral", word: "Ready" };
  if (hitlPending) chip = { tone: "warn", word: "Approval needed" };
  else if (isSending) chip = { tone: "info", word: "Waiting for the agent" };
  else if (last?.needAuth) chip = { tone: "warn", word: "Sign-in needed" };
  else if (last?.failed) chip = { tone: "danger", word: "Last request failed" };
  else if (last?.status) chip = { tone: "neutral", word: last.status };
  else if (last?.role === "assistant") chip = { tone: "neutral", word: "Answered" };

  return (
    <PingPage className="oauth-academy-page">
      <SimBanner data-testid="oa-banner">
        <strong>Live agent, taught answers.</strong> Every message goes to this app&apos;s own agent
        (<span className="pu-mono">/api/agent/invoke</span>), pinned to the{" "}
        <span className="pu-mono">{PINNED_VERTICAL}</span> teacher. Explanations are written by that agent: its
        lesson tools or the model the server is set to use, and this page does not know which. The three
        demonstrations (token exchange, scope denial, approval) call the real banking pipeline and need you signed
        in; signed out, the agent asks you to sign in and nothing runs. Approving the human-in-the-loop prompt lets a
        real over-threshold transfer between your demo accounts go through.
      </SimBanner>

      <div className="oa-theme-row">
        <OaButton
          onClick={toggleDarkMode}
          className="oa-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
        </OaButton>
      </div>
      <HeroSection
        avatar="OA"
        title="OAuth Academy"
        description="An interactive teacher for OAuth 2.0 &middot; 2.1 and OIDC. Ask a question to get a plain-language explanation, or pick a topic below to watch a real authorization flow run live — PKCE, scopes, RFC 8693 token exchange, act/may_act delegation, and human-in-the-loop approval — with the actual token chain shown at every hop."
        size={isEmpty ? 'full' : 'compact'}
        backgroundColor={HERO_VARIANTS['oauth-academy'].backgroundColor}
      />

      <PageFrame>
        <Section
          id="oa-ask"
          kicker="1 · Ask"
          title="Ask the teacher"
          lede="Type a question, or start from a topic below."
        >
          <Card tone="neutral" data-testid="oa-chat-card">
            <div className="pu-status-line" role="status" data-testid="oa-status">
              <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
            </div>

            {/* Messages */}
            {!isEmpty && (
              <div
                className="messages-container"
                role="log"
                aria-label="Conversation with the OAuth teacher"
                aria-live="polite"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable log must be reachable by keyboard
                tabIndex={0}
              >
                {messages.map((msg, idx) => {
                  const isLastAssistant =
                    msg.role === "assistant" && idx === messages.length - 1;
                  const showTyping =
                    isLastAssistant && msg.pending && msg.content === "";

                  if (showTyping) {
                    return (
                      <div key={msg.id} className="message-row assistant">
                        <div className="msg-avatar" aria-hidden="true">OA</div>
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
                      <div className="msg-avatar" aria-hidden="true">
                        {msg.role === "user" ? "You" : "OA"}
                      </div>
                      <div className="message-bubble">
                        <span className="oa-sr-only">
                          {msg.role === "user" ? "You: " : "Teacher: "}
                        </span>
                        {renderBubbleContent(msg.content)}
                        {msg.needAuth && (
                          <OaButton
                            main={idx === messages.length - 1 && signInPrimary}
                            className="oa-signin-btn"
                            onClick={() => navigateToCustomerOAuthLogin('/oauth-academy')}
                          >
                            Sign in
                          </OaButton>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Input */}
            <form className="input-area" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about OAuth, OIDC, scopes, token exchange…"
                aria-label="Ask the OAuth teacher a question"
                readOnly={isSending}
                aria-busy={isSending || undefined}
              />
              {!isEmpty && (
                <OaButton
                  className="oa-clear-btn"
                  aria-disabled={isSending || undefined}
                  onClick={handleClear}
                >
                  Clear
                </OaButton>
              )}
              <OaButton
                main={sendPrimary}
                type={isSending ? "button" : "submit"}
                className="oa-send-btn"
                aria-disabled={cannotSend || undefined}
                onClick={(e) => {
                  if (isSending) {
                    handleStop();
                    return;
                  }
                  if (cannotSend) e.preventDefault();
                }}
              >
                {isSending ? "Stop" : "Send"}
              </OaButton>
            </form>
          </Card>
        </Section>

        <Section
          id="oa-topics"
          kicker="2 · Topics"
          title="Starter questions"
          lede="Each one sends the question to the teacher. The last two run real calls and need a signed-in session."
        >
          {busy && (
            <p className="pu-note" data-testid="oa-topics-paused">
              {hitlPending
                ? "Starter questions are paused until you answer the approval dialog."
                : "Starter questions are paused while the agent answers."}
            </p>
          )}
          <div className="oa-topics">
            {STARTER_CHIPS.map((chipText) => (
              <OaButton
                key={chipText}
                className="oa-topic"
                aria-disabled={busy || undefined}
                onClick={() => sendQuestion(chipText)}
              >
                {chipText}
              </OaButton>
            ))}
          </div>
        </Section>

        <Section
          id="oa-token-flow"
          kicker="3 · Evidence"
          title="Live token flow"
          lede="Hops appear here when an answer comes back with token events, as the demonstrations do."
        >
          {/* Token chain — shows live RFC 8693 token flow during demonstrations */}
          <Card tone="neutral" data-testid="oa-token-chain">
            <div className="pu-status-line" role="status">
              <StatusChip>
                {railEventCount > 0
                  ? `${railEventCount} token ${railEventCount === 1 ? "event" : "events"} in the rail`
                  : "Waiting for a demonstration"}
              </StatusChip>
            </div>
            <TokenChainTraceRail />
          </Card>
        </Section>

        <Section
          id="oa-wiring"
          kicker="4 · Wiring"
          title="What this page calls"
        >
          <Card tone="neutral" data-testid="oa-wiring">
            <KvList
              items={[
                { label: "Endpoint", value: "POST /api/agent/invoke", mono: true },
                { label: "Pinned vertical", value: PINNED_VERTICAL, mono: true },
                {
                  label: "Demonstrations",
                  value:
                    "demonstrate_token_exchange, demonstrate_scope_denial, demonstrate_hitl",
                  mono: true,
                },
                {
                  label: "Starter questions",
                  value:
                    "Matching phrasings run the teacher's own tools directly; other text goes to the agent as typed.",
                },
              ]}
            />
          </Card>
        </Section>
      </PageFrame>

      {/* HITL approve-and-retry modal — same component the dashboard agent uses. */}
      {hitlPending && (
        <AgentConsentModal
          hitlContext={{ tool: hitlPending.tool, reason: hitlPending.reason }}
          onAccept={handleHitlApprove}
          onDismiss={handleHitlDismiss}
        />
      )}
    </PingPage>
  );
};

// The page's buttons. `main` is the view state's one primary (see "One primary per view state" in the component).
// A function declaration, so it is hoisted and the page's banner stays the first element in the file's JSX.
function OaButton({ main, className = "", ...rest }) {
  return (
    <button
      type="button"
      className={`${main ? "pu-btn pu-btn--primary" : "pu-btn"} ${className}`.trim()}
      {...rest}
    />
  );
}

export default OAuthAcademyPage;
