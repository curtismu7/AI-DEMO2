# Multi-Framework Agent Ecosystem

Educational demonstration of building AI agents with **multiple frameworks** across a unified system.

## Overview

This project implements **4 specialized agents**, each using a different framework, to show how different tools solve different problems:

| Agent | Framework | Language | Purpose | Port |
|-------|-----------|----------|---------|------|
| **Admin Agent** | LangGraph | Node.js | Admin operations with PingOne MCP tools | 3002 |
| **A2A Orchestrator** | CrewAI | Python | Multi-agent delegation & routing | 3006 |
| **Support Agent** | Mastra | Node.js | Customer support & FAQ queries | 3002 |
| **Compliance Checker** | Pydantic AI | Python | Transaction risk assessment & AML scoring | 3007 |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend (React)                     │
│              AIAgent Component with Agent Badges             │
│        [ADMIN AGENT] [A2A ORCHESTRATOR] [SUPPORT AGENT]      │
│              [COMPLIANCE CHECKER - Pydantic AI]              │
└────────────────────┬────────────────────────────────────────┘
                     │
     ┌───────────────┴───────────────┐
     │                               │
┌────▼──────────────────┐      ┌────▼──────────────────┐
│    BFF (Node.js)      │      │  Compliance Agent     │
│  demo_api_server      │      │   (Python/FastAPI)    │
│  :3002                │      │   :3007               │
│                       │      │                       │
│ ✓ Admin Agent Routes  │      │ ✓ Pydantic AI Agent   │
│ ✓ A2A Agent Routes    │      │ ✓ Rule Engine         │
│ ✓ Support Agent Routes│      │ ✓ AML Scoring         │
│ ✓ Compliance Bridge   │      │                       │
│   (HTTP to 3007)      │      │                       │
└───────────────────────┘      └───────────────────────┘

        │                              │
        └──────────────────┬───────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    ┌───▼─────┐      ┌────▼────┐      ┌─────▼────┐
    │ PingOne │      │  MCP    │      │ Anthropic│
    │ OAuth   │      │ Gateway │      │   API    │
    └─────────┘      └─────────┘      └──────────┘
```

## 1. Admin Agent — LangGraph

**Framework**: LangGraph (TypeScript via Node.js)  
**Location**: `/demo_api_server/services/adminAgentService.js`  
**Route**: `POST /api/admin-agent/message`

### Purpose
Administrative operations with elevated privileges using MCP (Model Context Protocol) tools for PingOne interactions.

### Key Features
- ✅ Reasoning loops via LangGraph (state + edges)
- ✅ PingOne MCP tool integration
- ✅ Token event tracking (RFC 8693)
- ✅ Admin-only access gate

### Example Usage
```javascript
POST /api/admin-agent/message
{
  "message": "Create a new user in PingOne",
  "sessionId": "session-123"
}
```

### Why LangGraph?
- **Complex reasoning**: Multi-step administrative workflows
- **State management**: Tracks admin context and decisions
- **Tool chaining**: Calls multiple MCP tools in sequence
- **MCP native**: Excellent integration with Model Context Protocol

---

## 2. A2A Orchestrator — CrewAI

**Framework**: CrewAI (Python)  
**Location**: `/demo_api_server/services/a2aOrchestratorService.js`  
**Route**: `POST /api/a2a/message`

### Purpose
Multi-agent orchestration for intelligent request delegation. Routes user queries to specialized agents based on heuristics.

### Key Features
- ✅ CrewAI crew architecture (roles + tasks)
- ✅ Heuristic-based delegation (keywords, context)
- ✅ Multi-agent coordination
- ✅ Token chain event tracking

### Routing Logic
```
User Query
  ├─ Contains "support" → Support Agent
  ├─ Contains "compliance" → Compliance Checker
  ├─ Contains "admin" → Admin Agent
  └─ Default → Customer Agent
