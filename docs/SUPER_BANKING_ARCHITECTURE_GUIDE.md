# Super Banking Architecture Guide

## Overview

This document provides a comprehensive overview of the Super Banking AI Banking Demo architecture, including all major components, their relationships, and key integration points. The architecture is designed as a three-layer stack with clear security boundaries and modern authentication patterns.

## Architecture Diagram

**Main Diagram:** [Banking-Architecture.drawio](diagrams/Banking-Architecture.drawio)

The architecture diagram visualizes the complete system including:
- Browser Layer (React SPA)
- Backend-for-Frontend (BFF) Layer
- MCP Server Layer
- External Services Integration

## Component Layers

### 1. Browser Layer

**React SPA (`banking_api_ui`)**
- **Dashboard**: Main user interface for banking operations
- **Admin Panel**: Administrative interface for system management
- **Education Panels**: Interactive learning content for OAuth and security concepts
- **AI Agent FAB**: Floating action button for AI assistant interaction
- **Self-Service UI**: User-friendly account management interfaces

**Browser Security**
- **httpOnly Session Cookie**: Prevents XSS attacks on session tokens
- **SameSite=Lax**: Mitigates CSRF attacks
- **XSS Protection**: Content Security Policy and input sanitization
- **CSRF Protection**: SameSite cookies and anti-forgery tokens

**User Interface**
- **Profile Management**: User profile settings and preferences
- **Account Overview**: Account balances and summaries
- **Transaction History**: Transaction records and filtering
- **Security Center**: MFA settings and security preferences
- **Education Content**: Interactive learning modules

### 2. Backend-for-Frontend (BFF) Layer

**Express Server (`demo_api_server`)**
- **OAuth Flows**: Authorization Code + PKCE, CIBA, Client Credentials
- **Session Management**: Server-side session persistence
- **Token Custodian**: Secure token storage and management
- **MCP Proxy**: Posts HTTP JSON-RPC to MCP Gateway (`:3005`); a WebSocket path exists for `tools/list` but HTTP is the primary tool-call transport
- **CIBA Gateway**: Backchannel authentication initiation
- **API Endpoints**: RESTful APIs for frontend consumption

**OAuth Service**
- **PKCE Login**: Secure authorization code flow with proof key
- **Token Exchange**: RFC 8693 token exchange for delegation
- **Token Refresh**: Automatic token renewal
- **CIBA Initiation**: Client-initiated backchannel authentication
- **MFA Step-Up**: Multi-factor authentication challenges

**Session Store**
- **Redis (Vercel)**: Distributed session storage for serverless
- **LMDB (Local)**: Local session storage for development
- **Token Storage**: Secure token persistence
- **Session Persistence**: Cross-function invocation state
- **Serverless Support**: Cold-start friendly session management

### 3. MCP Gateway (`demo_mcp_gateway`, port 3005)

The MCP Gateway is the inline per-tool security enforcement point that sits between the BFF and the MCP Server.

#### Security Enforcement

- **RFC 7662 Token Introspection**: Introspects the bearer token against PingOne Authorization Server (`:9001`) on every tool call; results are cached for 5 seconds
- **PingOne Authorize Policy Decisions**: Evaluates a policy decision (PERMIT / DENY / INDETERMINATE) for each tool call
- **HITL Challenges**: Issues a human-in-the-loop challenge when the policy returns INDETERMINATE
- **Token Forwarding**: On PERMIT, forwards the original bearer token unchanged to the MCP Server (HTTP path)
- **Audit Trail Header**: Adds `X-Gw-Audit-Trail` response header containing `{introspection, authorize, mtls, route}` metadata

### 4. MCP Server Layer

**MCP Server (`banking_mcp_server`)**
- **WebSocket Connections**: Real-time communication with frontend
- **Tool Registry**: Dynamic tool registration and discovery
- **Tool Execution**: Secure tool execution with authorization
- **Auth Challenge Gating**: Step-up authentication for sensitive operations
- **Request Routing**: Request processing and routing
- **Token Validation**: JWT validation and claims extraction

**Agent Integration**

- **Heuristic Routing (first)**: `processAgentMessage` runs heuristic matching before any LLM call; on a match (`kind='banking'` or `kind='vertical'`) it returns immediately — in `heuristics` mode no LLM call ever occurs
- **Pre-execution Intent Gating**: When `ff_intent_authorization_enabled=true`, `agentInvokeRoute.js` runs `extractIntentFromPrompt` before `processAgentMessage`; denied → 403, consent required → 428, neither result ever reaches the agent loop
- **Node.js Reasoning Loop**: The LLM path calls `runReasonLoop` (Node.js, `agentReasoningClient.js`) against the TypeScript reasoning service at `:3006` (`demo_agent_service`); there is no Python process in the production path
- **BFF-side Tool Execution**: Tool calls are executed BFF-side via `executeBffTool → runMcpToolPipeline`; the BFF proxies each tool call through the MCP Gateway at `:3005`
- **State Management**: Conversation state persistence
- **Error Handling**: Graceful error recovery and reporting

