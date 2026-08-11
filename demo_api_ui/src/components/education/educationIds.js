// banking_api_ui/src/components/education/educationIds.js
export const EDU = {
  LOGIN_FLOW: "login-flow",
  TOKEN_EXCHANGE: "token-exchange",
  MAY_ACT: "may-act",
  MCP_PROTOCOL: "mcp-protocol",
  INTROSPECTION: "introspection",
  AGENT_GATEWAY: "agent-gateway",
  RFC_INDEX: "rfc-index",
  STEP_UP: "step-up",
  PINGONE_AUTHORIZE: "pingone-authorize",
  CIMD: "cimd",
  /** Computer Use Agent — screen-observing agent loop vs structured tool-use */
  CUA: "cua",
  /** Human-in-the-loop: mandatory human approval before high-impact agent-related actions */
  HUMAN_IN_LOOP: "human-in-loop",
  /** PingOne five best practices for AI agent security */
  BEST_PRACTICES: "best-practices",
  /** Pushed Authorization Requests — RFC 9126 */
  PAR: "par",
  /** Rich Authorization Requests — RFC 9396 */
  RAR: "rar",
  /** JWT-based client authentication — RFC 7523 / private_key_jwt */
  JWT_CLIENT_AUTH: "jwt-client-auth",
  /** PingOne Agentic Maturity Model — 3 levels of agent identity controls */
  AGENTIC_MATURITY: "agentic-maturity",
  /** OpenID Connect 2.1 — what changed from Core 1.0, why it matters for AI agents */
  OIDC_21: "oidc-21",
  /** LangChain 0.3.x — LCEL, multi-provider LLM switching, agent architecture */
  LANGCHAIN: "langchain",
  /** Agent builder landscape — LangChain, open-source frameworks, commercial platforms, and comparison */
  AGENT_BUILDER_LANDSCAPE: "agent-builder-landscape",
  /** LLM landscape — commercial and open-source models, capabilities overview, and comparison */
  LLM_LANDSCAPE: "llm-landscape",
  /** Sensitive Data & Selective Disclosure — field-level scopes, least-data principle, RAR */
  SENSITIVE_DATA: "sensitive-data",
  /** AI platform landscape — AWS, Microsoft, Google, IBM, Anthropic, OpenAI tools overview and vendor comparison */
  AI_PLATFORM_LANDSCAPE: "ai-platform-landscape",
  /** PingGateway MCP security — securing MCP servers with PingGateway, custom vs PingGateway comparison */
  PINGGATEWAY_MCP: "pinggateway-mcp",
  /** C4 architecture diagram — top-down architecture of the banking demo at 4 levels */
  ARCHITECTURE_DIAGRAM: "architecture-diagram",
  /** Token chain — delegation tracking through OAuth token exchanges */
  TOKEN_CHAIN: "token-chain",
  /** RFC 8693 Token Exchange — OAuth 2.0 Token Exchange standard */
  RFC_8693: "rfc-8693",
  /** Flow Diagrams — Technical architecture diagrams with RFC annotations */
  FLOW_DIAGRAMS: "flow-diagrams",
  /** IETF Standards for Agentic Identity — RFC7523bis, Identity Chaining, JAG-IR, AIMS, WIMSE, SD-JWT VC, PQ/T JOSE */
  IETF_STANDARDS: "ietf-standards",
  /** Token Flow — end-to-end 2-exchange RFC 8693 delegation: tokens, audiences, scopes, act chain */
  TOKEN_FLOW: "token-flow",
  /** AI Primer — Terminology, Foundations, Prompts, Workflow, and authoring background for the Technical Enablement Guide */
  AI_PRIMER: "ai-primer",
  /** ID-JAG / Cross-App Access (XAA) — Identity Assertion JWT Authorization Grant — IETF draft, PingOne SSO, limitations */
  ID_JAG: "id-jag",
  /** Glean Integration — Enterprise AI assistant with PingFed, PingOne Authorization Server, CIBA, and Ping Agent Gateway */
  GLEAN: "glean",
  /** Weaviate Vector Search — Semantic search and RAG with vector embeddings */
  VECTOR_RAG: "vector-rag",
  /** Intent-Bound, Constraint-Based Delegation — AP2, Verifiable Intent, consent verification, and how this demo implements the pattern */
  INTENT_DELEGATION: "intent-delegation",
  /** AuthZEN — OpenID Foundation working group standardizing PEP/PDP authorization API */
  AUTHZEN: "authzen",
  /** WebMCP — Browser-native MCP tool access via BFF proxy; tokens stay server-side */
  WEB_MCP: "web-mcp",
  /** MCP Elicitation — server-to-client requests for user input during tool calls (form mode + URL mode) */
  MCP_ELICITATION: "mcp-elicitation",
  /** MCP Enterprise-Managed Authorization — IdP-centralized MCP access (io.modelcontextprotocol/enterprise-managed-authorization) */
  ENTERPRISE_MANAGED_AUTH: "enterprise-managed-auth",
  /** AgentRestrictions — P1AZ at the resource server, per-user agent capability control */
  AGENT_RESTRICTIONS: "agent-restrictions",
  /** TransactionTokens — TraT context binding + mTLS gateway enforcement */
  TRANSACTION_TOKENS: "transaction-tokens",
  /** DPoP — sender-constrained tokens (cnf.jkt + per-hop proof), RFC 9449 */
  DPOP: "dpop",
  /** Agent Frameworks — AG-UI packages + LlamaIndex + compliance inventory; Heuristics/Gemini/llama.cpp brains */
  AGENT_FRAMEWORKS: "agent-frameworks",
  /** Vertical Setup — Multi-tenancy: manifest-driven verticals, plugin architecture, admin controls */
  VERTICAL_SETUP: "vertical-setup",
  /** Intent Authorization & Industry Standards — RFC 8693, AP2, KYA, confidence scoring, our code vs industry */
  INTENT_AUTH_STANDARDS: "intent-auth-standards",
  /** On-Behalf-Of (OBO) — plain-language conceptual intro to agent delegation; cross-links to RFC 8693 / may_act / Token Chain */
  OBO: "obo",
  /** Agent-to-Agent (A2A) — per-vertical specialist delegation, nested act chain, Authorize-decides-over-the-act-chain (no may_act) */
  A2A_DELEGATION: "a2a-delegation",
  /** AI Attacks — real-world attack patterns: prompt injection, indirect injection, unauthorized commitments, and the controls that stop them */
  AI_ATTACKS: "ai-attacks",
  /** Server Capabilities — plain-English description of every server: what it does, what it accepts, how it fits */
  SERVER_CAPABILITIES: "server-capabilities",
  /** Agent Tech Comparison — technical comparison of LangChain, Mastra, OpenAI Agents, Pydantic AI with decision guide */
  AGENT_TECH_COMPARISON: "agent-tech-comparison",
  /** Gartner Machine IAM Survey — top 5 findings and how this demo answers them */
  MACHINE_IAM_SURVEY: "machine-iam-survey",
  /** Session-scoped agent kill switch — real enforcement point, audit trail, and what's a concept vs. shipped */
  KILL_SWITCH: "kill-switch",
};