```

### Example Usage
```javascript
POST /api/a2a/message
{
  "message": "Delegate this to a specialist for compliance review",
  "sessionId": "session-123"
}
// Routes to Compliance Checker based on "compliance" keyword
```

### Why CrewAI?
- **Multi-agent orchestration**: Manages multiple specialized agents
- **Role-based design**: Each agent has clear responsibilities
- **Hierarchical tasks**: Breaks complex problems into subtasks
- **Educational value**: Shows agent collaboration patterns

---

## 3. Support Agent — Mastra

**Framework**: Mastra (@mastra/core, TypeScript)  
**Location**: `/demo_api_server/services/supportAgentService.js`  
**Route**: `POST /api/support-agent/message`

### Purpose
Lightweight customer support assistant with FAQ lookups and service tools.

### Key Features
- ✅ Mastra Agent class (simpler than LangGraph)
- ✅ 5 built-in tools: balance, transactions, FAQ, ATM, ticket
- ✅ Streaming response support
- ✅ Tool execution via Zod schemas

### Tools
1. `get_account_balance` — Show current balance
2. `get_recent_transactions` — List last 10 transactions
3. `lookup_faq` — Search 12-item FAQ database
4. `find_atm_location` — Find nearest ATM
5. `submit_support_ticket` — Escalate to humans

### Example Usage
```javascript
POST /api/support-agent/message
{
  "message": "What's my current balance?",
  "sessionId": "session-123"
}
```

### Why Mastra?
- **Lightweight**: No complex state management needed
- **Tool-first design**: Natural for Q&A + tool-calling workflows
- **Same language**: JavaScript/TypeScript alongside LangGraph
- **Educational**: Shows simpler alternative to LangGraph for straightforward tasks
- **FAQ perfect fit**: Designed for knowledge-base queries

---

## 4. Compliance Checker — Pydantic AI

**Framework**: Pydantic AI (Python)  
**Location**: `/compliance_agent/agent.py`  
**Route**: `POST /api/compliance-agent/message` (via Node.js bridge)

### Purpose
Type-safe transaction compliance assessment with AML (Anti-Money Laundering) scoring.

### Key Features
- ✅ Pydantic AI (type-safe structured outputs)
- ✅ Compliance rule engine (5 rule categories)
- ✅ AML score calculation (0-100)
- ✅ Risk-level determination (low/medium/high/critical)

### Compliance Rules
1. **Amount Rules**: Thresholds ($5k, $10k)
2. **Account Age**: New account detection (<30 days)
3. **Recipient Rules**: OFAC screening, international checks
4. **Timing Rules**: Off-hours transaction detection
5. **Activity Rules**: User history and velocity checks

### Structured Output
```python
@dataclass
class ComplianceCheck:
    risk_level: str           # "low" | "medium" | "high" | "critical"
    aml_score: float          # 0-100 risk score
    flags: List[Flag]         # Compliance concerns
    requires_review: bool     # HITL review needed?
    recommended_action: str   # "ALLOW" | "REVIEW" | "BLOCK"
    reasoning: str            # Human-readable explanation
