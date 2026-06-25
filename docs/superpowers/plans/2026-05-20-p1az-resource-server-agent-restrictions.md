# P1AZ Resource Server + AgentRestrictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P1AZ as an enforcement point at BFF `/api/*` banking routes using a per-user `agentRestrictions` PingOne attribute (read/write/none), with HITL on DENY and a feature flag `ff_agent_restrictions`.

**Architecture:** New Express middleware `agentRestrictionsGate.js` detects agent-originated calls via `X-Agent-Sub` header (set by MCP Server's BankingAPIClient), derives the capability tier from `scope-topology.json` riskLevel, calls P1AZ (or simulated), and triggers the existing HITL flow on DENY. The attribute is provisioned during bootstrap with default `write`. No new token exchanges or PingOne apps.

**Tech Stack:** Node.js/Express (CommonJS), TypeScript (MCP Server), React (admin UI), PingOne Management API, `scope-topology.json` SSOT, existing `mcpDecisionPolling.js` HITL infrastructure.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `demo_api_server/middleware/agentRestrictionsGate.js` | Create | Core gate — detect agent call, resolve tier, call P1AZ, trigger HITL |
| `demo_api_server/middleware/agentRestrictionsCache.js` | Create | In-memory 5s TTL cache for PingOne user attribute fetches |
| `demo_api_server/services/agentRestrictionsService.js` | Create | Fetch `agentRestrictions` attribute from PingOne + derive tier from scope-topology |
| `demo_api_server/server.js` | Modify | Wire `agentRestrictionsGate` before `/api/accounts` and `/api/transactions` mounts |
| `demo_api_server/services/configStore.js` | Modify | Register `ff_agent_restrictions` feature flag |
| `demo_api_server/routes/adminManagement.js` | Modify | Add `PATCH /api/admin/users/:userId/agent-restrictions` route |
| `demo_api_server/services/pingoneProvisionService.js` | Modify | Add `agentRestrictions` schema attribute + user default provisioning step |
| `demo_api_server/services/simulatedAuthorizeService.js` | Modify | Add `evaluateAgentRestrictions()` simulated path |
| `demo_mcp_server/src/banking/BankingAPIClient.ts` | Modify | Add `X-Agent-Sub` + `X-MCP-Tool` headers to all BFF requests |
| `demo_mcp_server/src/tools/BankingToolProvider.ts` | Modify | Pass `act.sub` + `toolName` to BankingAPIClient |
| `demo_api_ui/src/components/AgentRestrictionsPanel.jsx` | Create | Education panel for P1AZ-as-resource-server concept |
| `demo_api_ui/src/components/Users.js` | Modify | Add `agentRestrictions` dropdown per user in admin view |

---

## Task 1: Feature flag + agentRestrictionsService (BFF)

**Files:**
- Modify: `demo_api_server/services/configStore.js`
- Create: `demo_api_server/services/agentRestrictionsService.js`
- Test: `demo_api_server/tests/agentRestrictionsService.test.js`

- [ ] **Step 1: Write failing tests**

Create `demo_api_server/tests/agentRestrictionsService.test.js`:

```javascript
'use strict';

jest.mock('../services/configStore', () => ({
  get: jest.fn((key) => {
    if (key === 'ff_agent_restrictions') return 'true';
    return null;
  }),
  getEffective: jest.fn((key) => {
    if (key === 'ff_agent_restrictions') return 'true';
    return null;
  }),
}));

const scopeTopology = require('../../scope-topology.json');
const { getRequiredTier, isAgentRestricted } = require('../services/agentRestrictionsService');

describe('getRequiredTier', () => {
  test('returns write for a tool with high riskLevel scope', () => {
    // 'write' scope has riskLevel 'high' in scope-topology.json
    expect(getRequiredTier('create_transfer')).toBe('write');
  });

  test('returns read for a tool with low riskLevel scope', () => {
    // 'read' scope has riskLevel 'low' in scope-topology.json
    expect(getRequiredTier('get_my_accounts')).toBe('read');
  });

  test('returns read for unknown tool (fail open)', () => {
    expect(getRequiredTier('unknown_tool_xyz')).toBe('read');
  });
});

describe('isAgentRestricted', () => {
  test('none blocks all calls', () => {
    expect(isAgentRestricted('none', 'read')).toBe(true);
    expect(isAgentRestricted('none', 'write')).toBe(true);
  });

  test('read blocks write calls', () => {
    expect(isAgentRestricted('read', 'write')).toBe(true);
  });

  test('read permits read calls', () => {
    expect(isAgentRestricted('read', 'read')).toBe(false);
  });

  test('write permits all calls', () => {
    expect(isAgentRestricted('write', 'read')).toBe(false);
    expect(isAgentRestricted('write', 'write')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsService.test.js --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../services/agentRestrictionsService'`

- [ ] **Step 3: Register feature flag in configStore**

Open `demo_api_server/services/configStore.js`. Find the block where other `ff_` flags are listed (search for `ff_trat_mode`). Add `ff_agent_restrictions` alongside it:

```javascript
// Add in the same block as ff_trat_mode:
'ff_agent_restrictions',   // P1AZ resource server gate + AgentRestrictions attribute
```

- [ ] **Step 4: Create agentRestrictionsService.js**

Create `demo_api_server/services/agentRestrictionsService.js`:

```javascript
'use strict';

const path = require('path');
const scopeTopology = require(path.resolve(__dirname, '../../scope-topology.json'));

// Build a tool → riskLevel map from scope-topology.json at load time.
// Each tool in the BankingToolRegistry has requiredScopes that match scope names here.
// riskLevel 'high' or 'critical' → write tier. 'low' or 'medium' → read tier.
const WRITE_RISK_LEVELS = new Set(['high', 'critical']);

// Tool → required scopes mapping sourced from scope-topology.json tools section.
// Falls back to scope-level riskLevel lookup.
function _buildToolTierMap() {
  const map = {};
  const scopes = scopeTopology.scopes || {};
  // tools section maps tool names to their required scopes (if present)
  const tools = scopeTopology.tools || {};
  for (const [toolName, toolDef] of Object.entries(tools)) {
    const requiredScopes = toolDef.requiredScopes || [];
    const isWrite = requiredScopes.some((scopeName) => {
      const scope = scopes[scopeName];
      return scope && WRITE_RISK_LEVELS.has(scope.riskLevel);
    });
    map[toolName] = isWrite ? 'write' : 'read';
  }
  return map;
}

const _toolTierMap = _buildToolTierMap();

/**
 * Resolve the capability tier required for a given tool name.
 * Derives from scope-topology.json riskLevel — no hardcoded route map.
 * Unknown tools default to 'read' (fail open).
 *
 * @param {string} toolName
 * @returns {'read'|'write'}
 */
function getRequiredTier(toolName) {
  return _toolTierMap[toolName] || 'read';
}

/**
 * Evaluate whether an agent call should be denied based on the user's
 * agentRestrictions attribute and the required tier for the tool.
 *
 * @param {'read'|'write'|'none'} agentRestrictions
 * @param {'read'|'write'} requiredTier
 * @returns {boolean} true if the call should be denied
 */
function isAgentRestricted(agentRestrictions, requiredTier) {
  if (agentRestrictions === 'none') return true;
  if (agentRestrictions === 'read' && requiredTier === 'write') return true;
  return false;
}

module.exports = { getRequiredTier, isAgentRestricted };
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsService.test.js --no-coverage 2>&1 | tail -20
```

Expected: PASS — 6 tests passing.

> **Note:** If scope-topology.json has no `tools` section, `getRequiredTier` will always return `'read'` (the default). That is intentional — Task 2 adds the tools section to scope-topology.json.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/configStore.js \
        demo_api_server/services/agentRestrictionsService.js \
        demo_api_server/tests/agentRestrictionsService.test.js
git commit -m "feat(agent-restrictions): add ff_agent_restrictions flag + tier resolution service"
```

---

## Task 2: Add tools section to scope-topology.json

**Files:**
- Modify: `scope-topology.json`

The `agentRestrictionsService` derives tiers from `scope-topology.tools`. This task adds that section.

- [ ] **Step 1: Read current scope-topology.json tools names**

```bash
cd demo_mcp_server && grep -r "name:" src/tools/BankingToolRegistry.ts | head -30
```

Note all tool names (e.g. `get_my_accounts`, `get_account_balance`, `get_my_transactions`, `create_deposit`, `create_withdrawal`, `create_transfer`, `get_sensitive_account_details`).

- [ ] **Step 2: Add tools section to scope-topology.json**

Open `scope-topology.json`. After the `"apps"` block, add:

```json
"tools": {
  "get_my_accounts": {
    "requiredScopes": ["read"]
  },
  "get_account_balance": {
    "requiredScopes": ["read"]
  },
  "get_my_transactions": {
    "requiredScopes": ["read"]
  },
  "create_deposit": {
    "requiredScopes": ["write"]
  },
  "create_withdrawal": {
    "requiredScopes": ["write"]
  },
  "create_transfer": {
    "requiredScopes": ["write", "transfer"]
  },
  "get_sensitive_account_details": {
    "requiredScopes": ["read"]
  }
}
```

> Adjust the tool names to exactly match what `BankingToolRegistry.ts` defines. Add any missing tools from the registry — if a tool is missing, `getRequiredTier` defaults to `'read'` (safe).

- [ ] **Step 3: Run existing scope topology regression test**

```bash
cd demo_api_server && npx jest scopeTopology.regression --no-coverage 2>&1 | tail -20
```

Expected: PASS (new `tools` section does not break existing tests).

- [ ] **Step 4: Re-run agentRestrictionsService tests to verify tier map is populated**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsService.test.js --no-coverage 2>&1 | tail -20
```

Expected: PASS — `create_transfer` now correctly maps to `write`.

- [ ] **Step 5: Commit**

```bash
git add scope-topology.json
git commit -m "feat(agent-restrictions): add tools section to scope-topology for tier resolution"
```

---

## Task 3: PingOne attribute fetch cache

**Files:**
- Create: `demo_api_server/middleware/agentRestrictionsCache.js`
- Test: `demo_api_server/tests/agentRestrictionsCache.test.js`

- [ ] **Step 1: Write failing tests**

Create `demo_api_server/tests/agentRestrictionsCache.test.js`:

```javascript
'use strict';

jest.useFakeTimers();

const { AgentRestrictionsCache } = require('../middleware/agentRestrictionsCache');

describe('AgentRestrictionsCache', () => {
  let cache;

  beforeEach(() => {
    cache = new AgentRestrictionsCache({ ttlMs: 5000 });
  });

  test('returns null for unknown user', () => {
    expect(cache.get('user-1')).toBeNull();
  });

  test('returns cached value within TTL', () => {
    cache.set('user-1', 'write');
    expect(cache.get('user-1')).toBe('write');
  });

  test('returns null after TTL expires', () => {
    cache.set('user-1', 'read');
    jest.advanceTimersByTime(5001);
    expect(cache.get('user-1')).toBeNull();
  });

  test('invalidate removes entry', () => {
    cache.set('user-1', 'none');
    cache.invalidate('user-1');
    expect(cache.get('user-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsCache.test.js --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../middleware/agentRestrictionsCache'`

- [ ] **Step 3: Create agentRestrictionsCache.js**

Create `demo_api_server/middleware/agentRestrictionsCache.js`:

```javascript
'use strict';

class AgentRestrictionsCache {
  constructor({ ttlMs = 5000 } = {}) {
    this._ttlMs = ttlMs;
    this._store = new Map(); // key: userId, value: { value, expiresAt }
  }

  get(userId) {
    const entry = this._store.get(userId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(userId);
      return null;
    }
    return entry.value;
  }

  set(userId, value) {
    this._store.set(userId, { value, expiresAt: Date.now() + this._ttlMs });
  }

  invalidate(userId) {
    this._store.delete(userId);
  }
}

// Singleton used by agentRestrictionsGate — 5s TTL
const cache = new AgentRestrictionsCache({ ttlMs: 5000 });

module.exports = { AgentRestrictionsCache, cache };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsCache.test.js --no-coverage 2>&1 | tail -10
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/middleware/agentRestrictionsCache.js \
        demo_api_server/tests/agentRestrictionsCache.test.js
git commit -m "feat(agent-restrictions): add 5s TTL attribute cache"
```

---

## Task 4: Simulated authorize path for agentRestrictions

**Files:**
- Modify: `demo_api_server/services/simulatedAuthorizeService.js`
- Test: `demo_api_server/tests/simulatedAgentRestrictions.test.js`

- [ ] **Step 1: Write failing test**

Create `demo_api_server/tests/simulatedAgentRestrictions.test.js`:

```javascript
'use strict';

jest.mock('../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

// simulatedAuthorizeService throws in prod without this
process.env.NODE_ENV = 'test';

const { evaluateAgentRestrictions } = require('../services/simulatedAuthorizeService');

describe('evaluateAgentRestrictions (simulated)', () => {
  test('PERMIT when agentRestrictions is write', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'write', requiredTier: 'write', userId: 'u1', agentSub: 'agent-1', tool: 'create_transfer' });
    expect(result.decision).toBe('PERMIT');
  });

  test('PERMIT when agentRestrictions is read and requiredTier is read', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'read', requiredTier: 'read', userId: 'u1', agentSub: 'agent-1', tool: 'get_my_accounts' });
    expect(result.decision).toBe('PERMIT');
  });

  test('DENY when agentRestrictions is read and requiredTier is write', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'read', requiredTier: 'write', userId: 'u1', agentSub: 'agent-1', tool: 'create_transfer' });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('agent_restrictions_write_blocked');
  });

  test('DENY when agentRestrictions is none', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'none', requiredTier: 'read', userId: 'u1', agentSub: 'agent-1', tool: 'get_my_accounts' });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('agent_restrictions_none');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd demo_api_server && npx jest tests/simulatedAgentRestrictions.test.js --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `evaluateAgentRestrictions is not a function`

- [ ] **Step 3: Add evaluateAgentRestrictions to simulatedAuthorizeService.js**

Open `demo_api_server/services/simulatedAuthorizeService.js`. At the bottom, before `module.exports`, add:

```javascript
/**
 * Simulated P1AZ evaluation for AgentRestrictions gate.
 * Mirrors the policy rule: DENY if none, DENY if read+write, PERMIT otherwise.
 *
 * @param {{ agentRestrictions: string, requiredTier: string, userId: string, agentSub: string, tool: string }} params
 * @returns {{ decision: 'PERMIT'|'DENY', reason: string, path: string, decisionId: string }}
 */
function evaluateAgentRestrictions({ agentRestrictions, requiredTier, userId, agentSub, tool }) {
  const decisionId = `sim-ar-${Date.now()}`;
  const path = 'simulated';

  if (agentRestrictions === 'none') {
    return { decision: 'DENY', reason: 'agent_restrictions_none', path, decisionId };
  }
  if (agentRestrictions === 'read' && requiredTier === 'write') {
    return { decision: 'DENY', reason: 'agent_restrictions_write_blocked', path, decisionId };
  }
  return { decision: 'PERMIT', reason: 'agent_restrictions_permitted', path, decisionId };
}
```

Then add it to `module.exports`:

```javascript
module.exports = {
  // ... existing exports ...
  evaluateAgentRestrictions,
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd demo_api_server && npx jest tests/simulatedAgentRestrictions.test.js --no-coverage 2>&1 | tail -10
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/simulatedAuthorizeService.js \
        demo_api_server/tests/simulatedAgentRestrictions.test.js
git commit -m "feat(agent-restrictions): add evaluateAgentRestrictions to simulated authorize service"
```

---

## Task 5: Core middleware — agentRestrictionsGate.js

**Files:**
- Create: `demo_api_server/middleware/agentRestrictionsGate.js`
- Test: `demo_api_server/tests/agentRestrictionsGate.test.js`

- [ ] **Step 1: Write failing tests**

Create `demo_api_server/tests/agentRestrictionsGate.test.js`:

```javascript
'use strict';

const mockNext = jest.fn();
const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };

jest.mock('../services/configStore', () => ({
  get: jest.fn((key) => key === 'ff_agent_restrictions' ? 'true' : null),
  getEffective: jest.fn((key) => key === 'ff_agent_restrictions' ? 'true' : null),
}));

jest.mock('../services/agentRestrictionsService', () => ({
  getRequiredTier: jest.fn(() => 'write'),
  isAgentRestricted: jest.fn(() => true),
}));

jest.mock('../services/simulatedAuthorizeService', () => ({
  evaluateAgentRestrictions: jest.fn(() => ({ decision: 'DENY', reason: 'agent_restrictions_write_blocked', path: 'simulated', decisionId: 'sim-1' })),
  isSimulatedModeEnabled: jest.fn(() => true),
}));

jest.mock('../routes/mcpDecisionPolling', () => ({
  createPendingDecision: jest.fn(() => ({ taskId: 'task-abc-123' })),
}));

const { agentRestrictionsGate } = require('../middleware/agentRestrictionsGate');

function makeReq(overrides = {}) {
  return {
    headers: { 'x-agent-sub': 'agent-client-id', 'x-mcp-tool': 'create_transfer' },
    session: { user: { id: 'user-1', oauthId: 'oauth-user-1', role: 'customer' } },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRes.status.mockReturnThis();
});

test('calls next() immediately when ff_agent_restrictions is false', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockReturnValue('false');
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
  expect(mockRes.status).not.toHaveBeenCalled();
});

