# Horizontal Scaling Architecture Guide

This document describes how AI-DEMO2 is prepared for horizontal scaling (multiple concurrent processes/containers).

## Phase 3: Architecture Preparation (Current State)

The codebase is structured with **adapter patterns** for all stateful components, allowing easy switching between single-process and multi-process backends.

## Feature Flags for Backend Selection

All stateful components can be toggled via environment variables:

### 1. Session Store Backend

```bash
# Default (single process)
SESSION_STORE_TYPE=lmdb

# Horizontal scaling
SESSION_STORE_TYPE=redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=<password>
```

**Current State**: LMDB (single-process)
**Ready For**: Redis (multi-process, shared sessions)

---

### 2. Data Store Backend

```bash
# Default (in-memory, single process)
DATA_STORE_TYPE=memory

# PostgreSQL (multi-process, shared data)
DATA_STORE_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<password>
DB_NAME=ai_demo

# MongoDB (multi-process)
DATA_STORE_TYPE=mongo
MONGO_URI=mongodb://localhost:27017/ai_demo

# DynamoDB (AWS multi-region)
DATA_STORE_TYPE=dynamodb
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
DYNAMODB_TABLE=ai_demo_accounts
```

**Current State**: In-memory Maps with LMDB persistence (single-process)
**Ready For**: PostgreSQL, MongoDB, DynamoDB (multi-process with ACID guarantees)

**Interface Contract**:
- `createAccount()`, `updateAccount()`, `getAccountById()`, `getAccountsByUserId()`
- `applyTransfer()` (atomic, with overdraft protection)
- `createUser()`, `updateUser()`, `getUserById()`

---

### 3. OAuth Log Provider

```bash
# Default (file-based, single instance)
LOGS_PROVIDER=file
LOGS_DIR=./data/logs

# CloudWatch (AWS centralized logging)
LOGS_PROVIDER=cloudwatch
AWS_REGION=us-east-1
LOG_GROUP=/ai-demo/oauth-logs
LOG_STREAM=<instance-id>

# DataDog (observability platform)
LOGS_PROVIDER=datadog
DATADOG_API_KEY=<key>
DATADOG_SITE=datadoghq.com

# Splunk (enterprise logging)
LOGS_PROVIDER=splunk
SPLUNK_HEC_URL=https://splunk.example.com:8088
SPLUNK_HEC_TOKEN=<token>

# Google Cloud Logging (Stackdriver)
LOGS_PROVIDER=stackdriver
GCP_PROJECT_ID=<project>
GCP_SERVICE_ACCOUNT=/path/to/service-account.json
```

**Current State**: File-based, per-user log files with local rotation
**Ready For**: CloudWatch, DataDog, Splunk, Stackdriver (centralized aggregation across instances)

**Interface Contract**:
- `appendLine(line, userId)` - write log with user context
- `getRecentLines(userId, limit)` - read user's logs
- `persistToDisk()` - force flush to backend
- `reloadFromDisk()` - load from backend

---

### 4. Token Chain Event Store

```bash
# Default (LMDB file-based, single process)
EVENT_STORE_TYPE=lmdb
LOCAL_STORE_PATH=./data/token-chains

# PostgreSQL (multi-process)
EVENT_STORE_TYPE=postgres
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<password>
DB_NAME=ai_demo

# MongoDB (multi-process)
EVENT_STORE_TYPE=mongo
MONGO_URI=mongodb://localhost:27017/ai_demo

# Firestore (Google Cloud)
EVENT_STORE_TYPE=firestore
GCP_PROJECT_ID=<project>
GCP_SERVICE_ACCOUNT=/path/to/service-account.json

# DynamoDB (AWS)
EVENT_STORE_TYPE=dynamodb
AWS_REGION=us-east-1
DYNAMODB_TABLE=ai_demo_token_events
```

**Current State**: LMDB, per-user event files with 500-event limit per user
**Ready For**: PostgreSQL, MongoDB, Firestore, DynamoDB (distributed event storage)