```

### Example Usage
```javascript
POST /api/compliance-agent/message
{
  "transaction": {
    "amount": 15000,
    "recipient": "Acme Corp",
    "accountAgeDays": 10,
    "activityScore": 30,
    "isRecurring": false,
    "timeUtc": "03:00"
  },
  "userId": "user-123"
}
// Returns risk assessment with AML score, flags, recommendation
```

### Why Pydantic AI?
- **Type-safe**: Structured outputs validated at runtime
- **Python ecosystem**: Access to compliance libraries, ML models
- **Educational**: Shows Python alternative to JavaScript agents
- **Perfect fit**: Rule-based + AI reasoning (hybrid approach)
- **Lightweight microservice**: Isolated, single responsibility

---

## Integration Points

### 1. Frontend Display
All agents are identified with **framework badges**:
```javascript
[ADMIN AGENT - LangGraph]
[A2A ORCHESTRATOR - CrewAI]
[SUPPORT AGENT - Mastra]
[COMPLIANCE CHECKER - Pydantic AI]
```

### 2. Token Chain Events
All agents track token exchange events:
- **Request token** → Agent receives user's token
- **Worker token** → Agent mints CC token for MCP calls
- **Delegation token** → A2A routes to specialist
- **Response token** → User receives updated token

### 3. Activity Narration
"What's Happening" panel shows agent activity:
- ✓ Admin Agent initiated tool call
- ✓ Support Agent queried FAQ database
- ✓ Compliance Agent assessed transaction risk
- ✓ A2A Orchestrator delegated to specialist

---

## Educational Value

### Multi-Framework Perspective
Each agent demonstrates **framework strengths**:

| Framework | Best For | Advantage |
|-----------|----------|-----------|
| **LangGraph** | Complex reasoning loops | Graph-based state management |
| **CrewAI** | Multi-agent orchestration | Role/task abstraction |
| **Mastra** | Q&A + tool-calling | Simplicity & performance |
| **Pydantic AI** | Type-safe structured outputs | Runtime validation |

### Learning Outcomes
1. ✅ **Framework selection**: Choose right tool for the job
2. ✅ **Microservice architecture**: Isolated, independent services
3. ✅ **HTTP integration**: Python + Node.js working together
4. ✅ **Token management**: RFC 8693 delegation patterns
5. ✅ **Type safety**: Pydantic models vs loose JSON
6. ✅ **UI integration**: Multi-agent badges & status display

---

## File Structure

```
/Users/cmuir/Development/AI-DEMO2/
├── demo_api_server/
│   ├── config/
│   │   ├── support/              # Support Agent config
│   │   │   ├── index.js
│   │   │   ├── systemPrompt.js
│   │   │   ├── tools.js
│   │   │   └── faqDatabase.js
│   │   └── ...
│   ├── services/
│   │   ├── adminAgentService.js           # LangGraph agent
│   │   ├── a2aOrchestratorService.js      # CrewAI agent
│   │   ├── supportAgentService.js         # Mastra agent
│   │   └── complianceAgentService.js      # HTTP bridge to Python
│   ├── routes/
│   │   ├── adminAgentRoutes.js
│   │   ├── a2aAgentRoutes.js
│   │   ├── supportAgentRoutes.js
│   │   └── complianceAgentRoutes.js
│   └── server.js                          # Mounts all routes
│
├── compliance_agent/                      # Separate Python service
│   ├── main.py                            # FastAPI server
│   ├── agent.py                           # Pydantic AI agent
│   ├── models.py                          # Type-safe models
│   ├── rules.py                           # Compliance rules
│   ├── requirements.txt
│   ├── .env.example
│   ├── start.sh
│   └── README.md
│
└── AGENTS_ECOSYSTEM.md                    # This file
```

---

## Running the Complete Stack

### 1. Terminal 1: BFF (Node.js)
```bash
cd demo_api_server
npm install
npm run dev  # or: node server.js
# Runs on http://localhost:3002
```

### 2. Terminal 2: Compliance Agent (Python)
```bash
cd compliance_agent
cp .env.example .env
# Edit .env with ANTHROPIC_API_KEY
./start.sh
# Runs on http://localhost:3007
```

### 3. Terminal 3: Frontend (React)
```bash
cd demo_api_ui
npm install
REACT_APP_API_PORT=3002 npm start
# Runs on http://localhost:3000
```

---

## Testing Agents

### Admin Agent
```bash
curl -X POST http://localhost:3002/api/admin-agent/message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "List all users in PingOne"}'
```

### A2A Orchestrator
```bash
curl -X POST http://localhost:3002/api/a2a/message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Delegate this to a specialist for compliance review"}'
```

### Support Agent
```bash
curl -X POST http://localhost:3002/api/support-agent/message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the fee for international transfers?"}'
```

### Compliance Checker
```bash
curl -X POST http://localhost:3002/api/compliance-agent/message \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "transaction": {
      "amount": 15000,
      "recipient": "Acme Corp",
      "accountAgeDays": 10,
      "activityScore": 30,
      "isRecurring": false,
      "timeUtc": "03:00"
    },
    "userId": "user-123"
  }'
```

---

## Next Steps

### Enhancement Ideas
1. **Fraud Detection Agent** (LangChain Supervisor): Multi-agent fraud detection workflow
2. **Portfolio Advisor Agent** (OpenAI Responses API): Type-safe investment recommendations
3. **Analytics Dashboard**: Unified agent metrics and token tracking
4. **Web UI Panels**: Per-agent reasoning visualization
5. **Agent Composition**: Chain agents together (Admin → Support → Compliance)

### Production Considerations
- ✅ Rate limiting on each agent endpoint
- ✅ Circuit breaker pattern for Python service
- ✅ Metrics collection (Prometheus)
- ✅ Distributed tracing (OpenTelemetry)
- ✅ Health checks on microservices
- ✅ Graceful degradation if Python service down

---

## References

- [LangGraph Documentation](https://python.langchain.com/docs/langgraph/)
- [CrewAI Framework](https://docs.crewai.com/)
- [Mastra Framework](https://docs.mastra.ai/)
- [Pydantic AI](https://ai.pydantic.dev/)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [RFC 8693: Token Exchange](https://tools.ietf.org/html/rfc8693)

---

**Educational Objective**: Demonstrate how AI agents can be built with multiple frameworks, each optimized for specific use cases, and integrated into a cohesive system showing real-world patterns for AI application architecture.