**Tool Registry**
- **Banking Tools**: Account management and transaction tools
- **Account Management**: Balance inquiries and account details
- **Transaction Processing**: Transfer and payment operations
- **Security Operations**: MFA and authentication management
- **Educational Tools**: Interactive learning and demonstration tools
- **Audit Functions**: Comprehensive logging and audit trails

## External Services

### PingOne Identity
- **OAuth Provider**: OpenID Connect and OAuth 2.0 token issuance
- **User Management**: User directory and profile management
- **MFA Services**: Multi-factor authentication methods
- **Token Validation**: JWT signature validation and claims verification
- **Policy Enforcement**: Authentication and authorization policies
- **CIBA Support**: Client-initiated backchannel authentication

### PingOne Authorize
- **Transaction Authorization**: Real-time transaction approval
- **MCP Delegation**: Tool access authorization decisions
- **Policy Decisions**: Policy-based access control
- **Step-Up Requirements**: Adaptive authentication triggers
- **Risk Assessment**: Transaction risk evaluation
- **Audit Logging**: Authorization event logging

### Reasoning Service (`demo_agent_service`, port 3006)

- **TypeScript/Node.js**: The production agent reasoning service; no Python process is involved
- **`runReasonLoop`**: Entry point called by the BFF's `agentReasoningClient.js` for all LLM-driven turns
- **Tool Results**: Tool calls are executed BFF-side and results fed back into the reasoning loop
- **Local Only**: Security boundary - no external network access

### Vercel Platform
- **Serverless Functions**: Function-as-a-service deployment
- **Edge Deployment**: Global edge network distribution
- **Environment Variables**: Secure configuration management
- **Build Process**: Automated build and deployment pipeline
- **CDN Distribution**: Static asset delivery optimization
- **Analytics**: Performance and usage analytics

### Data Store
- **Demo Accounts**: Sample banking account data
- **Transaction Records**: Transaction history and logs
- **User Profiles**: User preference and profile data
- **Audit Logs**: Comprehensive system audit trails
- **Configuration**: System configuration and settings
- **Session Data**: Session state and temporary data

### Monitoring & Logging
- **Application Logs**: Structured application logging
- **Error Tracking**: Error monitoring and alerting
- **Performance Metrics**: System performance monitoring
- **User Analytics**: User behavior and usage analytics
- **Security Events**: Security incident detection and logging
- **System Health**: Health checks and status monitoring

## Security Architecture

### Security Boundaries
1. **Browser Boundary**: Client-side security controls
2. **BFF Boundary**: Server-side authentication and authorization
3. **MCP Boundary**: Tool execution and agent security
4. **External Boundary**: Third-party service integration

### Authentication Flows
1. **Authorization Code + PKCE**: Standard user authentication
2. **CIBA**: Backchannel authentication for high-value operations
3. **Token Exchange**: Delegated access for MCP tools
4. **Step-Up Authentication**: Adaptive MFA for sensitive operations

### Token Management
1. **Token Custodian Pattern**: BFF holds all tokens server-side
2. **Token Exchange**: RFC 8693 delegation for tool access
3. **Token Refresh**: Automatic token renewal
4. **Token Validation**: JWT signature and claims validation

### Data Protection
1. **Encryption in Transit**: TLS for all network communications
2. **Encryption at Rest**: Secure storage of sensitive data
3. **Token Security**: Secure token storage and handling
4. **Session Security**: Secure session management

## Integration Patterns

### Component Communication
- **HTTP/HTTPS**: RESTful API communication
- **WebSocket**: Real-time bidirectional communication
- **OAuth 2.0**: Secure delegated access
- **JWT**: Token-based authentication and authorization

### Data Flow Patterns
- **Request-Response**: Standard HTTP request-response
- **Event-Driven**: WebSocket event handling
- **Stream Processing**: Real-time data streaming
- **Batch Processing**: Bulk data operations

### Security Patterns
- **Zero Trust**: Verify all requests
- **Defense in Depth**: Multiple security layers
- **Least Privilege**: Minimum required access
- **Secure by Default**: Secure default configurations

## Deployment Architecture

### Development Environment
- **Local Development**: Local LMDB and in-memory session store
- **Docker Support**: Containerized development environment
- **Hot Reload**: Development-time code reloading

### Production Environment
- **Vercel Deployment**: Serverless function deployment
- **Edge Computing**: Global edge network distribution
- **Managed Services**: Redis for session storage
- **Monitoring**: Production monitoring and alerting

### Scalability Considerations
- **Horizontal Scaling**: Serverless function scaling
- **Session Management**: Distributed session storage
- **Database Scaling**: Read replicas and sharding
- **CDN Caching**: Static asset caching

## Standards and Compliance

### Implemented Standards
- **OAuth 2.0**: RFC 6749 - Authorization framework
- **PKCE**: RFC 7636 - Proof Key for Code Exchange
- **OpenID Connect**: OIDC 1.0 - Identity layer
- **JWT**: RFC 7519 - JSON Web Tokens
- **Token Exchange**: RFC 8693 - OAuth Token Exchange
- **CIBA**: OpenID CIBA Core 1.0 - Backchannel Authentication
- **Token Introspection**: RFC 7662 - OAuth 2.0 Token Introspection (used by MCP Gateway per tool call)
- **Intent Tokens**: `draft-ietf-oauth-intent-token` - OAuth intent tokens for pre-execution authorization gating