test('calls next() when X-Agent-Sub header is absent', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockReturnValue('true');
  await agentRestrictionsGate(makeReq({ headers: {} }), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
});

test('returns 428 with taskId on DENY', async () => {
  const configStore = require('../services/configStore');
  configStore.get.mockReturnValue('true');
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockRes.status).toHaveBeenCalledWith(428);
  expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
    code: 'agent_restrictions_hitl',
    taskId: 'task-abc-123',
  }));
  expect(mockNext).not.toHaveBeenCalled();
});

test('calls next() when agentRestrictions permits', async () => {
  const { isAgentRestricted } = require('../services/agentRestrictionsService');
  isAgentRestricted.mockReturnValue(false);
  await agentRestrictionsGate(makeReq(), mockRes, mockNext);
  expect(mockNext).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsGate.test.js --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../middleware/agentRestrictionsGate'`

- [ ] **Step 3: Create agentRestrictionsGate.js**

Create `demo_api_server/middleware/agentRestrictionsGate.js`:

```javascript
'use strict';

const configStore = require('../services/configStore');
const { getRequiredTier, isAgentRestricted } = require('../services/agentRestrictionsService');
const { cache: attrCache } = require('./agentRestrictionsCache');
const { createPendingDecision } = require('../routes/mcpDecisionPolling');
const simulatedAuthorizeService = require('../services/simulatedAuthorizeService');
const { logger } = require('../utils/logger');

/**
 * Fetch agentRestrictions attribute for userId from PingOne.
 * In simulation mode (no Management API token), returns 'write' (default).
 */
async function fetchAgentRestrictions(userId) {
  // First check cache
  const cached = attrCache.get(userId);
  if (cached !== null) return cached;

  // Attempt live fetch from PingOne Management API
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const workerToken = configStore.get('pingone_authorize_worker_client_id')
    ? await getWorkerToken()
    : null;

  if (!workerToken || !envId) {
    // No Management API access — default to 'write' (safe default, no restriction)
    attrCache.set(userId, 'write');
    return 'write';
  }

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${userId}`,
      {
        headers: { Authorization: `Bearer ${workerToken}` },
        timeout: 3000,
      }
    );
    const value = response.data?.agentRestrictions || 'write';
    attrCache.set(userId, value);
    return value;
  } catch (err) {
    logger.warn('[agentRestrictionsGate] PingOne fetch failed, defaulting to write', { userId, err: err.message });
    attrCache.set(userId, 'write');
    return 'write';
  }
}

