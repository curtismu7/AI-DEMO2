# MCP Resources + All-Vertical Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP `resources/*` support and expand tool coverage to all 9 remaining demo verticals in `demo_mcp_resource_server`, with rich tool descriptions and `intentHints` that feed into the NL intent parser.

**Architecture:** Each new vertical gets a `{vertical}Tools.ts` (tool definitions with `description` + `intentHints`) and a `{vertical}ToolHandler.ts` (dispatch reading from mock-data.json). A shared `src/shared/mockData.ts` loader reads `demo_api_server/config/verticals/{v}/mock-data.json` at startup. `index.ts` gains three new MCP method handlers (`resources/list`, `resources/templates/list`, `resources/read`). The NL intent parser gets a new fallback pass that matches against `intentHints` when heuristic confidence is below threshold.

**Tech Stack:** TypeScript 5, Node ≥22, Jest 29/ts-jest, existing `McpToolDef` interface, CommonJS (`nlIntentParser.js`)

## Global Constraints

- All new `.ts` files use `'use strict'` as first line (matches existing files)
- `McpToolDef` interface lives in `src/tools/toolTypes.ts` — extend it, don't copy it
- New scopes follow pattern `{vertical}:read` (e.g. `banking:read`, `healthcare:read`)
- `abercrombie-fitch` scope is `anf:read` (avoids kebab-case scope string issues)
- `intentHints` is `string[]` on `McpToolDef` — optional, included in `tools/list` response
- Test tokens use `SKIP_TOKEN_SIGNATURE_VALIDATION=true` (see `tests/httpMcp.test.ts`)
- Mock-data path: `demo_api_server/config/verticals/{vertical}/mock-data.json` relative to repo root
- Repo root resolved by walking up from `__dirname` until `package.json` with `name: "banking-demo"` is found
- `npx tsc --noEmit` must pass after every task
- `npm test` (Jest) must pass after every task
- Commit after every task — staged files only, never `git add -A`

---

## Task 1: Extend McpToolDef + shared mock-data loader

**Files:**
- Modify: `demo_mcp_resource_server/src/tools/toolTypes.ts`
- Create: `demo_mcp_resource_server/src/shared/mockData.ts`
- Test: `demo_mcp_resource_server/tests/mockData.test.ts`

**Interfaces:**
- Produces: `McpToolDef.intentHints?: string[]` (optional field, backward-compatible)
- Produces: `loadMockData(vertical: string): Record<string, unknown>` — returns parsed JSON, throws if file not found
- Produces: `REPO_ROOT: string` — absolute path to repo root

- [ ] **Step 1: Write failing test for mockData loader**

Create `demo_mcp_resource_server/tests/mockData.test.ts`:

```typescript
'use strict';
import { loadMockData } from '../src/shared/mockData';

describe('loadMockData', () => {
  it('loads healthcare mock data and returns patientRecords array', () => {
    const data = loadMockData('healthcare');
    expect(Array.isArray((data as any).patientRecords)).toBe(true);
    expect((data as any).patientRecords.length).toBeGreaterThan(0);
  });

  it('throws for an unknown vertical', () => {
    expect(() => loadMockData('does-not-exist')).toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_resource_server && npx jest tests/mockData.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../src/shared/mockData'`

- [ ] **Step 3: Add `intentHints` to McpToolDef**

In `demo_mcp_resource_server/src/tools/toolTypes.ts`, add the optional field:

```typescript
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  readOnly: boolean;
  intentHints?: string[];
}
```

- [ ] **Step 4: Create `src/shared/mockData.ts`**

```typescript
'use strict';

import fs from 'node:fs';
import path from 'node:path';

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'banking-demo') return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Repo root (banking-demo) not found from ${start}`);
}

export const REPO_ROOT = findRepoRoot(__dirname);

