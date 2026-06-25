// banking_api_ui/src/context/DemoTourContext.js
import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
} from "react";

export const TOUR_STEPS = [
  {
    title: "Demo — AI Agent Security Demo",
    body: "This tour walks through the key security patterns: Authorization Code + PKCE login, RFC 8693 token exchange with act claims, Human-in-the-Loop (HITL) consent, CIBA out-of-band approval, and MCP-based tool execution.",
    action: null,
  },
  {
    title: "Flow 1 — Customer Login (Auth Code + PKCE)",
    body: "A customer authenticates via Authorization Code + PKCE. The browser only receives a session cookie — tokens never touch the client. The BFF holds all OAuth tokens securely server-side.",
    action: { label: "Go to login", route: "/" },
  },
  {
    title: "Dashboard — AI Agent + Quick Chips",
    body: "After login the dashboard shows the AI Agent. Use the quick-action chips (My Accounts, Check Balance, Transfer) to trigger common commands. Simple queries take the heuristic fast path — no LLM call needed.",
    action: { label: "View dashboard", route: "/dashboard" },
  },
  {
    title: "Agent Tool Call — RFC 8693 Token Exchange",
    body: "When the agent calls an MCP tool, the BFF performs RFC 8693 token exchange: the user's access token is exchanged for a narrowed MCP-audience token. The Token Chain panel shows the full delegation chain in real time.",
    action: {
      label: "Try: My Accounts",
      hint: "Type 'show my accounts' or use the chip — watch the Token Chain panel update",
    },
  },
  {
    title: "2-Exchange Delegation — act Claim",
    body: "The default path runs two exchanges: (1) user token → AI agent token (carrying may_act), then (2) AI agent token → MCP token with a nested act claim. The act claim proves the agent acted on behalf of the user — verifiable by any downstream service.",
    action: {
      hint: "Admin sidebar → Learning → Actor Token (Agent) to see the full token flow",
    },
  },
  {
    title: "Flow 2 — Human-in-the-Loop (HITL) Consent",
    body: "Transfers above the HITL threshold require explicit human approval before the agent can proceed. The agent pauses, a consent modal appears on the dashboard, and the user approves or denies — the agent continues or stops based on the decision.",
    action: {
      label: "Try: Transfer $600 from Savings",
      hint: "Use the chip or type it in the agent — a consent modal will appear",
    },
  },
  {
    title: "HITL — Approve or Deny",
    body: "The consent modal shows the exact transaction the agent wants to perform. Approve to let it proceed; deny to block it. The agent receives the decision and either completes the tool call or returns a clear refusal to the user.",
    action: {
      hint: "Approve or Deny in the consent modal — watch the agent respond to your decision",
    },
  },
  {
    title: "Flow 3 — CIBA (Out-of-Band Approval)",
    body: "For step-up scenarios, the agent can trigger a CIBA push to the user's registered device. The app polls for approval and unblocks automatically when the user approves — no page refresh needed.",
    action: {
      hint: "Enable CIBA in Configuration → Feature Flags, then trigger a high-value transfer",
    },
  },
  {
    title: "WebMCP — Browser-Native MCP Inspection",
    body: "The WebMCP page lets you browse all registered MCP tools, inspect input schemas, call tools directly, and watch streaming token-exchange events — the same execution path used by the AI agent, all from the browser.",
    action: { label: "Open WebMCP", route: "/webmcp" },
  },
  {
    title: "Tour complete",
    body: "You've seen PKCE login, RFC 8693 2-exchange delegation with act claims, HITL consent gates, CIBA out-of-band approval, and live MCP tool execution. Use the Learning section in the Admin sidebar to go deeper on any topic.",
    action: {
      hint: "Admin sidebar → Learning section for education panels on every concept",
    },
  },
];

const DemoTourContext = createContext(null);

export function DemoTourProvider({ children }) {
  const [step, setStep] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const start = useCallback(() => {
    setStep(0);
    setIsOpen(true);
  }, []);

  const next = useCallback(() => {
    setStep((s) => Math.min(s + 1, TOUR_STEPS.length - 1));
  }, []);

  const prev = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const goTo = useCallback((n) => {
    setStep(Math.max(0, Math.min(n, TOUR_STEPS.length - 1)));
  }, []);

  const value = useMemo(
    () => ({
      step,
      total: TOUR_STEPS.length,
      isOpen,
      start,
      next,
      prev,
      close,
      goTo,
    }),
    [step, isOpen, start, next, prev, close, goTo],
  );

  return (
    <DemoTourContext.Provider value={value}>
      {children}
    </DemoTourContext.Provider>
  );
}

export function useDemoTour() {
  const ctx = useContext(DemoTourContext);
  if (!ctx) throw new Error("useDemoTour must be used inside DemoTourProvider");
  return ctx;
}

export default DemoTourContext;