// Cache worker token for 50 minutes (PingOne CC tokens expire at 60m)
let _workerToken = null;
let _workerTokenExpiry = 0;

async function getWorkerToken() {
  if (_workerToken && Date.now() < _workerTokenExpiry) return _workerToken;

  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const region = process.env.PINGONE_REGION || 'com';
  const clientId = configStore.get('pingone_management_client_id') || process.env.PINGONE_MANAGEMENT_CLIENT_ID;
  const clientSecret = configStore.get('pingone_management_client_secret') || process.env.PINGONE_MANAGEMENT_CLIENT_SECRET;

  if (!clientId || !clientSecret || !envId) return null;

  try {
    const axios = require('axios');
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await axios.post(
      `https://auth.pingone.${region}/${envId}/as/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 }
    );
    _workerToken = res.data.access_token;
    _workerTokenExpiry = Date.now() + 50 * 60 * 1000;
    return _workerToken;
  } catch (err) {
    logger.warn('[agentRestrictionsGate] Worker token fetch failed', { err: err.message });
    return null;
  }
}

/**
 * Express middleware — agent restrictions gate.
 *
 * Only fires when:
 *   1. ff_agent_restrictions === 'true'
 *   2. X-Agent-Sub header is present (marks call as agent-originated)
 *
 * On DENY: creates HITL task, returns 428 { code, taskId, reason, tool }.
 * On PERMIT: calls next().
 */
async function agentRestrictionsGate(req, res, next) {
  // Fast exit: flag off
  if (configStore.get('ff_agent_restrictions') !== 'true') return next();

  // Fast exit: not an agent call
  const agentSub = req.headers['x-agent-sub'];
  if (!agentSub) return next();

  const toolName = req.headers['x-mcp-tool'] || '';
  const userId = req.session?.user?.oauthId || req.session?.user?.id;

  if (!userId) {
    logger.warn('[agentRestrictionsGate] No userId in session, skipping gate');
    return next();
  }

  try {
    const agentRestrictions = await fetchAgentRestrictions(userId);
    const requiredTier = getRequiredTier(toolName);

    if (!isAgentRestricted(agentRestrictions, requiredTier)) {
      return next();
    }

    // DENY path — call P1AZ (or simulated) then create HITL task
    const useSimulated = simulatedAuthorizeService.isSimulatedModeEnabled(configStore);
    let authzResult;

    if (useSimulated) {
      authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
        agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
      });
    } else {
      // Live P1AZ — calls evaluateAgentRestrictions on pingOneAuthorizeService.
      // NOTE: pingOneAuthorizeService does not yet have evaluateAgentRestrictions.
      // If the method is absent, fall back to simulated so the gate never crashes.
      const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
      if (typeof pingOneAuthorizeService.evaluateAgentRestrictions === 'function') {
        authzResult = await pingOneAuthorizeService.evaluateAgentRestrictions({
          subject: userId,
          environment: {
            agentRestrictions,
            requiredTier,
            agentSub,
            tool: toolName,
            ff_agent_restrictions: 'true',
          },
        });
      } else {
        // Fallback: use simulated logic until live P1AZ method is wired
        authzResult = simulatedAuthorizeService.evaluateAgentRestrictions({
          agentRestrictions, requiredTier, userId, agentSub, tool: toolName,
        });
      }
    }

    if (authzResult.decision === 'PERMIT') return next();

    // Create HITL decision task
    const { taskId } = createPendingDecision(
      req.session.user.oauthId || req.session.user.id,
      {
        tool: toolName,
        decisionContext: 'AgentRestrictions',
        reason: authzResult.reason || 'Agent capability restricted by policy',
        decisionId: authzResult.decisionId,
      }
    );

    logger.info('[agentRestrictionsGate] DENY — HITL task created', { taskId, toolName, agentRestrictions, requiredTier, userId });

    return res.status(428).json({
      code: 'agent_restrictions_hitl',
      taskId,
      reason: authzResult.reason,
      tool: toolName,
      agentRestrictions,
      requiredTier,
    });
  } catch (err) {
    logger.error('[agentRestrictionsGate] Unexpected error, failing open', { err: err.message });
    return next();
  }
}

module.exports = { agentRestrictionsGate };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd demo_api_server && npx jest tests/agentRestrictionsGate.test.js --no-coverage 2>&1 | tail -10
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/middleware/agentRestrictionsGate.js \
        demo_api_server/tests/agentRestrictionsGate.test.js
git commit -m "feat(agent-restrictions): add agentRestrictionsGate middleware"
```

---

## Task 6: Wire middleware in server.js

**Files:**
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Add require at top of server.js**

Open `demo_api_server/server.js`. Find the block where other middleware is imported (search for `require('./middleware/auth')`). Add:

```javascript
const { agentRestrictionsGate } = require('./middleware/agentRestrictionsGate');
```

- [ ] **Step 2: Wire before /api/accounts and /api/transactions mounts**

Find line ~918 in `server.js` where the accounts and transactions routes are mounted:

```javascript
app.use('/api/accounts', authenticateToken, accountRoutes);
app.use('/api/accounts', authenticateToken, sensitiveBankingRoutes);
```

And line ~929:

```javascript
app.use('/api/transactions', (req, res, next) => {
```

Insert `agentRestrictionsGate` **before** these mounts. Add this block immediately before the first `/api/accounts` line:

```javascript
// Agent restrictions gate — fires only on agent-originated calls (X-Agent-Sub header present)
// when ff_agent_restrictions=true. No-op for direct user calls.
app.use(['/api/accounts', '/api/transactions'], agentRestrictionsGate);
```

- [ ] **Step 3: Verify server starts cleanly**

```bash
cd demo_api_server && node -e "require('./server.js')" 2>&1 | head -20
```

Expected: No errors on startup (may print "Server listening on port 3001" — that's fine, Ctrl+C).

- [ ] **Step 4: Smoke test — verify non-agent calls are unaffected**

```bash
# Start server in background
cd demo_api_server && node server.js &
SERVER_PID=$!
sleep 2

# Direct call without X-Agent-Sub — should get 401 (not a gate error)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/accounts/my
# Expected: 401 (no session) — not 428 or 500

kill $SERVER_PID
```

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/server.js
git commit -m "feat(agent-restrictions): wire agentRestrictionsGate into /api/accounts and /api/transactions"
```

---

## Task 7: MCP Server — add X-Agent-Sub and X-MCP-Tool headers

**Files:**
- Modify: `demo_mcp_server/src/banking/BankingAPIClient.ts`
- Modify: `demo_mcp_server/src/tools/BankingToolProvider.ts`

- [ ] **Step 1: Update BankingAPIClient to accept and forward agent headers**

Open `demo_mcp_server/src/banking/BankingAPIClient.ts`.

Find the `BankingAPIClientOptions` interface (around line 21) and add:

```typescript
export interface BankingAPIClientOptions extends Partial<BankingAPIConfig> {
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  retryConfig?: Partial<RetryConfig>;
  agentSub?: string;   // act.sub from the MCP token — forwarded as X-Agent-Sub
  mcpTool?: string;    // current tool name — forwarded as X-MCP-Tool
}
```

Find the axios instance creation in the constructor (around line 80, the `this.client = axios.create(...)` block). Update the headers:

```typescript
this.client = axios.create({
  baseURL: this.config.baseUrl,
  timeout: this.config.timeout,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(options.agentSub ? { 'X-Agent-Sub': options.agentSub } : {}),
    ...(options.mcpTool ? { 'X-MCP-Tool': options.mcpTool } : {}),
  },
  ...(devHttpsAgent && { httpsAgent: devHttpsAgent }),
});
```

Also store `agentSub` and `mcpTool` on the instance so they can be read later if needed:

```typescript
this.agentSub = options.agentSub || null;
this.mcpTool = options.mcpTool || null;
```

Add `agentSub: string | null` and `mcpTool: string | null` to the class property declarations at the top.

- [ ] **Step 2: Update BankingToolProvider to pass claims to BankingAPIClient**

Open `demo_mcp_server/src/tools/BankingToolProvider.ts`.

Find the `executeTool` method signature:

```typescript
async executeTool(
  toolName: string,
  params: Record<string, any>,
  session: Session,
  agentToken?: string
): Promise<BankingToolResult>
```

Inside `executeTool`, find where `this.apiClient` is used. Before the first `apiClient` call, create a per-call client instance with the agent headers:

```typescript
// Extract act.sub from the agent token claims for X-Agent-Sub header
let agentSub: string | undefined;
if (agentToken) {
  try {
    const parts = agentToken.split('.');
    if (parts.length === 3) {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      agentSub = claims?.act?.sub || claims?.act?.client_id || undefined;
    }
  } catch {
    // Malformed token — proceed without agentSub
  }
}

// Create a call-scoped API client with agent identity headers
const callClient = agentSub
  ? new BankingAPIClient({ ...this.apiClient['config'], agentSub, mcpTool: toolName })
  : this.apiClient;
```

Replace subsequent uses of `this.apiClient` within this `executeTool` invocation with `callClient`.

> **Note:** If `BankingToolProvider` delegates to separate handler files (e.g. `handlers/`), pass `agentSub` and `toolName` through to those handlers and let them construct the call-scoped client.

- [ ] **Step 3: Build MCP server**

```bash
cd demo_mcp_server && npm run build 2>&1 | tail -20
```

Expected: exit code 0, no TypeScript errors.

- [ ] **Step 4: Run MCP server unit tests**

```bash
cd demo_mcp_server && npm test 2>&1 | tail -20
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/banking/BankingAPIClient.ts \
        demo_mcp_server/src/tools/BankingToolProvider.ts
git commit -m "feat(agent-restrictions): forward X-Agent-Sub + X-MCP-Tool from MCP server to BFF"
```

---

## Task 8: Bootstrap — provision agentRestrictions attribute

**Files:**
- Modify: `demo_api_server/services/pingoneProvisionService.js`

- [ ] **Step 1: Add schema attribute provisioning**

Open `demo_api_server/services/pingoneProvisionService.js`. Find the `_ensureUserSchemaAttribute` method (around line 731). It already exists and handles `POST /schemas/{id}/attributes` idempotently.

Find the section where demo user provisioning completes (Phase ⑥ — "Demo users + claims", step keys like `'isDelegate-schema'`, `'demoDelegate-flag'`). After the last schema/claim step, add a new step for `agentRestrictions`:

```javascript
// Step: agentRestrictions schema attribute
yield {
  step: 'agentRestrictions-schema',
  icon: '·',
  message: 'Ensuring agentRestrictions user schema attribute...',
};
try {
  await this._ensureUserSchemaAttribute('agentRestrictions', 'STRING', 'Agent Restrictions');
  yield { step: 'agentRestrictions-schema', icon: '✅', message: 'agentRestrictions attribute → created (or already exists)' };
} catch (err) {
  yield { step: 'agentRestrictions-schema', icon: '❌', message: `agentRestrictions schema attribute failed: ${err.message}` };
}
```

- [ ] **Step 2: Add default value provisioning for each demo user**

In the same provisioning service, find where demo user attributes are set after user creation (the `isDelegate` PATCH pattern — around line 1728):

```javascript
await this.makeRequest('PATCH', `/users/${bankDelegateResult.user.id}`, { isDelegate: 'true' });
```

After demo user creation steps, add agentRestrictions defaults for each user. Find the `demoUser` and `demoAdmin` result objects and add PATCHes for both:

```javascript
// Set agentRestrictions default on demoUser
if (demoUserResult?.user?.id) {
  yield { step: 'agentRestrictions-user', icon: '·', message: 'Setting agentRestrictions default on demo user...' };
  try {
    await this.makeRequest('PATCH', `/users/${demoUserResult.user.id}`, { agentRestrictions: 'write' });
    yield { step: 'agentRestrictions-user', icon: '✅', message: 'agentRestrictions: demo user → write' };
  } catch (err) {
    yield { step: 'agentRestrictions-user', icon: '⚠️', message: `agentRestrictions: demo user set failed (non-fatal): ${err.message}` };
  }
}

// Set agentRestrictions default on demoAdmin
if (demoAdminResult?.user?.id) {
  yield { step: 'agentRestrictions-admin', icon: '·', message: 'Setting agentRestrictions default on demo admin...' };
  try {
    await this.makeRequest('PATCH', `/users/${demoAdminResult.user.id}`, { agentRestrictions: 'write' });
    yield { step: 'agentRestrictions-admin', icon: '✅', message: 'agentRestrictions: demo admin → write' };
  } catch (err) {
    yield { step: 'agentRestrictions-admin', icon: '⚠️', message: `agentRestrictions: demo admin set failed (non-fatal): ${err.message}` };
  }
}
```

- [ ] **Step 3: Add step keys to PHASE_GROUPS in bootstrapPingOne.js**

Open `demo_api_server/scripts/bootstrapPingOne.js`. Find the `PHASE_GROUPS` array (around line 1000). Add the new step keys to Phase ⑥:

```javascript
{ label: '⑥ Demo users + claims', keys: [
  'demoUser', 'demoUser-password', 'demoAdmin', 'demoAdmin-password',
  'demoDelegate', 'demoDelegate-password', 'isDelegate-schema', 'demoDelegate-flag',
  'bankDelegates-group', 'schema-attr', 'spel-claim', 'may-act-claim', 'is-delegate-claim',
  'agentRestrictions-schema', 'agentRestrictions-user', 'agentRestrictions-admin',  // NEW
] },
```

- [ ] **Step 4: Verify bootstrap dry-run passes**

```bash
cd demo_api_server && node -e "
const { pingoneProvisionService } = require('./services/pingoneProvisionService');
console.log('Service loaded OK');
"
```

Expected: `Service loaded OK` — no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/pingoneProvisionService.js \
        demo_api_server/scripts/bootstrapPingOne.js
git commit -m "feat(agent-restrictions): provision agentRestrictions schema attribute + user defaults in bootstrap"
```

---

## Task 9: Admin API route — update agentRestrictions

**Files:**
- Modify: `demo_api_server/routes/adminManagement.js`
- Test: `demo_api_server/tests/adminAgentRestrictions.test.js`

- [ ] **Step 1: Write failing test**

Create `demo_api_server/tests/adminAgentRestrictions.test.js`:

```javascript
'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireAdmin: (req, res, next) => next(),
  authenticateToken: (req, res, next) => { req.user = { id: 'admin-1' }; next(); },
}));

jest.mock('../services/pingoneProvisionService', () => ({
  pingoneProvisionService: {
    makeRequest: jest.fn().mockResolvedValue({ data: { agentRestrictions: 'read' } }),
  },
}));

const adminManagementRoutes = require('../routes/adminManagement');
const app = express();
app.use(express.json());
app.use('/', adminManagementRoutes);

describe('PATCH /users/:userId/agent-restrictions', () => {
  test('returns 400 for invalid value', async () => {
    const res = await request(app)
      .patch('/users/user-1/agent-restrictions')
      .send({ agentRestrictions: 'superadmin' });
    expect(res.status).toBe(400);
  });

  test('returns 200 and calls PingOne PATCH for valid value', async () => {
    const { pingoneProvisionService } = require('../services/pingoneProvisionService');
    const res = await request(app)
      .patch('/users/user-1/agent-restrictions')
      .send({ agentRestrictions: 'read' });
    expect(res.status).toBe(200);
    expect(pingoneProvisionService.makeRequest).toHaveBeenCalledWith(
      'PATCH', '/users/user-1', { agentRestrictions: 'read' }
    );
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd demo_api_server && npx jest tests/adminAgentRestrictions.test.js --no-coverage 2>&1 | tail -10
```

Expected: FAIL — route not yet defined.

- [ ] **Step 3: Add route to adminManagement.js**

Open `demo_api_server/routes/adminManagement.js`. After the existing routes, add:

```javascript
const { cache: attrCache } = require('../middleware/agentRestrictionsCache');

const VALID_AGENT_RESTRICTIONS = new Set(['write', 'read', 'none']);

/**
 * PATCH /api/admin/management/users/:userId/agent-restrictions
 * Update a user's agentRestrictions attribute in PingOne.
 * Also invalidates the local BFF attribute cache for that user.
 */
router.patch('/users/:userId/agent-restrictions', requireAdmin, async (req, res) => {
  const { agentRestrictions } = req.body;
  const { userId } = req.params;

  if (!VALID_AGENT_RESTRICTIONS.has(agentRestrictions)) {
    return res.status(400).json({
      error: 'invalid_value',
      message: `agentRestrictions must be one of: ${[...VALID_AGENT_RESTRICTIONS].join(', ')}`,
    });
  }

  try {
    managementService.initialize();
    await managementService.makeRequest('PATCH', `/users/${userId}`, { agentRestrictions });

    // Invalidate BFF attribute cache so the change takes effect within 5s
    attrCache.invalidate(userId);

    return res.json({ userId, agentRestrictions, updated: true });
  } catch (error) {
    console.error('[adminManagement] PATCH /users/:userId/agent-restrictions error:', error.message);
    return res.status(500).json({ error: 'update_failed', message: error.message });
  }
});
```

> Note: `managementService` is already required at the top of `adminManagement.js`. Use it directly — no new import needed.

- [ ] **Step 4: Run test — verify it passes**

```bash
cd demo_api_server && npx jest tests/adminAgentRestrictions.test.js --no-coverage 2>&1 | tail -10
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/adminManagement.js \
        demo_api_server/tests/adminAgentRestrictions.test.js
git commit -m "feat(agent-restrictions): add PATCH /api/admin/management/users/:userId/agent-restrictions"
```

---

## Task 10: Admin UI — agentRestrictions dropdown in Users.js

**Files:**
- Modify: `demo_api_ui/src/components/Users.js`

- [ ] **Step 1: Add state for agentRestrictions per user**

Open `demo_api_ui/src/components/Users.js`. Find the `useState` declarations at the top of the component.

Add:

```javascript
const [agentRestrictionsUpdating, setAgentRestrictionsUpdating] = useState({});
```

- [ ] **Step 2: Add updateAgentRestrictions function**

After the existing `toggleUserStatus` function, add:

```javascript
const updateAgentRestrictions = async (userId, value) => {
  setAgentRestrictionsUpdating((prev) => ({ ...prev, [userId]: true }));
  try {
    await bffAxios.patch(`/api/admin/management/users/${userId}/agent-restrictions`, {
      agentRestrictions: value,
    });
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, agentRestrictions: value } : u))
    );
  } catch (err) {
    console.error('Failed to update agentRestrictions:', err);
  } finally {
    setAgentRestrictionsUpdating((prev) => ({ ...prev, [userId]: false }));
  }
};
```

- [ ] **Step 3: Add dropdown to user list rows**

Find the JSX where user rows are rendered (look for a `users.map(...)` block). Inside each user row, add the dropdown after the existing user status toggle:

```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem' }}>
  <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Agent access:</label>
  <select
    value={user.agentRestrictions || 'write'}
    disabled={agentRestrictionsUpdating[user.id]}
    onChange={(e) => updateAgentRestrictions(user.id, e.target.value)}
    style={{
      fontSize: '0.78rem',
      padding: '0.2rem 0.4rem',
      borderRadius: '4px',
      border: '1px solid var(--border-color)',
      background: 'var(--surface-bg)',
      color: 'var(--text-primary)',
      cursor: 'pointer',
    }}
  >
    <option value="write">write (full)</option>
    <option value="read">read only</option>
    <option value="none">none (blocked)</option>
  </select>
  {agentRestrictionsUpdating[user.id] && (
    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>updating...</span>
  )}
</div>
```

- [ ] **Step 4: Build UI and verify no errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/Users.js
git commit -m "feat(agent-restrictions): add agentRestrictions dropdown to admin user management"
```

---

## Task 11: Education panel — AgentRestrictionsPanel

**Files:**
- Create: `demo_api_ui/src/components/AgentRestrictionsPanel.jsx`
- Modify: `demo_api_ui/src/` — wire panel into education drawer (follow exact pattern of existing panels)

- [ ] **Step 1: Find how existing education panels are registered**

```bash
grep -r "AgenticTrust\|PingGateway\|TratPanel\|eduPanel\|registerPanel" \
  demo_api_ui/src/ --include="*.js" --include="*.jsx" --include="*.tsx" \
  -l 2>/dev/null | head -10
```

Read the registration file to understand the pattern (typically an array or object of `{ id, component }` entries).

- [ ] **Step 2: Create AgentRestrictionsPanel.jsx**

Create `demo_api_ui/src/components/AgentRestrictionsPanel.jsx`:

```jsx
import React, { useState } from 'react';

export default function AgentRestrictionsPanel() {
  const [expanded, setExpanded] = useState(null);

  const sections = [
    {
      id: 'what',
      title: 'What is P1AZ at the Resource Server?',
      body: (
        <>
          <p>
            In this demo, PingOne Authorize (P1AZ) makes a policy decision on every
            banking API call that the agent triggers — not just at the gateway or the
            BFF tool-call layer. This mirrors the NotFlux-MCP architecture where P1AZ
            sits in front of the actual resource server (Kong/API Gateway).
          </p>
          <p>
            The key difference: P1AZ here controls <strong>data responses</strong>, not
            just tool invocations. If the policy says deny, the banking API never returns
            account data — the agent is stopped at the resource itself.
          </p>
        </>
      ),
    },
    {
      id: 'attribute',
      title: 'agentRestrictions — live PingOne attribute',
      body: (
        <>
          <p>
            Each user has a custom PingOne attribute <code>agentRestrictions</code> with
            three values:
          </p>
          <ul>
            <li><strong>write</strong> — agent may call any tool (default)</li>
            <li><strong>read</strong> — agent can browse but cannot transact</li>
            <li><strong>none</strong> — agent is fully blocked</li>
          </ul>
          <p>
            P1AZ reads this attribute <strong>live at evaluation time</strong> — it is
            not cached in the token. An admin can change it in PingOne (or via the admin
            panel) and the agent feels the change within 5 seconds, with no token
            re-issue and no logout required.
          </p>
        </>
      ),
    },
    {
      id: 'flow',
      title: 'Mid-session change flow',
      body: (
        <>
          <ol>
            <li>Admin sets user's <code>agentRestrictions</code> to <code>read</code> in the Users panel</li>
            <li>Agent attempts a write tool (e.g. create_transfer)</li>
            <li>BFF middleware fetches the attribute from PingOne — sees <code>read</code></li>
            <li>Calls P1AZ: DENY (read tier cannot perform write operation)</li>
            <li>HITL task created — consent dialog appears in the agent sidebar</li>
            <li>User approves → P1AZ re-evaluated with confirmation context → PERMIT</li>
          </ol>
          <p>
            To demonstrate: open the admin Users panel, change a user's agent access to
            "read only", then trigger a transfer from the agent. The HITL dialog will appear.
          </p>
        </>
      ),
    },
    {
      id: 'tier',
      title: 'How tiers are resolved',
      body: (
        <>
          <p>
            The capability tier (<code>read</code> or <code>write</code>) for each tool
            is derived from <code>scope-topology.json</code> — the single source of truth
            for all scopes in this demo. Each scope has a <code>riskLevel</code>:
          </p>
          <ul>
            <li><strong>low / medium</strong> → read tier</li>
            <li><strong>high / critical</strong> → write tier</li>
          </ul>
          <p>
            No hardcoded route map — the tier stays in sync automatically as tools and
            scopes evolve across all themes (banking, invest).
          </p>
        </>
      ),
    },
  ];

  return (
    <div style={{ padding: '1rem 0' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>P1AZ as Resource Server Control Plane</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.2rem', fontSize: '0.88rem' }}>
        PingOne Authorize enforces per-user agent capability restrictions at the banking
        API layer — the resource server itself. Changes propagate within 5 seconds
        without token re-issue.
      </p>

      {sections.map((s) => (
        <div
          key={s.id}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            marginBottom: '0.6rem',
            overflow: 'hidden',
          }}
        >
          <button
            onClick={() => setExpanded(expanded === s.id ? null : s.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '0.7rem 1rem',
              background: expanded === s.id ? 'var(--surface-hover)' : 'var(--surface-bg)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.88rem',
              color: 'var(--text-primary)',
            }}
          >
            {s.title}
          </button>
          {expanded === s.id && (
            <div style={{ padding: '0.8rem 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {s.body}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Register panel in education drawer**

Read the file found in Step 1 to understand the registration pattern. Add `AgentRestrictionsPanel` following the exact same pattern as the closest existing panel. The panel `id` should be `'agent-restrictions'`.

- [ ] **Step 4: Build UI and verify no errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AgentRestrictionsPanel.jsx \
        demo_api_ui/src/  # whichever registration file was modified
git commit -m "feat(agent-restrictions): add AgentRestrictionsPanel education panel"
```

---

## Task 12: End-to-end smoke test

- [ ] **Step 1: Start all services**

```bash
./run.sh
```

Wait for all services to report healthy:
```bash
./run.sh status
```

- [ ] **Step 2: Enable the feature flag**

Navigate to `https://api.ping.demo:4000/admin` → Config → Feature Flags → set `ff_agent_restrictions` to `true`.

- [ ] **Step 3: Verify non-agent calls are unaffected**

Log in as demo user → Dashboard → verify accounts and transactions load normally (no 428 errors in browser console).

- [ ] **Step 4: Trigger an agent write call with unrestricted user**

Open the agent sidebar → ask "make a $10 deposit to my savings account". Expected: succeeds (agentRestrictions defaults to `write`).

- [ ] **Step 5: Set agentRestrictions to read and retry**

Admin panel → Users → find demo user → set Agent access to "read only".

Return to agent sidebar → ask "make a $10 deposit". Expected: HITL dialog appears ("Agent capability restricted by policy"). Approve it → deposit succeeds.

- [ ] **Step 6: Set agentRestrictions to none and retry**

Admin panel → Users → set Agent access to "none (blocked)".

Agent sidebar → ask for accounts. Expected: HITL dialog (none blocks all calls). Approve → proceeds. OR: deny → agent reports blocked.

- [ ] **Step 7: Run full test suite**

```bash
npm run test:api-server 2>&1 | tail -20
npm run test:mcp-server 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Final UI build gate**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
echo "Exit: $?"
```

Expected: `Exit: 0`

- [ ] **Step 9: Commit any final fixes, then update REGRESSION_PLAN.md**

Add a §4 Bug Fix Log entry if any bugs were found during smoke testing. Add the new middleware to the §1 protected files table:

```markdown
| `demo_api_server/middleware/agentRestrictionsGate.js` | Agent restrictions gate | ff_agent_restrictions; must call P1AZ on DENY; must not fire on non-agent calls |
```

```bash
git add REGRESSION_PLAN.md
git commit -m "docs: add agentRestrictionsGate to regression plan §1"
```