### Security Best Practices
- **OWASP Top 10**: Protection against common vulnerabilities
- **OAuth 2.0 Security**: RFC 9700 security best practices
- **JWT Security**: Secure JWT implementation
- **Session Security**: Secure session management
- **API Security**: Secure API design and implementation

## Monitoring and Observability

### Application Monitoring
- **Performance Metrics**: Response times and throughput
- **Error Rates**: Error tracking and alerting
- **User Analytics**: User behavior and usage patterns
- **System Health**: Health checks and status monitoring

### Security Monitoring
- **Authentication Events**: Login and logout tracking
- **Authorization Events**: Access control monitoring
- **Security Incidents**: Security event detection
- **Compliance Monitoring**: Regulatory compliance tracking

### Business Metrics
- **Transaction Volume**: Transaction processing metrics
- **User Engagement**: User interaction metrics
- **Feature Usage**: Feature adoption and usage
- **System Utilization**: Resource utilization metrics

## Future Enhancements

### Planned Improvements
- **Enhanced Analytics**: Advanced analytics and reporting
- **Mobile Support**: Mobile application development
- **Advanced Security**: Enhanced security features
- **Performance Optimization**: System performance improvements

### Scalability Enhancements
- **Microservices**: Service decomposition and scaling
- **Event Streaming**: Real-time event processing
- **Advanced Caching**: Multi-layer caching strategy
- **Global Deployment**: Multi-region deployment

## Recent Additions (June 2026)

### Authorize Engine Selector (`authorize_mode`)

The `AUTHORIZE_MODE` env/configStore key selects the policy decision engine: `pingone` (strict, Docker default), `simulated` (fully offline), or `pingone-with-simulated-fallback`. The simulated `demo_authz_server` is held parity-equal to PingOne Authorize — any change to decision params, contexts, or response shape must be mirrored in both. The `ff_authorize_real` admin toggle switches the mode at runtime without a restart.

### PingGateway (Alternative MCP Gateway, port 3036)

PingGateway (Ping Identity IG) is the alternative MCP gateway, selected by `ff_mcp_gateway_pinggateway` (default true). Unlike the Node gateway it performs its own RFC 8693 single-resource exchange and a live-switchable real→mock Authorize failover via the `X-Authz-Simulated` header. It sends `UserId` + `McpResourceUri` in every `McpToolCall` Authorize request. The Node gateway (`demo_mcp_gateway`, port 3005) remains available for comparison.

### Copilot Studio Integration (`agent_token_service`, port 8097)

`agent_token_service` is a standalone Node/TS PingOne agent-token broker for Microsoft Copilot Studio. It accepts inbound calls with a static `x-api-key`, mints a `client_credentials` token for a dedicated `AI_AGENT` app (scope `agent:invoke`, audience `agentgateway.ping.demo`), and holds both the PingOne client secret and the API key server-side. In Copilot Studio mode the user-token custody remains platform-side. The service is not included in docker-compose and must be run separately.

### AG-UI Streaming

The agent layer supports AG-UI streaming, enabling real-time event delivery from the reasoning loop to the browser. Tool invocations, intermediate reasoning steps, and final responses are streamed as typed events, reducing perceived latency and enabling the Security Showcase and HITL consent modal to update without polling.

### Security Showcase

The Security Showcase is a chip panel embedded in the agent UI across all five verticals (banking, healthcare, retail, sporting-goods, workforce). It presents three tabs — **Defenses**, **AI Reasoning**, and **Attacks** — and demonstrates six live attacks (prompt injection, indirect injection, wrong audience, scope escalation, confused deputy, and HITL receipt-binding replay) alongside the controls that stop each one. See [SECURITY_ARCHITECTURE.md](SECURITY_ARCHITECTURE.md) §9 for the full attack-defense mapping.

### Live Policy Console (`/pingone-authorize`)

The Live Policy Console is an overhauled inspection surface for PingOne Authorize. It renders the live policy tree (POLICY_SET → POLICY → RULE), a recent-decisions table, and an Evaluate tab with presets (Transaction / MCP First Tool / Custom) plus full request/response JSON. Access was relaxed from admin-only to any authenticated user. The page warms the Authorize connection on boot and page load.

### AI Control Plane (`/ai-control-plane`)

The AI Control Plane provides cross-platform agent governance. Stopping an agent revokes its identity at PingOne, making its access die everywhere at once — no per-service call is required. The kill event is logged to the audit trail and broadcast over SSE. Governance scenarios include group-deny, unauthorized-tool alert, and a Compliance Report view with CSV/JSON export.

---

## Conclusion

The Super Banking architecture demonstrates modern security patterns, scalable design principles, and comprehensive integration capabilities. The three-layer architecture provides clear separation of concerns while maintaining security boundaries and enabling flexible deployment options.

The system serves as a reference implementation for secure, scalable financial services applications with modern authentication and authorization patterns.
