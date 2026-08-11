import React, { useState, useMemo } from "react";
import { useEducationUI } from "../context/EducationUIContext";
import { useDemoTour } from "../context/DemoTourContext";
import { EDU } from "./education/educationIds";
import TokenChainTraceRail from "./TokenChainTraceRail";
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
  action: () => void;
}

const LEARNING_CATEGORIES: LearningCategory[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: "💡",
    items: [
      {
        label: "Guided Demo Tour",
        description: "Interactive walkthrough of the platform",
        icon: "🎯",
        action: () => {},
      },
      {
        label: "Best Practices",
        description: "Learn industry best practices for AI agents",
        icon: "⭐",
        action: () => {},
      },
      {
        label: "Agentic Maturity Model",
        description: "Understand agent development stages",
        icon: "📈",
        action: () => {},
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
        action: () => {},
      },
      {
        label: "PKCE Deep Dive",
        description: "Proof Key for Code Exchange explained",
        icon: "🔍",
        action: () => {},
      },
      {
        label: "CIBA (OOB)",
        description: "Client Initiated Backchannel Authentication",
        icon: "📱",
        action: () => {},
      },
      {
        label: "Token Exchange (RFC 8693)",
        description: "Convert between different token types",
        icon: "🔄",
        action: () => {},
      },
      {
        label: "may_act / act claims",
        description: "Delegation and actor claims in tokens",
        icon: "👥",
        action: () => {},
      },
      {
        label: "Actor Token (Agent)",
        description: "Tokens for autonomous agents",
        icon: "🤖",
        action: () => {},
      },
      {
        label: "Step-up MFA",
        description: "Multi-factor authentication escalation",
        icon: "🔒",
        action: () => {},
      },
      {
        label: "Introspection (RFC 7662)",
        description: "Validate and inspect token contents",
        icon: "🔎",
        action: () => {},
      },
      {
        label: "PingOne Authorize",
        description: "Fine-grained authorization policies",
        icon: "⚖️",
        action: () => {},
      },
      {
        label: "PAR (RFC 9126)",
        description: "Pushed Authorization Requests",
        icon: "📤",
        action: () => {},
      },
      {
        label: "RAR (RFC 9396)",
        description: "Rich Authorization Requests",
        icon: "📋",
        action: () => {},
      },
      {
        label: "JWT Client Auth (RFC 7523)",
        description: "Secure client authentication with JWTs",
        icon: "🎫",
        action: () => {},
      },
      {
        label: "OAuth: CIMD",
        description: "Customer Identity Management with CIMD",
        icon: "👤",
        action: () => {},
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
        action: () => {},
      },
      {
        label: "MCP Server Discovery",
        description: "How agents discover and register MCP servers",
        icon: "🔍",
        action: () => {},
      },
      {
        label: "MCP: MFA Gate on Tools",
        description: "Protect sensitive tools with MFA",
        icon: "🛡️",
        action: () => {},
      },
      {
        label: "MCP Elicitation",
        description: "How agents learn tool capabilities",
        icon: "🎓",
        action: () => {},
      },
      {
        label: "Agent Gateway",
        description: "Central hub for agent-server communication",
        icon: "🌐",
        action: () => {},
      },
      {
        label: "Computer Use Agent (CUA)",
        description: "Agents that interact with UI/UX",
        icon: "🖱️",
        action: () => {},
      },
      {
        label: "Human-in-the-loop",
        description: "HITL flows for sensitive operations",
        icon: "👨‍💼",
        action: () => {},
      },
      {
        label: "Ping Agent Gateway Security",
        description: "Security architecture of PingGateway",
        icon: "🔐",
        action: () => {},
      },
      {
        label: "Enterprise-Managed Auth (EMA)",
        description: "Zero-touch OAuth for MCP with IdP-driven provisioning",
        icon: "🏢",
        action: () => {},
      },
      {
        label: "Agent Kill Switch",
        description: "Session-scoped revocation, active-run audit trail, and what's a concept vs. shipped",
        icon: "⚠️",
        action: () => {},
      },
    ],
  },
  {
    id: "standards-architecture",
    label: "Standards & Architecture",
    icon: "📐",
    items: [
      {
        label: "RFC & Spec Index",
        description: "Complete reference of standards used",
        icon: "📚",
        action: () => {},
      },
      {
        label: "Intent Auth Standards",
        description: "Standards for intent-based authorization",
        icon: "✅",
        action: () => {},
      },
      {
        label: "IETF Standards: Agentic",
        description: "IETF specs for autonomous agents",
        icon: "📜",
        action: () => {},
      },
      {
        label: "ID-JAG / Cross-App Access",
        description: "Identity across distributed applications",
        icon: "🌉",
        action: () => {},
      },
      {
        label: "Architecture Diagram",
        description: "System architecture overview",
        icon: "🏗️",
        action: () => {},
      },
      {
        label: "Token Chain (edu)",
        description: "How tokens flow through the system",
        icon: "⛓️",
        action: () => {},
      },
      {
        label: "Sensitive Data & Disclosure",
        description: "Protecting sensitive information",
        icon: "🔒",
        action: () => {},
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
        action: () => {},
      },
      {
        label: "Agent Tech Comparison",
        description: "Different agent frameworks compared",
        icon: "📊",
        action: () => {},
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
        action: () => {},
      },
      {
        label: "Agent Builder Landscape",
        description: "Overview of agent building frameworks",
        icon: "🛠️",
        action: () => {},
      },
      {
        label: "LLM Landscape",
        description: "Available large language models",
        icon: "🧠",
        action: () => {},
      },
      {
        label: "AI Platform Landscape",
        description: "AI platforms and services",
        icon: "☁️",
        action: () => {},
      },
      {
        label: "AI Primer",
        description: "Introduction to AI and ML concepts",
        icon: "📚",
        action: () => {},
      },
      {
        label: "Vector Search & RAG (Weaviate)",
        description: "How semantic code search stores and finds embeddings",
        icon: "🧬",
        action: () => {},
      },
    ],
  },
  {
    id: "special",
    label: "Special Topics",
    icon: "⭐",
    items: [
      {
        label: "Glean + PingOne",
        description: "Enterprise search integration",
        icon: "🔍",
        action: () => {},
      },
      {
        label: "WebMCP (Google)",
        description: "Proposed web standard for exposing tools to AI agents",
        icon: "🌐",
        action: () => {},
      },
      {
        label: "AuthZEN",
        description: "Authorization interoperability",
        icon: "🔑",
        action: () => {},
      },
      {
        label: "Agentic Trust",
        description: "Building trust in AI agents",
        icon: "🤝",
        action: () => {},
      },
      {
        label: "Agent Guardrails",
        description: "How Ping keeps AI agents inside explicit guardrails",
        icon: "🛡️",
        action: () => {},
      },
      {
        label: "OWASP Agentic",
        description: "Security for autonomous agents",
        icon: "🛡️",
        action: () => {},
      },
      {
        label: "Gartner Machine IAM Survey",
        description: "Top 5 findings and how this demo answers them",
        icon: "📊",
        action: () => {},
      },
    ],
  },
];

