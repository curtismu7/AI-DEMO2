import { EDU } from "../components/education/educationIds";

export interface EducationTopic {
  label: string;
  description?: string;
  icon: string;
  actionId: string;
}

export interface EducationCategory {
  id: string;
  label: string;
  icon: string;
  items: EducationTopic[];
}

export const EDUCATION_CATEGORIES: EducationCategory[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    icon: "demo",
    items: [
      {
        label: "Guided Demo Tour",
        description: "Interactive walkthrough of the platform",
        icon: "arc",
        actionId: "demo-tour",
      },
      {
        label: "Best Practices",
        description: "Learn industry best practices for AI agents",
        icon: "*",
        actionId: "best-practices",
      },
      {
        label: "Agentic Maturity Model",
        description: "Understand agent development stages",
        icon: "*",
        actionId: "maturity-model",
      },
    ],
  },
  {
    id: "oauth-identity",
    label: "OAuth & Identity",
    icon: "key",
    items: [
      {
        label: "Auth Code + PKCE",
        description: "OAuth 2.0 authorization code flow with PKCE security",
        icon: "key",
        actionId: "auth-code-pkce",
      },
      {
        label: "PKCE Deep Dive",
        description: "Proof Key for Code Exchange explained",
        icon: "key",
        actionId: "pkce-dive",
      },
      {
        label: "CIBA (OOB)",
        description: "Client Initiated Backchannel Authentication",
        icon: "mbl",
        actionId: "ciba",
      },
      {
        label: "Token Exchange (RFC 8693)",
        description: "Convert between different token types",
        icon: "syn",
        actionId: "token-exchange",
      },
      {
        label: "may_act / act claims",
        description: "Delegation and actor claims in tokens",
        icon: "demo",
        actionId: "may-act",
      },
      {
        label: "Actor Token (Agent)",
        description: "Tokens for autonomous agents",
        icon: "demo",
        actionId: "actor-token",
      },
      {
        label: "Step-up MFA",
        description: "Multi-factor authentication escalation",
        icon: "lck",
        actionId: "step-up-mfa",
      },
      {
        label: "Introspection (RFC 7662)",
        description: "Validate and inspect token contents",
        icon: "srch",
        actionId: "introspection",
      },
      {
        label: "PingOne Authorize",
        description: "Fine-grained authorization policies",
        icon: "pol",
        actionId: "pingone-authorize",
      },
      {
        label: "PAR (RFC 9126)",
        description: "Pushed Authorization Requests",
        icon: "log",
        actionId: "par",
      },
      {
        label: "RAR (RFC 9396)",
        description: "Rich Authorization Requests",
        icon: "log",
        actionId: "rar",
      },
      {
        label: "JWT Client Auth (RFC 7523)",
        description: "Secure client authentication with JWTs",
        icon: "sec",
        actionId: "jwt-client-auth",
      },
      {
        label: "OAuth: CIMD",
        description: "Customer Identity Management with CIMD",
        icon: "file",
        actionId: "cimd",
      },
    ],
  },
  {
    id: "mcp-agents",
    label: "MCP & Agents",
    icon: "mcp",
    items: [
      {
        label: "MCP Protocol",
        description: "Model Context Protocol fundamentals",
        icon: "dbg",
        actionId: "mcp-protocol",
      },
      {
        label: "MCP Server Discovery",
        description: "How agents discover and register MCP servers",
        icon: "dbg",
        actionId: "mcp-discovery",
      },
      {
        label: "MCP: MFA Gate on Tools",
        description: "Protect sensitive tools with MFA",
        icon: "dbg",
        actionId: "mcp-mfa-gate",
      },
      {
        label: "MCP Elicitation",
        description: "How agents learn tool capabilities",
        icon: "dbg",
        actionId: "mcp-elicitation",
      },
      {
        label: "Agent Gateway",
        description: "Central hub for agent-server communication",
        icon: "web",
        actionId: "agent-gateway",
      },
      {
        label: "Computer Use Agent (CUA)",
        description: "Agents that interact with UI/UX",
        icon: "clk",
        actionId: "cua",
      },
      {
        label: "Human-in-the-loop",
        description: "HITL flows for sensitive operations",
        icon: "dlg",
        actionId: "hitl",
      },
      {
        label: "Ping Agent Gateway Security",
        description: "Security architecture of PingGateway",
        icon: "shld",
        actionId: "pinggateway-mcp",
      },
      {
        label: "Enterprise-Managed Auth",
        description: "IdP-centralized MCP access (MCP extension)",
        icon: "pol",
        actionId: "enterprise-managed-auth",
      },
    ],
  },
  {
    id: "standards-architecture",
    label: "Standards & Architecture",
    icon: "doc",
    items: [
      {
        label: "RFC & Spec Index",
        description: "Complete reference of standards used",
        icon: "doc",
        actionId: "rfc-index",
      },
      {
        label: "Intent Auth Standards",
        description: "Standards for intent-based authorization",
        icon: "shld",
        actionId: "intent-auth",
      },
      {
        label: "IETF Standards: Agentic",
        description: "IETF specs for autonomous agents",
        icon: "*",
        actionId: "ietf-standards",
      },
      {
        label: "ID-JAG / Cross-App Access",
        description: "Identity across distributed applications",
        icon: "flw",
        actionId: "id-jag",
      },
      {
        label: "Architecture Diagram",
        description: "System architecture overview",
        icon: "bld",
        actionId: "arch-diagram",
      },
      {
        label: "Token Chain (edu)",
        description: "How tokens flow through the system",
        icon: "lnk",
        actionId: "token-chain",
      },
      {
        label: "Sensitive Data & Disclosure",
        description: "Protecting sensitive information",
        icon: "lck",
        actionId: "sensitive-data",
      },
    ],
  },
  {
    id: "project-reference",
    label: "Project Reference",
    icon: "ref",
    items: [
      {
        label: "Server Capabilities",
        description: "What this server can do",
        icon: "doc",
        actionId: "server-capabilities",
      },
      {
        label: "Agent Tech Comparison",
        description: "Different agent frameworks compared",
        icon: "agt",
        actionId: "agent-tech-comparison",
      },
    ],
  },
  {
    id: "ai-ecosystem",
    label: "AI Ecosystem",
    icon: "ai",
    items: [
      {
        label: "LangChain (LCEL + LangGraph)",
        description: "LangChain ecosystem for AI applications",
        icon: "lnk",
        actionId: "langchain",
      },
      {
        label: "Agent Builder Landscape",
        description: "Overview of agent building frameworks",
        icon: "agt",
        actionId: "agent-builder-landscape",
      },
      {
        label: "LLM Landscape",
        description: "Available large language models",
        icon: "ai",
        actionId: "llm-landscape",
      },
      {
        label: "AI Platform Landscape",
        description: "AI platforms and services",
        icon: "web",
        actionId: "ai-platform-landscape",
      },
      {
        label: "AI Primer",
        description: "Introduction to AI and ML concepts",
        icon: "ref",
        actionId: "ai-primer",
      },
    ],
  },
  {
    id: "special",
    label: "Special Topics",
    icon: "*",
    items: [
      {
        label: "Glean + PingOne",
        description: "Enterprise search integration",
        icon: "lnk",
        actionId: "glean",
      },
      {
        label: "WebMCP (Google)",
        description: "Google's Web MCP implementation",
        icon: "web",
        actionId: "webmcp",
      },
      {
        label: "AuthZEN",
        description: "Authorization interoperability",
        icon: "pol",
        actionId: "authzen",
      },
      {
        label: "Agentic Trust",
        description: "Building trust in AI agents",
        icon: "shld",
        actionId: "agentic-trust",
      },
      {
        label: "Agent Guardrails",
        description: "How Ping keeps AI agents inside explicit guardrails",
        icon: "shld",
        actionId: "agent-guardrails",
      },
      {
        label: "OWASP Agentic",
        description: "Security for autonomous agents",
        icon: "shld",
        actionId: "owasp-agentic",
      },
    ],
  },
];

