import React, { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useEducationUI } from "../context/EducationUIContext";
import { useDemoTour } from "../context/DemoTourContext";
import { EDU } from "./education/educationIds";
import TokenChainTraceRail from "./TokenChainTraceRail";
import LearningHubAgent from "./LearningHubAgent";
import LearningHubDocuments from "./LearningHubDocuments";
import { useThemeOptional } from "../context/ThemeContext";
import { demoStepLabel } from "../config/demoStepNumbers";
import { getConfig, useCaseDiagramPath } from "../config/useCaseDiagrams";
import "./LearningHub.css";

interface LearningCategory {
  id: string;
  label: string;
  icon: string;
  items: LearningItem[];
}

interface LearningItem {
  label: string;
  description?: string;
  icon: string;
  // useCaseId drives the deep link (/use-cases#UCid); `number` is optional and
  // defaults to the canonical demoStepLabel for that id, so chips can't drift
  // from demoStepNumbers.js the way the old hardcoded 53 did.
  demoStep?: { number?: number | string; useCaseId: string };
}

type LessonStatus = "LIVE" | "LIVE / CONFIG" | "SIMULATED" | "REFERENCE";

interface LessonContract {
  status: LessonStatus;
  keywords?: string[];
  lab?: string;
}

const LESSON_REGISTRY: Record<string, LessonContract> = {
  "Guided Demo Tour": { status: "LIVE" },
  "CIBA (OOB)": { status: "LIVE / CONFIG" },
  "Token Exchange (RFC 8693)": { status: "LIVE", keywords: ["delegation", "BFF", "act", "aud", "scope", "token custody"] },
  "PingOne Authorize": { status: "LIVE / CONFIG", keywords: ["P1AZ", "policy", "permit", "deny", "step-up", "decision"] },
  "MCP Protocol": { status: "LIVE", keywords: ["tools/list", "tools/call", "MCP Inspector", "tool invocation"] },
  "Agent-to-Agent (A2A)": { status: "LIVE", keywords: ["agent card", "nested act", "specialist", "delegation"] },
  "Jev: Decision Model": { status: "LIVE / CONFIG", keywords: ["System One", "guardrail", "intent routing", "confidence", "threshold", "Von", "bake-off"] },
  "Agent Gateway Authorization": { status: "LIVE", keywords: ["P1AZ", "delegated access", "MCP policy", "PERMIT", "DENY", "STEP-UP", "audit"] },
  "Human-in-the-loop": { status: "LIVE / CONFIG", keywords: ["HITL", "approval", "consent", "CIBA", "sensitive action"] },
  "Enterprise-Managed Auth (EMA)": { status: "LIVE / CONFIG" },
  "Agent Kill Switch": { status: "LIVE" },
  "Shadow AI Detector": { status: "LIVE / CONFIG" },
  "WebMCP (Google)": { status: "LIVE / CONFIG" },
  "PAR (RFC 9126)": { status: "SIMULATED", keywords: ["request_uri", "authorization request", "PKCE"], lab: "par" },
  "RAR (RFC 9396)": { status: "SIMULATED", keywords: ["authorization_details", "transaction", "amount", "payee"], lab: "rar" },
  "JWT Client Auth (RFC 7523)": { status: "SIMULATED", keywords: ["private_key_jwt", "client assertion", "token endpoint"], lab: "jwt-client-auth" },
  "Step-up MFA": { status: "SIMULATED", keywords: ["strong authentication", "challenge", "sensitive action"], lab: "step-up" },
};

const RECOMMENDED_PATH = [
  {
    step: "01",
    title: "Run one agent action",
    detail: "Start with read, step-up, and deny outcomes in the same customer story.",
    href: "/agent-gateway-authorization",
    cta: "Run Agent Gateway Authorization",
  },
  {
    step: "02",
    title: "Inspect delegated identity",
    detail: "See the user, agent, audience, scopes, and token exchanges behind the request.",
    href: "/agent-flow-inspector",
    cta: "Inspect token flow",
  },
  {
    step: "03",
    title: "Change the policy context",
    detail: "Test how amount, destination, scope, and obligations change the decision.",
    href: "/pingone-authorize?tab=guided",
    cta: "Test Authorize decisions",
  },
  {
    step: "04",
    title: "Prove what happened",
    detail: "Close the loop with the gateway event, approval state, tool result, and audit trace.",
    href: "/transaction-trace",
    cta: "Open transaction trace",
  },
  {
    step: "05",
    title: "Watch it live",
    detail: "The same act chain, streaming into Grafana — run a live DENY and watch the dashboards react.",
    href: "/architecture/observability",
    cta: "Open observability demo",
  },
];