export function loadMockData(vertical: string): Record<string, unknown> {
  const filePath = path.join(REPO_ROOT, 'demo_api_server', 'config', 'verticals', vertical, 'mock-data.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`mock-data.json not found for vertical "${vertical}" at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd demo_mcp_resource_server && npx jest tests/mockData.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 6: Type-check**

```bash
cd demo_mcp_resource_server && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_resource_server/src/tools/toolTypes.ts \
        demo_mcp_resource_server/src/shared/mockData.ts \
        demo_mcp_resource_server/tests/mockData.test.ts
git commit -m "feat(mcp-resource-server): add intentHints to McpToolDef + shared mock-data loader"
```

---

## Task 2: Banking vertical tools + handler

**Files:**
- Create: `demo_mcp_resource_server/src/tools/bankingTools.ts`
- Create: `demo_mcp_resource_server/src/tools/bankingToolHandler.ts`
- Test: `demo_mcp_resource_server/tests/bankingTools.test.ts`

**Interfaces:**
- Consumes: `McpToolDef` from `./toolTypes`, `loadMockData` from `../shared/mockData`
- Produces: `BANKING_TOOLS: McpToolDef[]`
- Produces: `dispatchBankingTool(name: string, args: Record<string, unknown>): Promise<unknown>`

Banking mock-data only has `heroStats`. Account/transaction data comes from `demo_api_server/data/sampleData.js` which is CommonJS. The handler returns static fixtures for demo purposes — it does NOT require BFF calls (unlike invest tools).

Account shape: `{ id, userId, accountNumber, accountType, balance, currency, isActive }`
Transaction shape: `{ id, fromAccountId, toAccountId, amount, type, description, category, status }`

- [ ] **Step 1: Write failing test**

Create `demo_mcp_resource_server/tests/bankingTools.test.ts`:

```typescript
'use strict';
import { BANKING_TOOLS } from '../src/tools/bankingTools';
import { dispatchBankingTool } from '../src/tools/bankingToolHandler';

describe('BANKING_TOOLS', () => {
  it('exports two tools', () => {
    expect(BANKING_TOOLS.length).toBe(2);
  });

  it('all tools have description and intentHints', () => {
    for (const t of BANKING_TOOLS) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(Array.isArray(t.intentHints)).toBe(true);
      expect((t.intentHints as string[]).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('all tools require banking:read scope', () => {
    for (const t of BANKING_TOOLS) {
      expect(t.requiredScopes).toContain('banking:read');
    }
  });
});

describe('dispatchBankingTool', () => {
  it('list_banking_accounts returns accounts array', async () => {
    const result = await dispatchBankingTool('list_banking_accounts', {}) as any;
    expect(Array.isArray(result.accounts)).toBe(true);
    expect(result.accounts[0]).toHaveProperty('id');
    expect(result.accounts[0]).toHaveProperty('accountType');
  });

  it('get_banking_account returns one account by id', async () => {
    const accounts = (await dispatchBankingTool('list_banking_accounts', {}) as any).accounts;
    const id = accounts[0].id;
    const result = await dispatchBankingTool('get_banking_account', { account_id: id }) as any;
    expect(result.account.id).toBe(id);
  });

  it('get_banking_account returns not_found for unknown id', async () => {
    const result = await dispatchBankingTool('get_banking_account', { account_id: 'no-such-id' }) as any;
    expect(result.found).toBe(false);
  });

  it('throws for unknown tool name', async () => {
    await expect(dispatchBankingTool('unknown_tool', {})).rejects.toThrow(/Unknown banking tool/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_resource_server && npx jest tests/bankingTools.test.ts --no-coverage
```

Expected: FAIL — modules not found

- [ ] **Step 3: Create `src/tools/bankingTools.ts`**

```typescript
'use strict';

import { McpToolDef } from './toolTypes';

export const BANKING_TOOLS: McpToolDef[] = [
  {
    name: 'list_banking_accounts',
    description: 'List all bank accounts for the authenticated user, including checking, savings, and credit card accounts with current balances.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['banking:read'],
    readOnly: true,
    intentHints: [
      'show my accounts',
      'list my bank accounts',
      'what accounts do I have',
      'show my checking and savings',
      'account overview',
    ],
  },
  {
    name: 'get_banking_account',
    description: 'Get details for a single bank account by ID, including balance, account type, and account number.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Bank account ID' },
      },
      required: ['account_id'],
    },
    requiredScopes: ['banking:read'],
    readOnly: true,
    intentHints: [
      'show account details',
      'get my account balance',
      'what is my balance',
      'check my account',
    ],
  },
];
```

- [ ] **Step 4: Create `src/tools/bankingToolHandler.ts`**

```typescript
'use strict';

// Static demo account fixtures — banking mock-data.json only has heroStats;
// real account data lives in sampleData.js (CommonJS). We reproduce a minimal
// representative set here rather than require()ing a large side-effectful module.
const DEMO_ACCOUNTS = [
  { id: 'acct-001', userId: 'demo-user', accountNumber: '****4821', accountType: 'checking', balance: 4230.15, currency: 'USD', isActive: true },
  { id: 'acct-002', userId: 'demo-user', accountNumber: '****9104', accountType: 'savings', balance: 18540.00, currency: 'USD', isActive: true },
  { id: 'acct-003', userId: 'demo-user', accountNumber: '****3377', accountType: 'credit_card', balance: -842.50, currency: 'USD', isActive: true },
];

export async function dispatchBankingTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_banking_accounts':
      return { accounts: DEMO_ACCOUNTS, count: DEMO_ACCOUNTS.length };

    case 'get_banking_account': {
      const id = args.account_id as string;
      const account = DEMO_ACCOUNTS.find((a) => a.id === id);
      if (!account) return { found: false, account_id: id };
      return { found: true, account };
    }

    default:
      throw new Error(`Unknown banking tool: ${toolName}`);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd demo_mcp_resource_server && npx jest tests/bankingTools.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 6: Type-check**

```bash
cd demo_mcp_resource_server && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_resource_server/src/tools/bankingTools.ts \
        demo_mcp_resource_server/src/tools/bankingToolHandler.ts \
        demo_mcp_resource_server/tests/bankingTools.test.ts
git commit -m "feat(mcp-resource-server): add banking vertical tools"
```

---

## Task 3: Healthcare, Government, Manufacturing vertical tools + handlers

These three follow the exact same pattern. Each reads from mock-data.json via `loadMockData`.

**Files:**
- Create: `src/tools/healthcareTools.ts`, `src/tools/healthcareToolHandler.ts`
- Create: `src/tools/governmentTools.ts`, `src/tools/governmentToolHandler.ts`
- Create: `src/tools/manufacturingTools.ts`, `src/tools/manufacturingToolHandler.ts`
- Test: `tests/verticalTools.test.ts` (covers all three)

**Interfaces:**
- Consumes: `McpToolDef`, `loadMockData`
- Produces: `HEALTHCARE_TOOLS`, `dispatchHealthcareTool`
- Produces: `GOVERNMENT_TOOLS`, `dispatchGovernmentTool`
- Produces: `MANUFACTURING_TOOLS`, `dispatchManufacturingTool`

Healthcare mock-data keys: `heroStats`, `patientRecords` (array), `billingHistory` (array)
Government mock-data keys: `heroStats`, `permits` (array), `filings` (array)
Manufacturing mock-data keys: `heroStats` only — tools return `heroStats` + empty arrays

- [ ] **Step 1: Write failing test**

Create `demo_mcp_resource_server/tests/verticalTools.test.ts`:

```typescript
'use strict';
import { HEALTHCARE_TOOLS, dispatchHealthcareTool } from '../src/tools/healthcareTools';
import { GOVERNMENT_TOOLS, dispatchGovernmentTool } from '../src/tools/governmentTools';
import { MANUFACTURING_TOOLS, dispatchManufacturingTool } from '../src/tools/manufacturingTools';

// Re-usable conformance check
function checkToolConformance(tools: any[], scope: string) {
  expect(tools.length).toBe(2);
  for (const t of tools) {
    expect(typeof t.description).toBe('string');
    expect(t.description.length).toBeGreaterThan(10);
    expect(Array.isArray(t.intentHints)).toBe(true);
    expect(t.intentHints.length).toBeGreaterThanOrEqual(3);
    expect(t.requiredScopes).toContain(scope);
  }
}

describe('Healthcare tools', () => {
  it('conforms to McpToolDef shape', () => checkToolConformance(HEALTHCARE_TOOLS, 'healthcare:read'));

  it('list_patient_records returns patientRecords array', async () => {
    const result = await dispatchHealthcareTool('list_patient_records', {}) as any;
    expect(Array.isArray(result.records)).toBe(true);
    expect(result.records[0]).toHaveProperty('id');
  });

  it('get_patient_record returns one record by id', async () => {
    const list = (await dispatchHealthcareTool('list_patient_records', {}) as any).records;
    const id = list[0].id;
    const r = await dispatchHealthcareTool('get_patient_record', { record_id: id }) as any;
    expect(r.record.id).toBe(id);
  });
});

describe('Government tools', () => {
  it('conforms to McpToolDef shape', () => checkToolConformance(GOVERNMENT_TOOLS, 'government:read'));

  it('list_permits returns permits array', async () => {
    const result = await dispatchGovernmentTool('list_permits', {}) as any;
    expect(Array.isArray(result.permits)).toBe(true);
    expect(result.permits[0]).toHaveProperty('id');
  });

  it('get_permit returns one permit by id', async () => {
    const list = (await dispatchGovernmentTool('list_permits', {}) as any).permits;
    const id = list[0].id;
    const r = await dispatchGovernmentTool('get_permit', { permit_id: id }) as any;
    expect(r.permit.id).toBe(id);
  });
});

describe('Manufacturing tools', () => {
  it('conforms to McpToolDef shape', () => checkToolConformance(MANUFACTURING_TOOLS, 'manufacturing:read'));

  it('list_work_orders returns array (may be empty for demo data)', async () => {
    const result = await dispatchManufacturingTool('list_work_orders', {}) as any;
    expect(Array.isArray(result.workOrders)).toBe(true);
  });

  it('get_work_order returns not_found for unknown id', async () => {
    const r = await dispatchManufacturingTool('get_work_order', { order_id: 'no-such' }) as any;
    expect(r.found).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_resource_server && npx jest tests/verticalTools.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Create `src/tools/healthcareTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const HEALTHCARE_TOOLS: McpToolDef[] = [
  {
    name: 'list_patient_records',
    description: 'List all patient records for the authenticated user, including providers, coverage type, and coverage status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['healthcare:read'],
    readOnly: true,
    intentHints: [
      'show my health records',
      'list my patient records',
      'what are my medical records',
      'show my coverage',
      'view my healthcare',
    ],
  },
  {
    name: 'get_patient_record',
    description: 'Get a single patient record by ID, including provider, coverage type, and coverage status.',
    inputSchema: {
      type: 'object',
      properties: {
        record_id: { type: 'string', description: 'Patient record ID' },
      },
      required: ['record_id'],
    },
    requiredScopes: ['healthcare:read'],
    readOnly: true,
    intentHints: [
      'show my health record',
      'get patient record details',
      'view my insurance coverage',
    ],
  },
];
```

- [ ] **Step 4: Create `src/tools/healthcareToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('healthcare') as {
  patientRecords: Array<{ id: string; [k: string]: unknown }>;
  billingHistory: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchHealthcareTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_patient_records':
      return { records: data.patientRecords, count: data.patientRecords.length };

    case 'get_patient_record': {
      const id = args.record_id as string;
      const record = data.patientRecords.find((r) => r.id === id);
      if (!record) return { found: false, record_id: id };
      return { found: true, record };
    }

    default:
      throw new Error(`Unknown healthcare tool: ${toolName}`);
  }
}
```

- [ ] **Step 5: Create `src/tools/governmentTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const GOVERNMENT_TOOLS: McpToolDef[] = [
  {
    name: 'list_permits',
    description: 'List all government permits for the authenticated user, including permit type, subject, status, and expiration date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['government:read'],
    readOnly: true,
    intentHints: [
      'show my permits',
      'list my government permits',
      'what permits do I have',
      'view my licenses',
      'show permit status',
    ],
  },
  {
    name: 'get_permit',
    description: 'Get a single government permit by ID, including permit type, subject, status, and expiration date.',
    inputSchema: {
      type: 'object',
      properties: {
        permit_id: { type: 'string', description: 'Permit ID' },
      },
      required: ['permit_id'],
    },
    requiredScopes: ['government:read'],
    readOnly: true,
    intentHints: [
      'get permit details',
      'show permit information',
      'check permit status',
    ],
  },
];
```

- [ ] **Step 6: Create `src/tools/governmentToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('government') as {
  permits: Array<{ id: string; [k: string]: unknown }>;
  filings: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchGovernmentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_permits':
      return { permits: data.permits, count: data.permits.length };

    case 'get_permit': {
      const id = args.permit_id as string;
      const permit = data.permits.find((p) => p.id === id);
      if (!permit) return { found: false, permit_id: id };
      return { found: true, permit };
    }

    default:
      throw new Error(`Unknown government tool: ${toolName}`);
  }
}
```

- [ ] **Step 7: Create `src/tools/manufacturingTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const MANUFACTURING_TOOLS: McpToolDef[] = [
  {
    name: 'list_work_orders',
    description: 'List open work orders for the authenticated user, including status, inventory value, and scheduled shipments.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['manufacturing:read'],
    readOnly: true,
    intentHints: [
      'show my work orders',
      'list work orders',
      'what work orders are open',
      'show production orders',
      'view manufacturing orders',
    ],
  },
  {
    name: 'get_work_order',
    description: 'Get a single work order by ID with full production details.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Work order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['manufacturing:read'],
    readOnly: true,
    intentHints: [
      'get work order details',
      'show work order status',
      'check production order',
    ],
  },
];
```

- [ ] **Step 8: Create `src/tools/manufacturingToolHandler.ts`**

Manufacturing mock-data has heroStats only (no list entities). Return heroStats summary + empty array.

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('manufacturing') as {
  heroStats: Record<string, unknown>;
};

export async function dispatchManufacturingTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_work_orders':
      return {
        workOrders: [],
        count: 0,
        summary: data.heroStats,
      };

    case 'get_work_order': {
      const id = args.order_id as string;
      return { found: false, order_id: id };
    }

    default:
      throw new Error(`Unknown manufacturing tool: ${toolName}`);
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

```bash
cd demo_mcp_resource_server && npx jest tests/verticalTools.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 10: Type-check + full test suite**

```bash
cd demo_mcp_resource_server && npx tsc --noEmit && npx jest --no-coverage
```

- [ ] **Step 11: Commit**

```bash
git add demo_mcp_resource_server/src/tools/healthcareTools.ts \
        demo_mcp_resource_server/src/tools/healthcareToolHandler.ts \
        demo_mcp_resource_server/src/tools/governmentTools.ts \
        demo_mcp_resource_server/src/tools/governmentToolHandler.ts \
        demo_mcp_resource_server/src/tools/manufacturingTools.ts \
        demo_mcp_resource_server/src/tools/manufacturingToolHandler.ts \
        demo_mcp_resource_server/tests/verticalTools.test.ts
git commit -m "feat(mcp-resource-server): add healthcare, government, manufacturing vertical tools"
```

---

## Task 4: Retail, Sporting-Goods, University, Workforce, ANF vertical tools + handlers

Five more verticals, same pattern. All have list data in mock-data.json.

**Files:**
- Create: `src/tools/retailTools.ts`, `src/tools/retailToolHandler.ts`
- Create: `src/tools/sportingGoodsTools.ts`, `src/tools/sportingGoodsToolHandler.ts`
- Create: `src/tools/universityTools.ts`, `src/tools/universityToolHandler.ts`
- Create: `src/tools/workforceTools.ts`, `src/tools/workforceToolHandler.ts`
- Create: `src/tools/anfTools.ts`, `src/tools/anfToolHandler.ts`
- Test: `tests/verticalTools2.test.ts`

**Interfaces:**
- Produces: `RETAIL_TOOLS`, `dispatchRetailTool`
- Produces: `SPORTING_GOODS_TOOLS`, `dispatchSportingGoodsTool`
- Produces: `UNIVERSITY_TOOLS`, `dispatchUniversityTool`
- Produces: `WORKFORCE_TOOLS`, `dispatchWorkforceTool`
- Produces: `ANF_TOOLS`, `dispatchAnfTool`

Retail mock-data: `orders` (array, items: `id, product, sku, amount, status, date, itemCount`), `products` (array)
Sporting-goods mock-data: `orders` (array), `rentals` (array, items: `id, item, sku, dueDate, dailyRate, status`)
University mock-data: `courses` (array, items: `id, title, courseType, credits, grade`), `enrollmentHistory` (array)
Workforce mock-data: `expenses` (array, items: `id, category, description, amount, status, submittedDate`), `benefits` (array)
ANF mock-data: `orders` (array, items: `id, product, amount, status, date`), `products` (array)

- [ ] **Step 1: Write failing test**

Create `demo_mcp_resource_server/tests/verticalTools2.test.ts`:

```typescript
'use strict';
import { RETAIL_TOOLS, dispatchRetailTool } from '../src/tools/retailTools';
import { SPORTING_GOODS_TOOLS, dispatchSportingGoodsTool } from '../src/tools/sportingGoodsTools';
import { UNIVERSITY_TOOLS, dispatchUniversityTool } from '../src/tools/universityTools';
import { WORKFORCE_TOOLS, dispatchWorkforceTool } from '../src/tools/workforceTools';
import { ANF_TOOLS, dispatchAnfTool } from '../src/tools/anfTools';

function checkConformance(tools: any[], scope: string) {
  expect(tools.length).toBe(2);
  for (const t of tools) {
    expect(t.description.length).toBeGreaterThan(10);
    expect(Array.isArray(t.intentHints)).toBe(true);
    expect(t.intentHints.length).toBeGreaterThanOrEqual(3);
    expect(t.requiredScopes).toContain(scope);
  }
}

describe('Retail tools', () => {
  it('conforms', () => checkConformance(RETAIL_TOOLS, 'retail:read'));
  it('list_orders returns orders array', async () => {
    const r = await dispatchRetailTool('list_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.orders[0]).toHaveProperty('id');
  });
  it('get_order returns one by id', async () => {
    const list = (await dispatchRetailTool('list_orders', {}) as any).orders;
    const r = await dispatchRetailTool('get_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});

describe('Sporting-goods tools', () => {
  it('conforms', () => checkConformance(SPORTING_GOODS_TOOLS, 'sporting-goods:read'));
  it('list_gear_orders returns orders array', async () => {
    const r = await dispatchSportingGoodsTool('list_gear_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
  });
  it('get_gear_order returns one by id', async () => {
    const list = (await dispatchSportingGoodsTool('list_gear_orders', {}) as any).orders;
    const r = await dispatchSportingGoodsTool('get_gear_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});

describe('University tools', () => {
  it('conforms', () => checkConformance(UNIVERSITY_TOOLS, 'university:read'));
  it('list_courses returns courses array', async () => {
    const r = await dispatchUniversityTool('list_courses', {}) as any;
    expect(Array.isArray(r.courses)).toBe(true);
    expect(r.courses[0]).toHaveProperty('id');
  });
  it('get_course returns one by id', async () => {
    const list = (await dispatchUniversityTool('list_courses', {}) as any).courses;
    const r = await dispatchUniversityTool('get_course', { course_id: list[0].id }) as any;
    expect(r.course.id).toBe(list[0].id);
  });
});

describe('Workforce tools', () => {
  it('conforms', () => checkConformance(WORKFORCE_TOOLS, 'workforce:read'));
  it('list_expenses returns expenses array', async () => {
    const r = await dispatchWorkforceTool('list_expenses', {}) as any;
    expect(Array.isArray(r.expenses)).toBe(true);
    expect(r.expenses[0]).toHaveProperty('id');
  });
  it('get_expense returns one by id', async () => {
    const list = (await dispatchWorkforceTool('list_expenses', {}) as any).expenses;
    const r = await dispatchWorkforceTool('get_expense', { expense_id: list[0].id }) as any;
    expect(r.expense.id).toBe(list[0].id);
  });
});

describe('ANF tools', () => {
  it('conforms', () => checkConformance(ANF_TOOLS, 'anf:read'));
  it('list_anf_orders returns orders array', async () => {
    const r = await dispatchAnfTool('list_anf_orders', {}) as any;
    expect(Array.isArray(r.orders)).toBe(true);
    expect(r.orders[0]).toHaveProperty('id');
  });
  it('get_anf_order returns one by id', async () => {
    const list = (await dispatchAnfTool('list_anf_orders', {}) as any).orders;
    const r = await dispatchAnfTool('get_anf_order', { order_id: list[0].id }) as any;
    expect(r.order.id).toBe(list[0].id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_resource_server && npx jest tests/verticalTools2.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/tools/retailTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const RETAIL_TOOLS: McpToolDef[] = [
  {
    name: 'list_orders',
    description: 'List all retail orders for the authenticated user, including product, amount, status, and order date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['retail:read'],
    readOnly: true,
    intentHints: [
      'show my orders',
      'list my purchases',
      'what orders do I have',
      'order history',
      'recent purchases',
    ],
  },
  {
    name: 'get_order',
    description: 'Get a single retail order by ID with full order details.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['retail:read'],
    readOnly: true,
    intentHints: ['get order details', 'check order status', 'track my order'],
  },
];
```

- [ ] **Step 4: Create `src/tools/retailToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('retail') as {
  orders: Array<{ id: string; [k: string]: unknown }>;
  products: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchRetailTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_orders':
      return { orders: data.orders, count: data.orders.length };
    case 'get_order': {
      const id = args.order_id as string;
      const order = data.orders.find((o) => o.id === id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown retail tool: ${toolName}`);
  }
}
```

- [ ] **Step 5: Create `src/tools/sportingGoodsTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const SPORTING_GOODS_TOOLS: McpToolDef[] = [
  {
    name: 'list_gear_orders',
    description: 'List all sporting-goods orders for the authenticated user, including item, amount, status, and date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['sporting-goods:read'],
    readOnly: true,
    intentHints: [
      'show my gear orders',
      'list my sporting goods purchases',
      'what gear did I order',
      'my equipment orders',
      'show gear history',
    ],
  },
  {
    name: 'get_gear_order',
    description: 'Get a single sporting-goods order by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['sporting-goods:read'],
    readOnly: true,
    intentHints: ['get gear order details', 'check gear order status', 'track gear order'],
  },
];
```

- [ ] **Step 6: Create `src/tools/sportingGoodsToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('sporting-goods') as {
  orders: Array<{ id: string; [k: string]: unknown }>;
  rentals: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchSportingGoodsTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_gear_orders':
      return { orders: data.orders, count: data.orders.length };
    case 'get_gear_order': {
      const id = args.order_id as string;
      const order = data.orders.find((o) => o.id === id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown sporting-goods tool: ${toolName}`);
  }
}
```

- [ ] **Step 7: Create `src/tools/universityTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const UNIVERSITY_TOOLS: McpToolDef[] = [
  {
    name: 'list_courses',
    description: 'List all courses for the authenticated student, including title, type, credits, and grade.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['university:read'],
    readOnly: true,
    intentHints: [
      'show my courses',
      'list my classes',
      'what courses am I taking',
      'my enrolled courses',
      'show my grades',
    ],
  },
  {
    name: 'get_course',
    description: 'Get a single course by ID with full course details including credits and grade.',
    inputSchema: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Course ID' },
      },
      required: ['course_id'],
    },
    requiredScopes: ['university:read'],
    readOnly: true,
    intentHints: ['get course details', 'show course info', 'check my grade'],
  },
];
```

- [ ] **Step 8: Create `src/tools/universityToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('university') as {
  courses: Array<{ id: string; [k: string]: unknown }>;
  enrollmentHistory: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchUniversityTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_courses':
      return { courses: data.courses, count: data.courses.length };
    case 'get_course': {
      const id = args.course_id as string;
      const course = data.courses.find((c) => c.id === id);
      if (!course) return { found: false, course_id: id };
      return { found: true, course };
    }
    default:
      throw new Error(`Unknown university tool: ${toolName}`);
  }
}
```

- [ ] **Step 9: Create `src/tools/workforceTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const WORKFORCE_TOOLS: McpToolDef[] = [
  {
    name: 'list_expenses',
    description: 'List all expense reports for the authenticated employee, including category, amount, status, and submission date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['workforce:read'],
    readOnly: true,
    intentHints: [
      'show my expenses',
      'list my expense reports',
      'what expenses do I have',
      'my submitted expenses',
      'show expense history',
    ],
  },
  {
    name: 'get_expense',
    description: 'Get a single expense report by ID with full details.',
    inputSchema: {
      type: 'object',
      properties: {
        expense_id: { type: 'string', description: 'Expense report ID' },
      },
      required: ['expense_id'],
    },
    requiredScopes: ['workforce:read'],
    readOnly: true,
    intentHints: ['get expense details', 'check expense status', 'show expense report'],
  },
];
```

- [ ] **Step 10: Create `src/tools/workforceToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('workforce') as {
  expenses: Array<{ id: string; [k: string]: unknown }>;
  benefits: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchWorkforceTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_expenses':
      return { expenses: data.expenses, count: data.expenses.length };
    case 'get_expense': {
      const id = args.expense_id as string;
      const expense = data.expenses.find((e) => e.id === id);
      if (!expense) return { found: false, expense_id: id };
      return { found: true, expense };
    }
    default:
      throw new Error(`Unknown workforce tool: ${toolName}`);
  }
}
```

- [ ] **Step 11: Create `src/tools/anfTools.ts`**

```typescript
'use strict';
import { McpToolDef } from './toolTypes';

export const ANF_TOOLS: McpToolDef[] = [
  {
    name: 'list_anf_orders',
    description: 'List all Abercrombie & Fitch orders for the authenticated user, including product, amount, status, and date.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    requiredScopes: ['anf:read'],
    readOnly: true,
    intentHints: [
      'show my A&F orders',
      'list my Abercrombie orders',
      'what did I order from Abercrombie',
      'my ANF purchases',
      'show ANF order history',
    ],
  },
  {
    name: 'get_anf_order',
    description: 'Get a single Abercrombie & Fitch order by ID with full order details.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order ID' },
      },
      required: ['order_id'],
    },
    requiredScopes: ['anf:read'],
    readOnly: true,
    intentHints: ['get ANF order details', 'check Abercrombie order status', 'track A&F order'],
  },
];
```

- [ ] **Step 12: Create `src/tools/anfToolHandler.ts`**

```typescript
'use strict';
import { loadMockData } from '../shared/mockData';

const data = loadMockData('abercrombie-fitch') as {
  orders: Array<{ id: string; [k: string]: unknown }>;
  products: Array<{ id: string; [k: string]: unknown }>;
};

export async function dispatchAnfTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'list_anf_orders':
      return { orders: data.orders, count: data.orders.length };
    case 'get_anf_order': {
      const id = args.order_id as string;
      const order = data.orders.find((o) => o.id === id);
      if (!order) return { found: false, order_id: id };
      return { found: true, order };
    }
    default:
      throw new Error(`Unknown ANF tool: ${toolName}`);
  }
}
```

- [ ] **Step 13: Run test to verify it passes**

```bash
cd demo_mcp_resource_server && npx jest tests/verticalTools2.test.ts --no-coverage
```

- [ ] **Step 14: Type-check + full suite**

```bash
cd demo_mcp_resource_server && npx tsc --noEmit && npx jest --no-coverage
```

- [ ] **Step 15: Commit**

```bash
git add demo_mcp_resource_server/src/tools/retailTools.ts \
        demo_mcp_resource_server/src/tools/retailToolHandler.ts \
        demo_mcp_resource_server/src/tools/sportingGoodsTools.ts \
        demo_mcp_resource_server/src/tools/sportingGoodsToolHandler.ts \
        demo_mcp_resource_server/src/tools/universityTools.ts \
        demo_mcp_resource_server/src/tools/universityToolHandler.ts \
        demo_mcp_resource_server/src/tools/workforceTools.ts \
        demo_mcp_resource_server/src/tools/workforceToolHandler.ts \
        demo_mcp_resource_server/src/tools/anfTools.ts \
        demo_mcp_resource_server/src/tools/anfToolHandler.ts \
        demo_mcp_resource_server/tests/verticalTools2.test.ts
git commit -m "feat(mcp-resource-server): add retail, sporting-goods, university, workforce, ANF vertical tools"
```

---

## Task 5: Register all vertical tools in registry + wire intentHints into tools/list

**Files:**
- Modify: `demo_mcp_resource_server/src/tools/registry.ts`
- Modify: `demo_mcp_resource_server/src/index.ts` (tools/list response only)
- Test: `demo_mcp_resource_server/tests/registry.test.ts`

**Interfaces:**
- Consumes: all `*_TOOLS` arrays from Tasks 2–4, all `dispatch*Tool` functions
- Produces: `ALL_TOOLS` includes all 9 new verticals (29 total tools including existing invest + airlines)
- Produces: `dispatch()` routes to correct handler by tool name
- Produces: `tools/list` JSON-RPC response includes `intentHints` field per tool

- [ ] **Step 1: Write failing test**

Create `demo_mcp_resource_server/tests/registry.test.ts`:

```typescript
'use strict';
import { ALL_TOOLS, findTool, dispatch } from '../src/tools/registry';

describe('ALL_TOOLS registry', () => {
  it('contains tools from all 11 verticals', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    // Pre-existing
    expect(names).toContain('get_investment_accounts');
    expect(names).toContain('get_airline_bookings');
    // New verticals
    expect(names).toContain('list_banking_accounts');
    expect(names).toContain('list_patient_records');
    expect(names).toContain('list_permits');
    expect(names).toContain('list_work_orders');
    expect(names).toContain('list_orders');
    expect(names).toContain('list_gear_orders');
    expect(names).toContain('list_courses');
    expect(names).toContain('list_expenses');
    expect(names).toContain('list_anf_orders');
  });

  it('every tool in ALL_TOOLS has intentHints or is a pre-existing tool', () => {
    const preExisting = new Set([
      'get_investment_accounts', 'get_investment_balance', 'get_portfolio_summary',
      'get_investment_transactions', 'pay_airline_fee', 'cancel_airline_reservation',
      'sensitive_airline_bookings', 'get_airline_bookings', 'get_flight_status',
      'check_seat_availability', 'sensitive_passenger_record',
    ]);
    for (const t of ALL_TOOLS) {
      if (!preExisting.has(t.name)) {
        expect(Array.isArray(t.intentHints)).toBe(true);
      }
    }
  });

  it('dispatch routes banking tool correctly', async () => {
    const result = await dispatch('list_banking_accounts', {}, '', '') as any;
    expect(Array.isArray(result.accounts)).toBe(true);
  });

  it('dispatch routes healthcare tool correctly', async () => {
    const result = await dispatch('list_patient_records', {}, '', '') as any;
    expect(Array.isArray(result.records)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_resource_server && npx jest tests/registry.test.ts --no-coverage
```

- [ ] **Step 3: Update `src/tools/registry.ts`**

```typescript
'use strict';

import { McpToolDef } from './toolTypes';
import { INVEST_TOOLS } from './investTools';
import { AIRLINES_TOOLS } from './airlinesTools';
import { BANKING_TOOLS } from './bankingTools';
import { HEALTHCARE_TOOLS } from './healthcareTools';
import { GOVERNMENT_TOOLS } from './governmentTools';
import { MANUFACTURING_TOOLS } from './manufacturingTools';
import { RETAIL_TOOLS } from './retailTools';
import { SPORTING_GOODS_TOOLS } from './sportingGoodsTools';
import { UNIVERSITY_TOOLS } from './universityTools';
import { WORKFORCE_TOOLS } from './workforceTools';
import { ANF_TOOLS } from './anfTools';
import { dispatchTool as dispatchInvestTool } from './investToolHandler';
import { AIRLINES_TOOL_NAMES, dispatchAirlinesTool } from './airlinesToolHandler';
import { dispatchBankingTool } from './bankingToolHandler';
import { dispatchHealthcareTool } from './healthcareToolHandler';
import { dispatchGovernmentTool } from './governmentToolHandler';
import { dispatchManufacturingTool } from './manufacturingToolHandler';
import { dispatchRetailTool } from './retailToolHandler';
import { dispatchSportingGoodsTool } from './sportingGoodsToolHandler';
import { dispatchUniversityTool } from './universityToolHandler';
import { dispatchWorkforceTool } from './workforceToolHandler';
import { dispatchAnfTool } from './anfToolHandler';

export const ALL_TOOLS: McpToolDef[] = [
  ...INVEST_TOOLS,
  ...AIRLINES_TOOLS,
  ...BANKING_TOOLS,
  ...HEALTHCARE_TOOLS,
  ...GOVERNMENT_TOOLS,
  ...MANUFACTURING_TOOLS,
  ...RETAIL_TOOLS,
  ...SPORTING_GOODS_TOOLS,
  ...UNIVERSITY_TOOLS,
  ...WORKFORCE_TOOLS,
  ...ANF_TOOLS,
];

export const SUPPORTED_SCOPES: string[] = [
  ...new Set(ALL_TOOLS.flatMap((t) => t.requiredScopes)),
];

export function findTool(toolName: string): McpToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === toolName);
}

const BANKING_TOOL_NAMES = new Set(BANKING_TOOLS.map((t) => t.name));
const HEALTHCARE_TOOL_NAMES = new Set(HEALTHCARE_TOOLS.map((t) => t.name));
const GOVERNMENT_TOOL_NAMES = new Set(GOVERNMENT_TOOLS.map((t) => t.name));
const MANUFACTURING_TOOL_NAMES = new Set(MANUFACTURING_TOOLS.map((t) => t.name));
const RETAIL_TOOL_NAMES = new Set(RETAIL_TOOLS.map((t) => t.name));
const SPORTING_GOODS_TOOL_NAMES = new Set(SPORTING_GOODS_TOOLS.map((t) => t.name));
const UNIVERSITY_TOOL_NAMES = new Set(UNIVERSITY_TOOLS.map((t) => t.name));
const WORKFORCE_TOOL_NAMES = new Set(WORKFORCE_TOOLS.map((t) => t.name));
const ANF_TOOL_NAMES = new Set(ANF_TOOLS.map((t) => t.name));

export function dispatch(
  toolName: string,
  args: Record<string, unknown>,
  token: string,
  subject: string,
): Promise<unknown> {
  if (AIRLINES_TOOL_NAMES.has(toolName)) return dispatchAirlinesTool(toolName, args, subject);
  if (BANKING_TOOL_NAMES.has(toolName)) return dispatchBankingTool(toolName, args);
  if (HEALTHCARE_TOOL_NAMES.has(toolName)) return dispatchHealthcareTool(toolName, args);
  if (GOVERNMENT_TOOL_NAMES.has(toolName)) return dispatchGovernmentTool(toolName, args);
  if (MANUFACTURING_TOOL_NAMES.has(toolName)) return dispatchManufacturingTool(toolName, args);
  if (RETAIL_TOOL_NAMES.has(toolName)) return dispatchRetailTool(toolName, args);
  if (SPORTING_GOODS_TOOL_NAMES.has(toolName)) return dispatchSportingGoodsTool(toolName, args);
  if (UNIVERSITY_TOOL_NAMES.has(toolName)) return dispatchUniversityTool(toolName, args);
  if (WORKFORCE_TOOL_NAMES.has(toolName)) return dispatchWorkforceTool(toolName, args);
  if (ANF_TOOL_NAMES.has(toolName)) return dispatchAnfTool(toolName, args);
  return dispatchInvestTool(toolName, args, token);
}
```

- [ ] **Step 4: Update `tools/list` in `src/index.ts` to include `intentHints`**

Find the `tools/list` handler in `src/index.ts` (around line 285). Change the map to include `intentHints`:

```typescript
  if (method === 'tools/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const tools = filterByScopes(ALL_TOOLS, scopes).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      requiredScopes: t.requiredScopes,
      readOnly: t.readOnly,
      ...(t.intentHints ? { intentHints: t.intentHints } : {}),
    }));
    send(rpcResult(id, { tools }));
    return;
  }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd demo_mcp_resource_server && npx jest tests/registry.test.ts --no-coverage
```

- [ ] **Step 6: Type-check + full suite**

```bash
cd demo_mcp_resource_server && npx tsc --noEmit && npx jest --no-coverage
```

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_resource_server/src/tools/registry.ts \
        demo_mcp_resource_server/src/index.ts \
        demo_mcp_resource_server/tests/registry.test.ts
git commit -m "feat(mcp-resource-server): register all vertical tools + expose intentHints in tools/list"
```

---

## Task 6: MCP resources/list, resources/templates/list, resources/read handlers

**Files:**
- Modify: `demo_mcp_resource_server/src/index.ts`
- Test: `demo_mcp_resource_server/tests/resources.test.ts`

**Interfaces:**
- Consumes: `dispatch()` from registry, `decodeAndValidate`, `extractScopes`
- Produces: `resources/list` → `{ resources: Array<{uri, name, description, mimeType}> }`
- Produces: `resources/templates/list` → `{ resourceTemplates: Array<{uriTemplate, name, description, mimeType}> }`
- Produces: `resources/read` → `{ contents: Array<{uri, mimeType: "application/json", text: string}> }`

Resource catalog (scope → list tool + URI):

| URI | name | scope | list tool |
|---|---|---|---|
| `banking://accounts` | Bank Accounts | `banking:read` | `list_banking_accounts` |
| `healthcare://records` | Patient Records | `healthcare:read` | `list_patient_records` |
| `government://permits` | Government Permits | `government:read` | `list_permits` |
| `manufacturing://work-orders` | Work Orders | `manufacturing:read` | `list_work_orders` |
| `retail://orders` | Retail Orders | `retail:read` | `list_orders` |
| `sporting-goods://gear-orders` | Gear Orders | `sporting-goods:read` | `list_gear_orders` |
| `university://courses` | Courses | `university:read` | `list_courses` |
| `workforce://expenses` | Expenses | `workforce:read` | `list_expenses` |
| `anf://orders` | ANF Orders | `anf:read` | `list_anf_orders` |
| `investment://accounts` | Investment Accounts | `invest:read` | `get_investment_accounts` |
| `airlines://bookings` | Airline Bookings | `airlines:read` | `get_airline_bookings` |

- [ ] **Step 1: Write failing test**

Create `demo_mcp_resource_server/tests/resources.test.ts`:

```typescript
'use strict';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-res-'));
process.env.AIRLINES_DB_PATH = path.join(tmpDir, 'airlines.db');
process.env.AIRLINES_SEED_PATH = path.join(__dirname, '..', 'seed', 'airlines.seed.json');
process.env.MCP_SERVER_RESOURCE_URI = 'mcp-resource-server.ping.demo';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.PORT = '0';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const mod = await import('../src/index');
  server = (mod as unknown as { httpServer: http.Server }).httpServer;
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(scope: string, aud = 'mcp-resource-server.ping.demo'): string {
  return [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({ sub: 'probe', aud, scope, exp: Math.floor(Date.now() / 1000) + 600 }),
    'unsigned',
  ].join('.');
}

async function post(body: unknown, bearer?: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('resources/list', () => {
  it('returns resources filtered by scope', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }, token('banking:read'));
    const uris = r.json.result.resources.map((res: any) => res.uri);
    expect(uris).toContain('banking://accounts');
    expect(uris).not.toContain('healthcare://records');
  });

  it('returns all resources for wildcard scope', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} }, token('*'));
    expect(r.json.result.resources.length).toBeGreaterThanOrEqual(11);
  });

  it('returns -32001 without a token', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list', params: {} });
    expect(r.status).toBe(401);
  });
});

describe('resources/templates/list', () => {
  it('returns URI templates for scoped verticals', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/templates/list', params: {} }, token('healthcare:read'));
    const templates = r.json.result.resourceTemplates.map((t: any) => t.uriTemplate);
    expect(templates).toContain('healthcare://records/{recordId}');
  });
});

describe('resources/read', () => {
  it('returns banking accounts content for banking:read token', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'banking://accounts' },
    }, token('banking:read'));
    expect(r.json.result.contents[0].mimeType).toBe('application/json');
    const data = JSON.parse(r.json.result.contents[0].text);
    expect(Array.isArray(data.accounts)).toBe(true);
  });

  it('returns -32005 for wrong scope', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'banking://accounts' },
    }, token('healthcare:read'));
    expect(r.json.error.code).toBe(-32005);
  });

  it('returns -32002 for unknown URI', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'unknown://foo' },
    }, token('banking:read'));
    expect(r.json.error.code).toBe(-32002);
  });

  it('returns healthcare records content', async () => {
    const r = await post({
      jsonrpc: '2.0', id: 1, method: 'resources/read',
      params: { uri: 'healthcare://records' },
    }, token('healthcare:read'));
    const data = JSON.parse(r.json.result.contents[0].text);
    expect(Array.isArray(data.records)).toBe(true);
  });
});

describe('initialize capabilities', () => {
  it('advertises resources capability', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, token('banking:read'));
    expect(r.json.result.capabilities).toHaveProperty('resources');
    expect(r.json.result.capabilities.resources.subscribe).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_mcp_resource_server && npx jest tests/resources.test.ts --no-coverage
```

Expected: FAIL — `resources/list` returns method-not-found

- [ ] **Step 3: Add resource catalog and handlers to `src/index.ts`**

Add this resource catalog near the top of `index.ts` (after imports):

```typescript
interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  requiredScope: string;
  uriTemplate: string;
  templateName: string;
  listTool: string;
}

const RESOURCE_CATALOG: ResourceDef[] = [
  { uri: 'banking://accounts', name: 'Bank Accounts', description: 'All bank accounts for the authenticated user', mimeType: 'application/json', requiredScope: 'banking:read', uriTemplate: 'banking://accounts/{accountId}', templateName: 'Bank Account', listTool: 'list_banking_accounts' },
  { uri: 'healthcare://records', name: 'Patient Records', description: 'All patient records for the authenticated user', mimeType: 'application/json', requiredScope: 'healthcare:read', uriTemplate: 'healthcare://records/{recordId}', templateName: 'Patient Record', listTool: 'list_patient_records' },
  { uri: 'government://permits', name: 'Government Permits', description: 'All government permits for the authenticated user', mimeType: 'application/json', requiredScope: 'government:read', uriTemplate: 'government://permits/{permitId}', templateName: 'Government Permit', listTool: 'list_permits' },
  { uri: 'manufacturing://work-orders', name: 'Work Orders', description: 'All work orders for the authenticated user', mimeType: 'application/json', requiredScope: 'manufacturing:read', uriTemplate: 'manufacturing://work-orders/{orderId}', templateName: 'Work Order', listTool: 'list_work_orders' },
  { uri: 'retail://orders', name: 'Retail Orders', description: 'All retail orders for the authenticated user', mimeType: 'application/json', requiredScope: 'retail:read', uriTemplate: 'retail://orders/{orderId}', templateName: 'Retail Order', listTool: 'list_orders' },
  { uri: 'sporting-goods://gear-orders', name: 'Gear Orders', description: 'All sporting-goods orders for the authenticated user', mimeType: 'application/json', requiredScope: 'sporting-goods:read', uriTemplate: 'sporting-goods://gear-orders/{orderId}', templateName: 'Gear Order', listTool: 'list_gear_orders' },
  { uri: 'university://courses', name: 'Courses', description: 'All courses for the authenticated student', mimeType: 'application/json', requiredScope: 'university:read', uriTemplate: 'university://courses/{courseId}', templateName: 'Course', listTool: 'list_courses' },
  { uri: 'workforce://expenses', name: 'Expenses', description: 'All expense reports for the authenticated employee', mimeType: 'application/json', requiredScope: 'workforce:read', uriTemplate: 'workforce://expenses/{expenseId}', templateName: 'Expense', listTool: 'list_expenses' },
  { uri: 'anf://orders', name: 'ANF Orders', description: 'All Abercrombie & Fitch orders for the authenticated user', mimeType: 'application/json', requiredScope: 'anf:read', uriTemplate: 'anf://orders/{orderId}', templateName: 'ANF Order', listTool: 'list_anf_orders' },
  { uri: 'investment://accounts', name: 'Investment Accounts', description: 'All investment accounts for the authenticated user', mimeType: 'application/json', requiredScope: 'invest:read', uriTemplate: 'investment://accounts/{accountId}', templateName: 'Investment Account', listTool: 'get_investment_accounts' },
  { uri: 'airlines://bookings', name: 'Airline Bookings', description: 'All airline bookings for the authenticated passenger', mimeType: 'application/json', requiredScope: 'airlines:read', uriTemplate: 'airlines://bookings/{bookingId}', templateName: 'Airline Booking', listTool: 'get_airline_bookings' },
];
```

Update `initialize` response to advertise resources:

```typescript
  if (method === 'initialize') {
    send(rpcResult(id, {
      protocolVersion: '2025-11-25',
      capabilities: {
        tools: {},
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: { name: 'banking-mcp-resource-server', version: '1.0.0' },
    }));
    return;
  }
```

Add the three resource methods in `handleMessage`, after the `tools/call` handler and before the final `send(rpcError(...))`:

```typescript
  if (method === 'resources/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const has = (s: string) => scopes.includes(s) || scopes.includes('*');
    const resources = RESOURCE_CATALOG.filter((r) => has(r.requiredScope)).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
    send(rpcResult(id, { resources }));
    return;
  }

  if (method === 'resources/templates/list') {
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const scopes = extractScopes(decoded);
    const has = (s: string) => scopes.includes(s) || scopes.includes('*');
    const resourceTemplates = RESOURCE_CATALOG.filter((r) => has(r.requiredScope)).map((r) => ({
      uriTemplate: r.uriTemplate,
      name: r.templateName,
      description: r.description,
      mimeType: r.mimeType,
    }));
    send(rpcResult(id, { resourceTemplates }));
    return;
  }

  if (method === 'resources/read') {
    const uri: string = msg.params?.uri || '';
    let decoded;
    try { decoded = await decodeAndValidate(token, ACCEPTED_AUDIENCES); } catch (e) {
      const te = e as TokenError;
      send(rpcError(id, -32001, te.message));
      return;
    }
    const resource = RESOURCE_CATALOG.find((r) => r.uri === uri);
    if (!resource) {
      send(rpcError(id, -32002, `Unknown resource URI: ${uri}`));
      return;
    }
    const scopes = extractScopes(decoded);
    const hasScope = scopes.includes(resource.requiredScope) || scopes.includes('*');
    if (!hasScope) {
      send(rpcError(id, -32005, `Insufficient scope for resource '${uri}'`, {
        requiredScope: resource.requiredScope,
        availableScopes: scopes,
      }));
      return;
    }
    try {
      const data = await dispatch(resource.listTool, {}, token, decoded.sub);
      send(rpcResult(id, {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        }],
      }));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      send(rpcError(id, -32603, `Resource read failed: ${errMsg}`));
    }
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_mcp_resource_server && npx jest tests/resources.test.ts --no-coverage
```

- [ ] **Step 5: Type-check + full suite**

```bash
cd demo_mcp_resource_server && npx tsc --noEmit && npx jest --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_resource_server/src/index.ts \
        demo_mcp_resource_server/tests/resources.test.ts
git commit -m "feat(mcp-resource-server): add resources/list, resources/templates/list, resources/read handlers"
```

---

## Task 7: intentHints fallback in nlIntentParser

**Files:**
- Modify: `demo_api_server/services/nlIntentParser.js`
- Test: `demo_api_server/tests/nlIntentParser.intentHints.test.js`

**Interfaces:**
- Consumes: `parseHeuristic(message, vertical, verticalCtx, options)` — existing function
- Consumes: `mcp-tool-schemas.json` at repo root (regenerate after this task with `npm run gen:tool-schemas` in `demo_mcp_gateway`)
- Produces: `parseHeuristic` falls back to `intentHints` phrase matching when heuristic returns `confidence < 0.5` AND `verticalCtx.tools` is provided
- Produces: match returns `{ kind: vertical, [vertical]: { action: toolName }, confidence: 0.7, source: 'intentHints' }`

Design: the caller (BFF agent route) already passes `verticalCtx` which includes vertical chips. We extend `verticalCtx` to accept an optional `tools` array (same shape as `tools/list` response). When `parseHeuristic` gets `unknown` result (confidence 0.3), it runs a second pass: normalize the user message, iterate `verticalCtx.tools`, check if any `intentHint` is a substring of the normalized message. First match wins at confidence 0.7.

- [ ] **Step 1: Write failing test**

Create `demo_api_server/tests/nlIntentParser.intentHints.test.js`:

```javascript
'use strict';
const { parseHeuristic } = require('../services/nlIntentParser');

const mockTools = [
  {
    name: 'list_patient_records',
    intentHints: ['show my health records', 'list my patient records', 'what are my medical records'],
  },
  {
    name: 'get_patient_record',
    intentHints: ['show my health record', 'get patient record details', 'view my insurance coverage'],
  },
];

const verticalCtx = {
  verticalId: 'healthcare',
  tools: mockTools,
};

describe('parseHeuristic intentHints fallback', () => {
  it('matches "show my health records" via intentHints when heuristic is unknown', () => {
    const result = parseHeuristic('show my health records', 'healthcare', verticalCtx);
    expect(result.kind).toBe('healthcare');
    expect(result.toolName).toBe('list_patient_records');
    expect(result.source).toBe('intentHints');
  });

  it('matches partial phrase contained in intentHint', () => {
    const result = parseHeuristic('view my insurance coverage', 'healthcare', verticalCtx);
    expect(result.kind).toBe('healthcare');
    expect(result.toolName).toBe('get_patient_record');
  });

  it('does NOT use intentHints when heuristic already matched', () => {
    // "transfer" is a high-confidence banking heuristic — should NOT fall through to intentHints
    const result = parseHeuristic('transfer money', 'banking', { verticalId: 'banking', tools: mockTools });
    expect(result.source).toBeUndefined();
  });

  it('returns unknown when no intentHint matches', () => {
    const result = parseHeuristic('completely unrelated phrase xyz', 'healthcare', verticalCtx);
    expect(result.kind).not.toBe('healthcare');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/nlIntentParser.intentHints.test.js --no-coverage --forceExit
```

- [ ] **Step 3: Add intentHints fallback to `nlIntentParser.js`**

Find the end of `parseHeuristic` (around line 910). After the vertical-specific dispatch chain resolves to a final return but before the function closes, locate where `parseForFallback` or the vertical dispatch returns. The key insertion point is: **after heuristic result is computed, before returning it**, check if result is low-confidence and `verticalCtx?.tools` exists.

The cleanest approach: wrap the existing heuristic body so its return value is captured, then apply the fallback. Find in the function body the pattern where the final `{ kind: ... }` is about to be returned and add:

Locate the line near the end of `parseHeuristic` that reads:
```javascript
  // Unknown/ambiguous — fall through to education or vertical routing
```
or whichever "last resort" block exists before the function's closing brace. Add this block immediately before `parseHeuristic`'s closing `}`:

```javascript
  // intentHints fallback: when heuristic has no match and caller supplied
  // verticalCtx.tools (from tools/list), try phrase matching against intentHints.
  // Only runs when we are about to return a low-confidence / unknown result.
  if (verticalCtx?.tools && Array.isArray(verticalCtx.tools)) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const tNorm = norm(message);
    for (const tool of verticalCtx.tools) {
      if (!Array.isArray(tool.intentHints)) continue;
      for (const hint of tool.intentHints) {
        if (tNorm.includes(norm(hint))) {
          return {
            kind: vertical,
            [vertical]: { action: tool.name },
            toolName: tool.name,
            confidence: 0.7,
            source: 'intentHints',
          };
        }
      }
    }
  }
```

**Important:** This block must be inserted AFTER the high-confidence heuristic matches and BEFORE the final low-confidence/unknown return. The exact insertion point is just before the last `return` statement inside `parseHeuristic` that returns a low-confidence or "no match" result.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/nlIntentParser.intentHints.test.js --no-coverage --forceExit
```

- [ ] **Step 5: Run full BFF test suite to check for regressions**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
```

Expected: all existing tests pass

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/nlIntentParser.js \
        demo_api_server/tests/nlIntentParser.intentHints.test.js
git commit -m "feat(nl-intent): add intentHints fallback pass to parseHeuristic"
```

---

## Task 8: Regenerate tool schemas + topology verify

After all code changes, regenerate the `mcp-tool-schemas.json` artifact that the gateway and tests consume.

- [ ] **Step 1: Regenerate schema artifact**

```bash
cd demo_mcp_gateway && npm run gen:tool-schemas
```

Expected: `ping-gateway/config/mcp-tool-schemas.json` updated with new vertical tools

- [ ] **Step 2: Verify topology**

```bash
cd /path/to/repo/root && npm run topology:verify
```

Expected: PASS (or same pre-existing failures as before this work — do not introduce new ones)

- [ ] **Step 3: Commit schema artifact**

```bash
git add ping-gateway/config/mcp-tool-schemas.json
git commit -m "chore: regenerate mcp-tool-schemas.json with all-vertical tools"
```

---

## Task 9: Push + PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin worktree-mcp-param-descriptions
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat(mcp): all-vertical tools + resources + intentHints NL fallback" \
  --body "Adds tools and MCP resources for all 9 remaining demo verticals (banking, healthcare, government, manufacturing, retail, sporting-goods, university, workforce, ANF). Each tool carries rich description + intentHints phrases. The NL intent parser gains an intentHints fallback pass for verticals without hardcoded heuristics. Also adds resources/list, resources/templates/list, and resources/read MCP handlers across all 11 verticals."
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| 9 new verticals with tools | Tasks 2–4 |
| `intentHints` on McpToolDef | Task 1 |
| Rich `description` on all new tools | Tasks 2–4 |
| `intentHints` in tools/list response | Task 5 |
| NL intent parser fallback | Task 7 |
| `resources/list` | Task 6 |
| `resources/templates/list` | Task 6 |
| `resources/read` | Task 6 |
| Scope filtering on all resource methods | Task 6 |
| `-32001` on missing token | Task 6 |
| `-32005` on wrong scope | Task 6 |
| `resources` in capabilities | Task 6 |
| Schema regen | Task 8 |
| `npx tsc --noEmit` passes | Every task |
| Existing tests still pass | Every task |

All spec requirements covered. No placeholders. Type signatures consistent across tasks.