export default function LearningHub() {
  const { open: openEdu } = useEducationUI();
  const tour = useDemoTour();
  const [searchQuery, setSearchQuery] = useState("");

  const categoryActionMap = useMemo(
    () => ({
    "getting-started": {
      "Guided Demo Tour": () => tour.start(),
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
      "Token Exchange (RFC 8693)": () => openEdu(EDU.TOKEN_EXCHANGE, "why"),
      "may_act / act claims": () => openEdu(EDU.MAY_ACT, "what"),
      "Actor Token (Agent)": () => openEdu(EDU.TOKEN_FLOW, "diagram"),
      "Step-up MFA": () => openEdu(EDU.STEP_UP, "what"),
      "Introspection (RFC 7662)": () => openEdu(EDU.INTROSPECTION, "why"),
      "PingOne Authorize": () => openEdu(EDU.PINGONE_AUTHORIZE, "what"),
      "PAR (RFC 9126)": () => openEdu(EDU.PAR, "what"),
      "RAR (RFC 9396)": () => openEdu(EDU.RAR, "what"),
      "JWT Client Auth (RFC 7523)": () => openEdu(EDU.JWT_CLIENT_AUTH, "what"),
      "OAuth: CIMD": () =>
        window.dispatchEvent(
          new CustomEvent("education-open-cimd", { detail: { tab: "what" } }),
        ),
    },
    "mcp-agents": {
      "MCP Protocol": () => openEdu(EDU.MCP_PROTOCOL, "what"),
      "MCP Server Discovery": () => openEdu(EDU.MCP_PROTOCOL, "discovery"),
      "MCP: MFA Gate on Tools": () => openEdu(EDU.MCP_PROTOCOL, "mfa-gate"),
      "MCP Elicitation": () => openEdu(EDU.MCP_ELICITATION, "what"),
      "Agent Gateway": () => openEdu(EDU.AGENT_GATEWAY, "overview"),
      "Computer Use Agent (CUA)": () => openEdu(EDU.CUA, "what"),
      "Human-in-the-loop": () => openEdu(EDU.HUMAN_IN_LOOP, "what"),
      "Ping Agent Gateway Security": () =>
        openEdu(EDU.PINGGATEWAY_MCP, "overview"),
      "Enterprise-Managed Auth (EMA)": () =>
        openEdu(EDU.ENTERPRISE_MANAGED_AUTH, "overview"),
      "Agent Kill Switch": () => openEdu(EDU.KILL_SWITCH, "what"),
    },
    "standards-architecture": {
      "RFC & Spec Index": () => openEdu(EDU.RFC_INDEX, "index"),
      "Intent Auth Standards": () =>
        openEdu(EDU.INTENT_AUTH_STANDARDS, "rfc-foundations"),
      "IETF Standards: Agentic": () => openEdu(EDU.IETF_STANDARDS, "overview"),
      "ID-JAG / Cross-App Access": () => openEdu(EDU.ID_JAG, "overview"),
      "Architecture Diagram": () =>
        openEdu(EDU.ARCHITECTURE_DIAGRAM, "context"),
      "Token Chain (edu)": () => openEdu(EDU.TOKEN_CHAIN, "overview"),
      "Sensitive Data & Disclosure": () =>
        openEdu(EDU.SENSITIVE_DATA, "least-data"),
    },
    "project-reference": {
      "Server Capabilities": () =>
        openEdu(EDU.SERVER_CAPABILITIES, "map"),
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
      AuthZEN: () => openEdu(EDU.AUTHZEN, "overview"),
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
        (item) =>
          item.label.toLowerCase().includes(query) ||
          (item.description && item.description.toLowerCase().includes(query)),
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

  return (
    <div className="learning-hub">
      <header className="learning-hub__header">
        <h1 className="learning-hub__title">Learning Hub</h1>
        <p className="learning-hub__subtitle">
          Explore {totalItems} topics about OAuth, agents, MCP, and more
        </p>

        <a
          className="learning-hub__weblink"
          href="https://curtismu7.github.io/llama-vscode-setup-guide/learning/"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            margin: "4px 0 14px",
            padding: "8px 14px",
            borderRadius: 999,
            background: "#f0eefb",
            border: "1px solid #ddd5fb",
            color: "#5b3fd6",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          🌐 Share these topics on the web — open the public Learning Hub ↗
        </a>

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
            Found {filteredItems} of {totalItems} topics
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
                return (
                  <button
                    key={itemId}
                    className="learning-hub__card"
                    onClick={() => handleItemClick(category.id, item.label)}
                    type="button"
                  >
                    <div className="learning-hub__card-icon">
                      {item.icon}
                    </div>
                    <div className="learning-hub__card-content">
                      <h3 className="learning-hub__card-title">
                        {item.label}
                      </h3>
                      {item.description && (
                        <p className="learning-hub__card-description">
                          {item.description}
                        </p>
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
