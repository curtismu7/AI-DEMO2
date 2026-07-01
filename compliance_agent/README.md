# Compliance Agent - Pydantic AI

Transaction compliance and AML (Anti-Money Laundering) checking service using Pydantic AI framework.

## Overview

The Compliance Checker is an **isolated Python microservice** that:
- Receives transaction details via HTTP
- Evaluates compliance risk using type-safe Pydantic models
- Returns structured compliance assessment with AML score, flags, and recommendations
- Demonstrates **Pydantic AI** as a lightweight Python alternative to LangGraph

## Architecture

```
BFF (demo_api_server:3002)
  └─> POST /api/compliance-agent/message
       └─> Node.js HTTP bridge (complianceAgentService.js)
            └─> Compliance Agent (Python/FastAPI:3007)
                 └─> Pydantic AI agent + rule engine
```

## Setup

### 1. Install Dependencies

```bash
cd compliance_agent
pip install -r requirements.txt
```

### 2. Set Environment Variables

Create a `.env` file:
```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=your_api_key_here
COMPLIANCE_PORT=3007
COMPLIANCE_HOST=0.0.0.0
```

### 3. Run the Service

```bash
python main.py
```

The service will start on `http://localhost:3007`.

## API Endpoints

### `POST /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "compliance-agent",
  "version": "1.0.0"
}
```

### `POST /init`
Initialize compliance session.

**Request:**
```json
{
  "user_id": "user-123"
}
```

**Response:**
```json
{
  "success": true,
  "session_id": "compliance-user-123",
  "agent_type": "compliance-checker",
  "framework": "pydantic-ai"
}
```

### `POST /assess`
Assess a transaction for compliance risk.

**Request:**
```json
{
  "transaction": {
    "amount": 15000.00,
    "recipient": "Acme Corp",
    "recipient_account_type": "business",
    "user_account_age_days": 45,
    "user_recent_activity_score": 65.5,
    "is_recurring": false,
    "time_of_day_utc": "14:30"
  },
  "user_id": "user-123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "risk_level": "medium",
    "aml_score": 42.5,
    "flags": [
      {
        "code": "HIGH_AMOUNT",
        "description": "Transaction amount $15,000.00 exceeds high-risk threshold",
        "severity": "high"
      },
      {
        "code": "NEW_RECIPIENT",
        "description": "This is not a recurring transaction (first-time recipient)",
        "severity": "low"
      }
    ],
    "requires_review": true,
    "recommended_action": "REVIEW",
    "reasoning": "Transaction: $15,000.00 to Acme Corp; Flags raised: 2..."
  }
}
```

## Compliance Rules

The agent evaluates transactions across five dimensions:

### 1. Amount Rules
- **HIGH_AMOUNT** (>$10k): High-risk threshold
- **MEDIUM_AMOUNT** ($5k-$10k): Medium-risk threshold

### 2. Account Age Rules
- **NEW_ACCOUNT** (<30 days): Brand-new accounts flagged

### 3. Recipient Rules
- **SANCTIONED_RECIPIENT**: Name matches OFAC/sanctions list
- **INTERNATIONAL_TRANSFER**: International destinations need scrutiny
- **UNKNOWN_RECIPIENT_TYPE**: Unverified recipient type

### 4. Timing Rules
- **OFF_HOURS_TRANSACTION**: Initiated 2-5 AM UTC (suspicious window)

### 5. Activity Rules
- **LOW_ACTIVITY** (activity score <30): Minimal transaction history
- **NEW_RECIPIENT**: Non-recurring transaction (first-time payee)

## Risk Levels

- **low** (0-25 AML score): ALLOW
- **medium** (25-50 AML score): ALLOW with monitoring
- **high** (50-75 AML score): REVIEW recommended
- **critical** (75+ AML score): BLOCK

## Integration with BFF

The Node.js bridge (`demo_api_server/services/complianceAgentService.js`) handles:
- HTTP communication to the Python service
- Transaction payload mapping
- Response parsing and narrative building
- Error handling and fallbacks

### From the Frontend

```javascript
// Send compliance check request
POST /api/compliance-agent/message
{
  "message": "Check this transfer",
  "transaction": {
    "amount": 5000,
    "recipient": "John Doe",
    "accountAgeDays": 120,
    "activityScore": 75.5,
    "isRecurring": true,
    "timeUtc": "14:30"
  },
  "userId": "user-123"
}
```

## Framework Rationale

**Pydantic AI** is chosen for the Compliance Checker because:
- ✅ Type-safe structured outputs (transaction rules, assessment results)
- ✅ Lightweight Python alternative (no LangGraph complexity)
- ✅ Excellent for rule-based + AI reasoning workflows
- ✅ Demonstrates multi-framework strategy for education

## Files

| File | Purpose |
|------|---------|
| `main.py` | FastAPI server with health/init/assess endpoints |
| `agent.py` | Pydantic AI agent with compliance evaluation logic |
| `models.py` | Pydantic type-safe data models |
| `rules.py` | Compliance rule definitions and scoring engine |
| `.env.example` | Environment variable template |
| `requirements.txt` | Python dependencies |
| `README.md` | This file |

## Testing

### Test Health
```bash
curl http://localhost:3007/health
```

### Test Compliance Check
```bash
curl -X POST http://localhost:3007/assess \
  -H "Content-Type: application/json" \
  -d '{
    "transaction": {
      "amount": 15000,
      "recipient": "Test Corp",
      "recipient_account_type": "business",
      "user_account_age_days": 10,
      "user_recent_activity_score": 30,
      "is_recurring": false,
      "time_of_day_utc": "03:00"
    },
    "user_id": "test-user"
  }'
```

## Troubleshooting

### Module not found: pydantic_ai
```bash
pip install pydantic-ai
```

### Connection refused (port 3007)
- Check that the service is running: `python main.py`
- Verify `COMPLIANCE_PORT` environment variable
- Check for port conflicts: `lsof -i :3007`

### Anthropic API key error
- Verify `ANTHROPIC_API_KEY` is set in `.env`
- Ensure API key is valid and has access to Claude models
