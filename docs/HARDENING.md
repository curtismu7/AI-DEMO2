# Configuration Hardening

This document describes hardening measures added to prevent configuration mismatches and startup failures, particularly focusing on the OAuth credential issue that caused langchain_agent to crash on 2026-06-30.

## Issue: langchain_agent OAuth Credential Mismatch

### Root Cause
The `langchain_agent` service requires OAuth client credentials in its environment, expecting one of:
- `PINGONE_USER_CLIENT_ID` + `PINGONE_USER_CLIENT_SECRET`
- `AGENT_CLIENT_ID` + `AGENT_CLIENT_SECRET`

However, the env generation script (`demo_api_server/scripts/refresh-service-envs.js`) only provided the AI Agent actor credentials under different names (`PINGONE_AI_AGENT_ACTOR_CLIENT_ID/SECRET`), creating a mismatch that caused the container to crash on startup with a cryptic error message.

### Timeline
- **Bootstrap setup:** Generated credentials with correct names in `demo_api_server/.env`
- **Env refresh script:** Mapped credentials to **wrong names** for langchain_agent
- **Startup:** langchain_agent crashed with `No pre-provisioned OAuth client credentials found`
- **Restart loop:** Docker kept restarting the failed container indefinitely

---

## Hardening Measures

### 1. Automatic Credential Mapping (refresh-service-envs.js)
**File:** `demo_api_server/scripts/refresh-service-envs.js:315-332`

Added automatic mapping of AI Agent actor credentials to the names langchain_agent expects:
```javascript
// OAuth credentials: map AI_AGENT_ACTOR credentials to the names langchain_agent expects
PINGONE_USER_CLIENT_ID:     creds.aiAgentClientId,
PINGONE_USER_CLIENT_SECRET: creds.aiAgentSecret,
AGENT_CLIENT_ID:            creds.aiAgentClientId,
AGENT_CLIENT_SECRET:        creds.aiAgentSecret,
```

**Why:** Ensures that when bootstrap regenerates service .env files, langchain_agent automatically gets the credentials it needs without manual intervention.

**Benefit:** Even if bootstrap is rerun or .env files are regenerated, langchain_agent gets correct credentials automatically.

---

### 2. Startup Environment Validator (langchain_agent/src/config/env_validator.py)
**File:** `langchain_agent/src/config/env_validator.py`

Created a dedicated environment validator that runs **before** any OAuth manager initialization. Provides:
- Clear detection of missing OAuth credentials
- User-friendly error messages with recovery steps
- Validation of core PingOne configuration
- Fast-fail behavior (container exits immediately with helpful message)

**Example output on missing credentials:**
```
❌ Environment Validation Error:

No pre-provisioned OAuth client credentials found.

LangChain agent requires one of the following credential pairs:
  - PINGONE_USER_CLIENT_ID + PINGONE_USER_CLIENT_SECRET
  - AGENT_CLIENT_ID + AGENT_CLIENT_SECRET

To fix:
  1. Run: npm run pingone:bootstrap (if not already done)
  2. This auto-generates all required .env files including langchain_agent/.env
  3. Restart the container: docker-compose restart langchain-agent
```

**Integration:** Called in `src/main.py` immediately after logging setup, before config loading.

**Benefit:** Users see a clear error message and know exactly what to do, rather than container restart loops.

---

### 3. Pre-Startup Validation Script
**File:** `langchain_agent/scripts/validate-startup-env.sh`

Bash script that checks environment variables before Python application starts. Can be:
- Called manually for debugging
- Used as part of Docker startup
- Integrated into CI/CD pipelines

Checks for:
- OAuth credentials (both pairs)
- Core PingOne configuration
- Provides diagnostic output

**Usage:**
```bash
./langchain_agent/scripts/validate-startup-env.sh
```

---

### 4. Startup Wrapper Script
**File:** `langchain_agent/scripts/startup.sh`

Docker container entry point that:
1. Runs pre-startup validation
2. Exits cleanly if validation fails (with error message)
3. Starts Python application if validation passes

Replaces direct `python -m src.main` with a validation wrapper that prevents bad configurations from reaching the Python startup code.

**Integration:** Updated `docker-compose.yml` command to use `./scripts/startup.sh`