function lessonStatus(item: LearningItem): LessonStatus {
  return LESSON_REGISTRY[item.label]?.status || "REFERENCE";
}

function lessonSearchText(category: LearningCategory, item: LearningItem): string {
  return [
    category.label,
    item.label,
    item.description,
    lessonStatus(item),
    ...(LESSON_REGISTRY[item.label]?.keywords || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const LEARNING_CATEGORIES: LearningCategory[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: "📚",
    items: [
      {
        label: "Welcome Wizard",
        description: "Demo intro + create your demo accounts",
        icon: "",
      },
      {
        label: "Guided Demo Tour",
        description: "Interactive walkthrough of the platform",
        icon: "",
        demoStep: { useCaseId: "UC23" },
      },
      {
        label: "Best Practices",
        description: "Learn industry best practices for AI agents",
        icon: "",
      },
      {
        label: "Agentic Maturity Model",
        description: "Understand agent development stages",
        icon: "📊",
      },
    ],
  },
  {
    id: "oauth-identity",
    label: "OAuth & Identity",
    icon: "🔑",
    items: [
      {
        label: "Auth Code + PKCE",
        description: "OAuth 2.0 authorization code flow with PKCE security",
        icon: "🔐",
        demoStep: { useCaseId: "UC-LOGIN" },
      },
      {
        label: "PKCE Deep Dive",
        description: "Proof Key for Code Exchange explained",
        icon: "🔍",
        demoStep: { useCaseId: "UC-LOGIN" },
      },
      {
        label: "CIBA (OOB)",
        description: "Client Initiated Backchannel Authentication",
        icon: "📡",
        demoStep: { useCaseId: "UC22" },
      },
      {
        label: "Token Exchange (RFC 8693)",
        description: "Convert between different token types",
        icon: "🔄",
        demoStep: { useCaseId: "UC1" },
      },
      {
        label: "may_act / act claims",
        description: "Delegation and actor claims in tokens",
        icon: "👥",
        demoStep: { useCaseId: "UC3" },
      },
      {
        label: "Actor Token (Agent)",
        description: "Tokens for autonomous agents",
        icon: "🤖",
        demoStep: { useCaseId: "UC44" },
      },
      {
        label: "Step-up MFA",
        description: "Multi-factor authentication escalation",
        icon: "🔐",
        demoStep: { useCaseId: "UC7" },
      },
      {
        label: "Introspection (RFC 7662)",
        description: "Validate and inspect token contents",
        icon: "🔍",
        // UC29 fails the token validation CLOSED (the live validation outage);
        // it is the closest live evidence for token validation.
        demoStep: { useCaseId: "UC29" },
      },
      {
        label: "PingOne Authorize",
        description: "Fine-grained authorization policies",
        icon: "⚖️",
        demoStep: { useCaseId: "UC6" },
      },
      {
        label: "Group entitlement",
        description: "Group membership in the PingOne directory decides access — scopes are not entitlements. Live on the group policy board.",
        icon: "👥",
        demoStep: { useCaseId: "UC9" },
      },
      {
        label: "PAR (RFC 9126)",
        description: "Pushed Authorization Requests",
        icon: "📄",
        demoStep: { useCaseId: "UC14b" },
      },
      {
        label: "RAR (RFC 9396)",
        description: "Rich Authorization Requests",
        icon: "📋",
        demoStep: { useCaseId: "UC14b" },
      },
      {
        label: "JWT Client Auth (RFC 7523)",
        description: "Secure client authentication with JWTs",
        icon: "💳",
        // No dedicated private_key_jwt run exists; UC22 (CIBA) is where the
        // demo exercises signed client assertions. Primary action is the lab.
        demoStep: { useCaseId: "UC22" },
      },
      {
        label: "OAuth: CIMD",
        description: "Customer Identity Management with CIMD",
        icon: "👤",
        demoStep: { useCaseId: "UC43" },
      },
    ],
  },
  {
    id: "mcp-agents",
    label: "MCP & Agents",
    icon: "🔗",
    items: [
      {
        label: "MCP Protocol",
        description: "Model Context Protocol fundamentals",
        icon: "📡",
        demoStep: { useCaseId: "UC30" },
      },
      {
        label: "Agent-to-Agent (A2A)",
        description: "Nested-act delegation and the A2A wire protocol",
        icon: "🔗",
        demoStep: { useCaseId: "UC2" },
      },
      {
        label: "Jev: Decision Model",
        description: "A fast typed-answer model for guardrails and routing: score, confidence and thresholds",
        icon: "🧠",
        demoStep: { useCaseId: "UC-LEARN15" },
      },
      {
        label: "MCP Server Discovery",
        description: "How agents discover and register MCP servers",
        icon: "🔍",
        demoStep: { useCaseId: "UC40" },
      },
      {
        label: "MCP: MFA Gate on Tools",
        description: "Protect sensitive tools with MFA",
        icon: "🛡️",
        demoStep: { useCaseId: "UC38" },
      },
      {
        label: "MCP Elicitation",
        description: "How agents learn tool capabilities",
        icon: "📚",
      },
      {
        label: "Agent Gateway",
        description: "Central hub for agent-server communication",
        icon: "🌐",
      },
      {
        label: "Agent Gateway Authorization",
        description: "Follow delegated identity, runtime policy, MCP enforcement, and audit evidence in one live story",
        icon: "⚖",
      },
      {
        label: "Computer Use Agent (CUA)",
        description: "Agents that interact with UI/UX",
        icon: "",
      },
      {
        label: "Human-in-the-loop",
        description: "HITL flows for sensitive operations",
        icon: "👤‍💼",
        demoStep: { useCaseId: "UC8" },
      },
      {
        label: "PingOne Agent Gateway Security",
        description: "Security architecture of PingOne Agent Gateway",
        icon: "🔐",
      },
      {
        label: "Enterprise-Managed Auth (EMA)",
        description: "Zero-touch OAuth for MCP with IdP-driven provisioning",
        icon: "🏦",
        demoStep: { useCaseId: "UC40" },
      },
      {
        label: "Agent Kill Switch",
        description: "Session-scoped revocation, active-run audit trail, and what's a concept vs. shipped",
        icon: "⚠️",
        // UC-NHI2 is the lifecycle/revocation export — the closest live
        // evidence for kill-switch behavior. UC-NHI1 is inventory only.
        demoStep: { useCaseId: "UC-NHI2" },
      },
      {
        label: "Shadow AI Detector",
        description: "What the browser extension observes about AI usage, OAuth agents, and sensitive data flows",
        icon: "🔍",
      },
    ],
  },
  {
    id: "ping-ai-products",
    label: "Ping AI Products",
    icon: "🛡",
    items: [
      {
        label: "Agent IAM Core",
        description: "Agent identity, OAuth authentication, delegation, and scoped tokens",
        icon: "🔑",
        demoStep: { useCaseId: "UC43" },
      },
      {
        label: "Agent Gateway",
        description: "The runtime enforcement point for agent, API, and MCP traffic",
        icon: "🌐",
      },
      {
        label: "PingOne Authorize",
        description: "Fine-grained policy decisions for agents, users, resources, and actions",
        icon: "⚖",
        demoStep: { useCaseId: "UC6" },
      },
      {
        label: "Privilege for AI — LLM",
        description: "Protect model interactions, prompts, responses, and downstream actions",
        icon: "🧠",
        demoStep: { useCaseId: "UC-LEARN11" },
      },
      {
        label: "Privilege for AI — A2A",
        description: "Control authenticated agent-to-agent delegation and handoffs",
        icon: "🔗",
        demoStep: { useCaseId: "UC46" },
      },
      {
        label: "Privilege for AI — MCP",
        description: "Protect MCP discovery, tools, resources, and invocations",
        icon: "🛠",
        // UC17 = JIT/ephemeral credentials, the MCP-privilege live run; UC13 is
        // the confused-deputy attack, a different story.
        demoStep: { useCaseId: "UC17" },
      },
    ],
  },
  {
    id: "standards-architecture",
    label: "Standards & Architecture",
    icon: "🛠",
    items: [
      {
        label: "RFC & Spec Index",
        description: "Complete reference of standards used",
        icon: "📚",
      },
      {
        label: "Intent Auth Standards",
        description: "Standards for intent-based authorization",
        icon: "✅",
        demoStep: { useCaseId: "UC14b" },
      },
      {
        label: "IETF Standards: Agentic",
        description: "IETF specs for autonomous agents",
        icon: "📄",
      },
      {
        label: "SPIFFE / SVID Workload Identity",
        description: "Attested, auto-rotating machine identity — and what PingOne can actually consume",
        icon: "🔐",
      },
      {
        label: "ID-JAG / Cross-App Access",
        description: "Identity across distributed applications",
        icon: "🔗",
        demoStep: { useCaseId: "UC40" },
      },
      {
        label: "Architecture Diagram",
        description: "System architecture overview",
        icon: "🛠",
      },
      {
        label: "Token Chain (edu)",
        description: "How tokens flow through the system",
        icon: "🔗",
        demoStep: { useCaseId: "UC1" },
      },
      {
        label: "Sensitive Data & Disclosure",
        description: "Protecting sensitive information",
        icon: "🔐",
        demoStep: { useCaseId: "UC16b" },
      },
      {
        label: "Gateway vs P1AZ Decision Split",
        description: "Coarse (PEP) vs fine (PDP), and the 5 rules P1AZ can't express",
        icon: "📖",
        demoStep: { useCaseId: "UC6" },
      },
    ],
  },
  {
    id: "project-reference",
    label: "Project Reference",
    icon: "📖",
    items: [
      {
        label: "Server Capabilities",
        description: "What this server can do",
        icon: "⚙️",
      },
      {
        label: "Agent Tech Comparison",
        description: "Different agent frameworks compared",
        icon: "📊",
      },
    ],
  },
  {
    id: "ai-ecosystem",
    label: "AI Ecosystem",
    icon: "🤖",
    items: [
      {
        label: "LangChain (LCEL + LangGraph)",
        description: "LangChain ecosystem for AI applications",
        icon: "🔗",
        demoStep: { useCaseId: "UC47" },
      },
      {
        label: "Agent Builder Landscape",
        description: "Overview of agent building frameworks",
        icon: "🛠️",
      },
      {
        label: "LLM Landscape",
        description: "Available large language models",
        icon: "🧠",
        demoStep: { useCaseId: "UC-TOOL3" },
      },
      {
        label: "AI Platform Landscape",
        description: "AI platforms and services",
        icon: "🌐",
      },
      {
        label: "AI Primer",
        description: "Introduction to AI and ML concepts",
        icon: "📚",
      },
      {
        label: "Vector Search & RAG (Weaviate)",
        description: "How semantic code search stores and finds embeddings",
        icon: "🧠",
        demoStep: { useCaseId: "UC-TOOL1" },
      },
    ],
  },
  {
    id: "special",
    label: "Special Topics",
    icon: "",
    items: [
      {
        label: "Glean + PingOne",
        description: "Enterprise search integration",
        icon: "🔍",
      },
      {
        label: "WebMCP (Google)",
        description: "Proposed web standard for exposing tools to AI agents",
        icon: "🌐",
      },
      {
        label: "AuthZEN",
        description: "Authorization interoperability",
        icon: "🔑",
      },
      {
        label: "Agentic Trust",
        description: "Building trust in AI agents",
        icon: "👥",
        demoStep: { useCaseId: "UC37" },
      },
      {
        label: "Agent Guardrails",
        description: "How Ping keeps AI agents inside explicit guardrails",
        icon: "🛡️",
        demoStep: { useCaseId: "UC47" },
      },
      {
        label: "OWASP Agentic",
        description: "Security for autonomous agents",
        icon: "🛡️",
        demoStep: { useCaseId: "UC12" },
      },
      {
        label: "Gartner Machine IAM Survey",
        description: "Top 5 findings and how this demo answers them",
        icon: "📊",
        demoStep: { useCaseId: "UC-NHI1" },
      },
    ],
  },
];

export default function LearningHub() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const { open: openEdu } = useEducationUI();
  const navigate = useNavigate();
  const tour = useDemoTour();
  const [searchQuery, setSearchQuery] = useState("");
  const categoryActionMap = useMemo(
    () => ({
    "getting-started": {
      "Guided Demo Tour": () => tour.start(),
      "Welcome Wizard": () =>
        window.dispatchEvent(new CustomEvent("welcome-wizard:open")),
      "Best Practices": () => openEdu(EDU.BEST_PRACTICES, "overview"),
      "Agentic Maturity Model": () =>
        openEdu(EDU.AGENTIC_MATURITY, "overview"),
    },
    "oauth-identity": {
      "Auth Code + PKCE": () => openEdu(EDU.LOGIN_FLOW, "what"),
      "PKCE Deep Dive": () => openEdu(EDU.LOGIN_FLOW, "pkce"),
      "CIBA (OOB)": () =>
        window.dispatchEvent(
          new CustomEvent("education-open-ciba", { detail: { tab: "what" } }),
        ),
      "Token Exchange (RFC 8693)": () => navigate("/architecture/token-flow"),
      "may_act / act claims": () => openEdu(EDU.MAY_ACT, "what"),
      "Actor Token (Agent)": () => navigate("/architecture/token-chain"),
      "Step-up MFA": () => navigate(`/learning-lab/${LESSON_REGISTRY["Step-up MFA"].lab}`),
      "Introspection (RFC 7662)": () => openEdu(EDU.INTROSPECTION, "why"),
      "PingOne Authorize": () => openEdu(EDU.PINGONE_AUTHORIZE, "what"),
      "PAR (RFC 9126)": () => navigate(`/learning-lab/${LESSON_REGISTRY["PAR (RFC 9126)"].lab}`),
      "RAR (RFC 9396)": () => navigate(`/learning-lab/${LESSON_REGISTRY["RAR (RFC 9396)"].lab}`),
      "JWT Client Auth (RFC 7523)": () => navigate(`/learning-lab/${LESSON_REGISTRY["JWT Client Auth (RFC 7523)"].lab}`),
      "OAuth: CIMD": () => navigate("/cimd-privilege"),
    },
    "mcp-agents": {
      "MCP Protocol": () => openEdu(EDU.MCP_PROTOCOL, "what"),
      "Agent-to-Agent (A2A)": () => navigate("/a2a-protocol-learning"),
      "Jev: Decision Model": () => navigate("/jev-learning"),
      "MCP Server Discovery": () => navigate("/mcp-discovery"),
      "MCP: MFA Gate on Tools": () => openEdu(EDU.MCP_PROTOCOL, "mfa-gate"),
      "MCP Elicitation": () => openEdu(EDU.MCP_ELICITATION, "what"),
      "Agent Gateway": () => navigate("/agent-gateway-authorization"),
      "Agent Gateway Authorization": () => navigate("/agent-gateway-authorization"),
      "Computer Use Agent (CUA)": () => navigate("/personal-agent-design"),
      "Human-in-the-loop": () => openEdu(EDU.HUMAN_IN_LOOP, "what"),
      "PingOne Agent Gateway Security": () =>
        openEdu(EDU.PINGGATEWAY_MCP, "overview"),
      "Enterprise-Managed Auth (EMA)": () =>
        openEdu(EDU.ENTERPRISE_MANAGED_AUTH, "overview"),
      "Agent Kill Switch": () => openEdu(EDU.KILL_SWITCH, "what"),
      "Shadow AI Detector": () => navigate("/ai-gateway/shadow-ai-detector"),
    },
    "ping-ai-products": {
      "Agent IAM Core": () => navigate("/ai-products/core"),
      "Agent Gateway": () => navigate("/privilege-mcp-diagrams"),
      "PingOne Authorize": () => navigate("/ai-products/authorize"),
      "Privilege for AI — LLM": () => navigate("/ai-products/privilege-llm"),
      "Privilege for AI — A2A": () => navigate("/ai-products/privilege-a2a"),
      "Privilege for AI — MCP": () => navigate("/ai-products/privilege-mcp"),
    },
    "standards-architecture": {
      "RFC & Spec Index": () => openEdu(EDU.RFC_INDEX, "index"),
      "Intent Auth Standards": () =>
        openEdu(EDU.INTENT_AUTH_STANDARDS, "rfc-foundations"),
      "IETF Standards: Agentic": () => openEdu(EDU.IETF_STANDARDS, "overview"),
      "SPIFFE / SVID Workload Identity": () => openEdu(EDU.SPIFFE, "what"),
      "ID-JAG / Cross-App Access": () => openEdu(EDU.ID_JAG, "overview"),
      "Architecture Diagram": () => navigate("/architecture/system"),
      "Token Chain (edu)": () => navigate("/architecture/token-chain"),
      "Sensitive Data & Disclosure": () =>
        openEdu(EDU.SENSITIVE_DATA, "least-data"),
      "Gateway vs P1AZ Decision Split": () => navigate("/gateway-enforcement-map"),
    },
    "project-reference": {
      "Server Capabilities": () => navigate("/architecture/server-topology"),
      "Agent Tech Comparison": () =>
        openEdu(EDU.AGENT_TECH_COMPARISON, "glance"),
    },
    "ai-ecosystem": {
      "LangChain (LCEL + LangGraph)": () =>
        openEdu(EDU.LANGCHAIN, "overview"),
      "Agent Builder Landscape": () =>
        openEdu(EDU.AGENT_BUILDER_LANDSCAPE, "langchain"),
      "LLM Landscape": () => openEdu(EDU.LLM_LANDSCAPE, "commercial"),
      "AI Platform Landscape": () =>
        openEdu(EDU.AI_PLATFORM_LANDSCAPE, "aws"),
      "AI Primer": () => openEdu(EDU.AI_PRIMER, "terminology"),
      "Vector Search & RAG (Weaviate)": () =>
        openEdu(EDU.VECTOR_RAG, "what"),
    },
    special: {
      "Glean + PingOne": () => openEdu(EDU.GLEAN, "overview"),
      "WebMCP (Google)": () => (window.location.href = "/webmcp"),
      AuthZEN: () => navigate("/pingone-authorize?tab=guided"),
      "Agentic Trust": () => (window.location.href = "/agentic-trust"),
      "Agent Guardrails": () => (window.location.href = "/agent-guardrails"),
      "OWASP Agentic": () => (window.location.href = "/owasp"),
      "Gartner Machine IAM Survey": () =>
        openEdu(EDU.MACHINE_IAM_SURVEY, "findings"),
    },
    }),
    [openEdu, tour],
  );

  // Filter categories and items based on search
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return LEARNING_CATEGORIES;

    const query = searchQuery.toLowerCase();
    return LEARNING_CATEGORIES.map((category) => ({
      ...category,
      items: category.items.filter(
        (item) => lessonSearchText(category, item).includes(query),
      ),
    })).filter((category) => category.items.length > 0);
  }, [searchQuery]);

  const handleItemClick = (categoryId: string, itemLabel: string) => {
    const actionFn =
      categoryActionMap[categoryId as keyof typeof categoryActionMap]?.[
        itemLabel as any
      ];
    if (actionFn) {
      actionFn();
    }
  };

  const totalItems = LEARNING_CATEGORIES.reduce(
    (sum, cat) => sum + cat.items.length,
    0,
  );
  const filteredItems = filteredCategories.reduce(
    (sum, cat) => sum + cat.items.length,
    0,
  );
  const filteredLiveItems = filteredCategories.reduce(
    (sum, cat) => sum + cat.items.filter((item) => lessonStatus(item).startsWith("LIVE")).length,
    0,
  );

  return (
    <div className="learning-hub">
      <header className="learning-hub__header">
        <div className="learning-hub__header-top">
          <h1 className="learning-hub__title">Learning Hub</h1>
          <button
            type="button"
            className="learning-hub__theme-toggle"
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
          </button>
        </div>
        <p className="learning-hub__subtitle">
          Explore {totalItems} topics about OAuth, agents, MCP, and more
        </p>

        <a
          className="learning-hub__weblink"
          href="https://cmuir_pingcorp.github.io/llama-vscode-setup-guide/learning/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Share these topics on the web — open the public Learning Hub ↗
        </a>

        <LearningHubAgent />
        <LearningHubDocuments />

        {!searchQuery.trim() && (
          <>
            <section className="learning-hub__academy-entry" aria-labelledby="learning-hub-academy-title">
              <div className="learning-hub__academy-copy">
                <span className="learning-hub__academy-eyebrow">AI Security Academy</span>
                <h2 id="learning-hub-academy-title">See agent security controls work together</h2>
                <p>
                  Follow a guided customer story from agent identity and delegated access through
                  policy, MCP enforcement, approval, and audit evidence. Every stop opens a working
                  demo surface or a clearly labeled bounded evidence check.
                </p>
                <div className="learning-hub__academy-actions">
                  <Link className="learning-hub__academy-primary" to="/academy/journey">
                    Start guided journey
                  </Link>
                  <Link className="learning-hub__academy-secondary" to="/academy/demos">
                    Open standalone demos
                  </Link>
                  <Link className="learning-hub__academy-secondary" to="/demo-map" title="Every demo step, inspector, diagram, and learning topic on one page">
                    Open the demo map
                  </Link>
                </div>
              </div>
              <div className="learning-hub__academy-proof" aria-label="Academy learning outcomes">
                <span>What you will prove</span>
                <strong>Who acted, what was allowed, and what happened next.</strong>
                <small>Live links, read-only evidence checks, and honest demo boundaries.</small>
              </div>
            </section>

            <section className="learning-hub__path" aria-labelledby="learning-hub-path-title">
              <div className="learning-hub__path-header">
                <div>
                  <span className="learning-hub__path-eyebrow">Recommended path</span>
                  <h2 id="learning-hub-path-title">Secure one agent action from identity to evidence</h2>
                </div>
                <p>
                  A four-stop customer story using the live surfaces already in this demo.
                  Run it in order, then branch into the topic cards below.
                </p>
              </div>
              <div className="learning-hub__path-grid">
                {RECOMMENDED_PATH.map((item) => (
                  <article className="learning-hub__path-card" key={item.step}>
                    <span className="learning-hub__path-step">{item.step}</span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <Link to={item.href}>{item.cta}</Link>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        <div className="learning-hub__search">
          <input
            type="text"
            className="learning-hub__search-input"
            placeholder="Search topics, keywords, standards..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search learning topics"
          />
          {searchQuery && (
            <button
              className="learning-hub__search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {searchQuery && (
          <div className="learning-hub__search-results">
            Found {filteredItems} of {totalItems} topics · {filteredLiveItems} live or configured
          </div>
        )}
      </header>

      <div className="learning-hub__categories">
        {filteredCategories.map((category) => (
          <section key={category.id} className="learning-hub__category">
            <h2 className="learning-hub__category-title">
              <span className="learning-hub__category-icon">
                {category.icon}
              </span>
              {category.label}
            </h2>

            <div className="learning-hub__cards">
              {category.items.map((item) => {
                const itemId = `${category.id}__${item.label.replace(/\s+/g, "-").toLowerCase()}`;
                const status = lessonStatus(item);
                return (
                  <button
                    key={itemId}
                    className="learning-hub__card"
                    onClick={() => handleItemClick(category.id, item.label)}
                    type="button"
                    data-lesson-status={status}
                  >
                    <div className="learning-hub__card-icon">
                      {item.icon}
                    </div>
                    <div className="learning-hub__card-content">
                      <div className="learning-hub__card-title-row">
                        <h3 className="learning-hub__card-title">{item.label}</h3>
                        <span className={`learning-hub__status learning-hub__status--${status.toLowerCase().replace(/\s+\/\s+/, "-")}`}>
                          {status}
                        </span>
                      </div>
                      {item.description && (
                        <p className="learning-hub__card-description">
                          {item.description}
                        </p>
                      )}
                      {item.demoStep && (
                        <span className="learning-hub__card-links">
                          <Link
                            className="learning-hub__card-step"
                            to={`/use-cases#${item.demoStep.useCaseId}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            Demo step {item.demoStep.number ?? demoStepLabel(item.demoStep.useCaseId) ?? item.demoStep.useCaseId} · /use-cases
                          </Link>
                          {getConfig(item.demoStep.useCaseId) && (
                            <Link
                              className="learning-hub__card-diagram"
                              to={useCaseDiagramPath(item.demoStep.useCaseId)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Diagram ↗
                            </Link>
                          )}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {!searchQuery && (
        <section className="learning-hub__live-demo">
          <h2 className="learning-hub__live-demo-title">Live Token Chain Demo</h2>
          <p className="learning-hub__live-demo-description">
            As you explore the topics above and request agent actions from the dashboard,
            watch the token transformation happen in real-time below. This shows exactly
            how tokens flow through the system during OAuth flows, token exchange, and delegation.
          </p>
          <div className="learning-hub__chain-container">
            <TokenChainTraceRail />
          </div>
        </section>
      )}

      {filteredCategories.length === 0 && (
        <div className="learning-hub__no-results">
          <p>No topics found matching "{searchQuery}"</p>
          <button
            className="learning-hub__reset-button"
            onClick={() => setSearchQuery("")}
          >
            Clear search
          </button>
        </div>
      )}
    </div>
  );
}