**Interface Contract**:
- `recordEvent(event)` - store token chain event
- `getEventsByUserId(userId)` - retrieve user's events (ordered chronologically)
- `getAllEvents()` - retrieve all events
- `persistToDisk()` - force flush
- `reloadFromDisk()` - load from backend

---

## Deployment Scenarios

### Single Container (Development/Demo)

```bash
# All defaults (in-memory, file-based, no external services needed)
SESSION_STORE_TYPE=lmdb
DATA_STORE_TYPE=memory
LOGS_PROVIDER=file
EVENT_STORE_TYPE=lmdb
```

✅ Fast startup
✅ No external dependencies
❌ Data lost on restart
❌ Cannot scale horizontally

---

### Multiple Containers with Restart Resilience

```bash
# Persistent but still single-instance safe
SESSION_STORE_TYPE=lmdb
DATA_STORE_TYPE=memory      # with file persistence
LOGS_PROVIDER=file
EVENT_STORE_TYPE=lmdb       # with file persistence
```

✅ Data survives restarts
✅ No external dependencies
✅ Multiple containers with stateless design possible
❌ Cannot share state across instances (data per container)

---

### Horizontal Scaling (Multiple Instances)

```bash
# Shared backend services required
SESSION_STORE_TYPE=redis
DATA_STORE_TYPE=postgres    # or mongo/dynamodb
LOGS_PROVIDER=cloudwatch    # or datadog/splunk/stackdriver
EVENT_STORE_TYPE=postgres   # or mongo/firestore/dynamodb

# External services
REDIS_URL=redis://cache.example.com:6379
DB_HOST=db.example.com
AWS_REGION=us-east-1
```

✅ State shared across all instances
✅ True horizontal scaling (add/remove containers dynamically)
✅ Distributed session management
✅ Centralized audit trail
✅ Multi-region deployment possible (with appropriate backends)

---

## Migration Path

### Phase 1 → Phase 2: Single Container with Restart Resilience
- Enable file persistence for LMDB and OAuth logs
- No code changes required
- Data survives container restarts
- `docker-compose restart api` preserves user sessions and audit trail

### Phase 2 → Phase 3: Multi-Container Scaling
1. Deploy Redis cluster (for SESSION_STORE)
2. Deploy PostgreSQL (for DATA_STORE + EVENT_STORE)
3. Set environment variables to new backends
4. Restart containers (they auto-switch to Redis/PostgreSQL)
5. Scale up: `docker-compose up -d --scale api=3`

No application code changes needed — only configuration!

---

## Testing Adapter Implementations

Phase 3 tests verify the adapter pattern interfaces are correctly defined:

```bash
npm test src/__tests__/*adapter-pattern.test.js
```

These tests confirm:
- ✅ Feature flags exist and are recognized
- ✅ Configuration parameters documented
- ✅ Interface contracts enforced
- ✅ Fallback strategies defined
- ✅ Multi-instance safety considered

---

## Future Implementation (When Ready)

### Session Store Adapter
- File: `/services/redis/sessionStore.js` (ready to implement)
- Implements Express SessionStore interface
- Transparent drop-in replacement

### DataStore Adapter
- File: `/data/adapters/postgresDataStore.js` (ready to implement)
- File: `/data/adapters/mongoDataStore.js` (ready to implement)
- Implements BaseDataStore interface
- Atomic transfer operations (database transactions)

### Log Provider Adapter
- File: `/services/logProviders/cloudwatchProvider.js` (ready to implement)
- File: `/services/logProviders/datadogProvider.js` (ready to implement)
- Implements LogProvider interface

### Event Store Adapter
- File: `/services/eventStores/postgresEventStore.js` (ready to implement)
- Implements EventStore interface
- Full ACID compliance

---

## Summary

**Today** (Phase 1-2):
- ✅ Concurrent user safety
- ✅ Restart resilience
- ✅ Single container ready

**Tomorrow** (Phase 3 - Adapter Implementation):
- Deploy Redis → SESSION_STORE_TYPE=redis
- Deploy PostgreSQL → DATA_STORE_TYPE=postgres
- Configure CloudWatch → LOGS_PROVIDER=cloudwatch
- Scale to N containers

**No code changes required** — only configuration!