**Benefit:** Container exits immediately with clear error rather than attempting startup and crashing.

---

### 5. Direct Environment Variables in docker-compose.yml
**File:** `docker-compose.yml:230-233`

Added OAuth credentials directly to the langchain-agent service environment section as a **fallback** to env_file loading:

```yaml
environment:
  # ... other vars ...
  PINGONE_USER_CLIENT_ID: "71e878ea-2d79-4760-b570-66f00cbeffe7"
  PINGONE_USER_CLIENT_SECRET: "<set-via-env-see-.env.example>"
  AGENT_CLIENT_ID: "71e878ea-2d79-4760-b570-66f00cbeffe7"
  AGENT_CLIENT_SECRET: "<set-via-env-see-.env.example>"
```

**Why:** Provides a fallback if env_file loading fails or the path is incorrect.

**Benefit:** Even if the .env file path is wrong, the service still gets necessary credentials.

---

### 6. Environment Variable Schema Documentation
**File:** `docs/ENV_VALIDATION_SCHEMA.md`

Comprehensive reference guide covering:
- Required vs optional variables per service
- How variables are auto-generated
- Debugging procedures (5-step diagnostic)
- Common failure modes and fixes
- Variable categories (OAuth, endpoints, feature flags)

**Benefit:** Users have a single source of truth for "what env vars does service X need?"

---

## Deployment Implications

### For Fresh Deployments
No changes needed. The env generation script automatically handles credential mapping:
```bash
npm run pingone:bootstrap
./run.sh
```

### For Existing Deployments
If langchain_agent is failing with OAuth errors:
```bash
# Regenerate all .env files with fixed credential mapping
npm run pingone:bootstrap

# Restart the service
docker-compose restart langchain-agent

# Check that startup validation passes
docker logs ai-demo-langchain-agent | head -30
```

### For CI/CD Integration
The validation script can be used in CI pipelines:
```bash
# Validate before deploying
./langchain_agent/scripts/validate-startup-env.sh
```

---

## Prevention: Design Principles

These hardening measures follow these principles:

1. **Auto-mapping:** Let scripts handle credential name transformations rather than manual env file editing
2. **Fast-fail:** Detect problems at startup, not after restart loops
3. **Clear messages:** Users should know what's wrong and how to fix it
4. **Layered validation:** Multiple checks catch different failure modes:
   - Bash script for system-level checks
   - Python validator for application-level checks
   - Docker-compose for container configuration

---

## Future Improvements

To further prevent similar issues:

1. **Centralized env schema:** Consider using a JSON Schema to define what each service needs, then validate all services at once
2. **Type-safe configuration:** Migrate from string-based env vars to typed configuration (e.g., Pydantic models)
3. **Automatic test:** Add CI test that verifies env generation works correctly
4. **Monitoring:** Add metrics tracking how many times startup validation catches configuration errors

---

## Testing the Hardening

### Test 1: Validation catches missing credentials
```bash
# Remove OAuth credentials from environment
unset PINGONE_USER_CLIENT_ID AGENT_CLIENT_ID

# Run validator
./langchain_agent/scripts/validate-startup-env.sh

# Expected: Exit 1 with clear error message
```

### Test 2: Startup script provides helpful error
```bash
# Simulate missing env file
cd langchain_agent
env -i ./scripts/startup.sh

# Expected: Clear error message about missing credentials
```

### Test 3: docker-compose startup validation
```bash
# Start langchain-agent with validation
docker-compose up langchain-agent

# Expected: Either green checkmarks from validation or helpful error
```

### Test 4: Regenerated .env files contain credentials
```bash
npm run pingone:bootstrap

grep -E "PINGONE_USER_CLIENT|AGENT_CLIENT" langchain_agent/.env

# Expected: 4 lines with populated credentials
```

---

## Related Documentation

- [`docs/ENV_VALIDATION_SCHEMA.md`](./ENV_VALIDATION_SCHEMA.md) — Complete reference of environment variables per service
- [`langchain_agent/src/config/env_validator.py`](../langchain_agent/src/config/env_validator.py) — Source of startup validation logic
- [`demo_api_server/scripts/refresh-service-envs.js`](../demo_api_server/scripts/refresh-service-envs.js) — Env generation and credential mapping