export const createEducationActionMap = (
  openEdu: (eduId: string, tab: string) => void,
  tour: { start: () => void },
) => ({
  "demo-tour": () => tour.start(),
  "best-practices": () => openEdu(EDU.BEST_PRACTICES, "overview"),
  "maturity-model": () => openEdu(EDU.AGENTIC_MATURITY, "overview"),
  "auth-code-pkce": () => openEdu(EDU.LOGIN_FLOW, "what"),
  "pkce-dive": () => openEdu(EDU.LOGIN_FLOW, "pkce"),
  ciba: () =>
    window.dispatchEvent(
      new CustomEvent("education-open-ciba", { detail: { tab: "what" } }),
    ),
  "token-exchange": () => openEdu(EDU.TOKEN_EXCHANGE, "why"),
  "may-act": () => openEdu(EDU.MAY_ACT, "what"),
  "actor-token": () => openEdu(EDU.TOKEN_FLOW, "diagram"),
  "step-up-mfa": () => openEdu(EDU.STEP_UP, "what"),
  introspection: () => openEdu(EDU.INTROSPECTION, "why"),
  "pingone-authorize": () => openEdu(EDU.PINGONE_AUTHORIZE, "what"),
  par: () => openEdu(EDU.PAR, "what"),
  rar: () => openEdu(EDU.RAR, "what"),
  "jwt-client-auth": () => openEdu(EDU.JWT_CLIENT_AUTH, "what"),
  cimd: () =>
    window.dispatchEvent(
      new CustomEvent("education-open-cimd", { detail: { tab: "what" } }),
    ),
  "mcp-protocol": () => openEdu(EDU.MCP_PROTOCOL, "what"),
  "mcp-discovery": () => openEdu(EDU.MCP_PROTOCOL, "discovery"),
  "mcp-mfa-gate": () => openEdu(EDU.MCP_PROTOCOL, "mfa-gate"),
  "mcp-elicitation": () => openEdu(EDU.MCP_ELICITATION, "what"),
  "agent-gateway": () => openEdu(EDU.AGENT_GATEWAY, "overview"),
  cua: () => openEdu(EDU.CUA, "what"),
  hitl: () => openEdu(EDU.HUMAN_IN_LOOP, "what"),
  "pinggateway-mcp": () => openEdu(EDU.PINGGATEWAY_MCP, "overview"),
  "enterprise-managed-auth": () => openEdu(EDU.ENTERPRISE_MANAGED_AUTH, "overview"),
  "rfc-index": () => openEdu(EDU.RFC_INDEX, "index"),
  "intent-auth": () =>
    openEdu(EDU.INTENT_AUTH_STANDARDS, "rfc-foundations"),
  "ietf-standards": () => openEdu(EDU.IETF_STANDARDS, "overview"),
  "id-jag": () => openEdu(EDU.ID_JAG, "overview"),
  "arch-diagram": () => openEdu(EDU.ARCHITECTURE_DIAGRAM, "context"),
  "token-chain": () => openEdu(EDU.TOKEN_CHAIN, "overview"),
  "sensitive-data": () => openEdu(EDU.SENSITIVE_DATA, "least-data"),
  "server-capabilities": () => openEdu(EDU.SERVER_CAPABILITIES, "map"),
  "agent-tech-comparison": () =>
    openEdu(EDU.AGENT_TECH_COMPARISON, "glance"),
  langchain: () => openEdu(EDU.LANGCHAIN, "overview"),
  "agent-builder-landscape": () =>
    openEdu(EDU.AGENT_BUILDER_LANDSCAPE, "langchain"),
  "llm-landscape": () => openEdu(EDU.LLM_LANDSCAPE, "commercial"),
  "ai-platform-landscape": () =>
    openEdu(EDU.AI_PLATFORM_LANDSCAPE, "aws"),
  "ai-primer": () => openEdu(EDU.AI_PRIMER, "terminology"),
  glean: () => openEdu(EDU.GLEAN, "overview"),
  webmcp: () => (window.location.href = "/webmcp"),
  authzen: () => openEdu(EDU.AUTHZEN, "overview"),
  "agentic-trust": () => (window.location.href = "/agentic-trust"),
  "agent-guardrails": () => (window.location.href = "/agent-guardrails"),
  "owasp-agentic": () => (window.location.href = "/owasp"),
});
