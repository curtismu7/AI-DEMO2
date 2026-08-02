# Government + University Verticals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two fully-wired industry verticals — Government (CivicPermit · Permits & Licensing) and University (Super University · Registrar & Enrollment) — as skins over the demo's five banking primitives, with working feature pages.

**Architecture:** Each vertical is a `config/verticals/<id>/` directory (`manifest.json` + `mock-data.json`) discovered at server `init()` — no code registers it. Domain vocabulary maps to the fixed banking actions (`accounts`/`balance`/`transactions`/`transfer`/`feature`) via the manifest, the `THEME_VOCAB` heuristic, and the Helix theme directive. The feature page (5th chip) is served over the API-key path through `demo_api_resource_server` → MCP gateway → MCP registry, gated by a vertical-specific OAuth scope provisioned in PingOne.

**Tech Stack:** Node.js (demo_api_server), TypeScript (demo_mcp_gateway, demo_mcp_server), Express (demo_api_resource_server), Zod (manifest validation), Jest (api-server tests).

## Global Constraints

- Manifest is Zod-validated against `demo_api_server/services/verticalManifest/schema.js`. Required: `id` (`^[a-z][a-z0-9-]*$`), `schemaVersion: 3`, `identity.displayName`, `theme.cssVars` (≥1), `agent.persona`. Unknown keys are **stripped** — never add a block not modeled in the schema (all blocks used here ARE modeled: `chips10`, `securityShowcase`, `delegation`, `render`, `featurePage`, `hero`, `llmChipGroups`).
- Scope names are plain only: `read`, `write`, `admin`, `transfer`, `<noun>:read` — never `banking:*`-prefixed.
- No emojis in source code/commits (security-showcase chip labels that already use emoji in the healthcare reference are the one allowed exception — they are UI copy, copied verbatim).
- Do NOT add the vertical id to any array/switch — there are none.
- Work stays in the worktree `worktree-gov-university-verticals`; stage files explicitly (`git add <files>`), never `git add -A`; verify `git branch --show-current` before each commit.
- The pre-commit hook asks for a CHANGELOG.md `[Unreleased]` line and may suggest `/simplify`. Add the CHANGELOG line; `/simplify` is advisory for config/JSON.
- Government id = `government`, brand `CivicPermit`, persona `Liberty`, feature tool `show_permit`, dataKey `permit`, scope `permits:read`, backend route `permit`.
- University id = `university`, brand `Super University`, persona `Scholar`, feature tool `show_enrollment`, dataKey `enrollment`, scope `transcript:read`, backend route `enrollment`.

---

## File Structure

**PR 1 — config-only (Tier 1 + Tier 2):**
- Create: `demo_api_server/config/verticals/government/manifest.json`
- Create: `demo_api_server/config/verticals/government/mock-data.json`
- Create: `demo_api_server/config/verticals/university/manifest.json`
- Create: `demo_api_server/config/verticals/university/mock-data.json`
- Modify: `demo_api_server/services/nlIntentParser.js` (`THEME_VOCAB`)
- Modify: `docs/HELIX_AGENT_DIRECTIVES.json` (`themes` object)
- Modify: `docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md` (append two sections)
- Modify: `CHANGELOG.md`

**PR 2 — feature-page backend (Tier 3):**
- Modify: `demo_api_resource_server/server.js` (`VERTICALS` map: add `permit`, `enrollment`)
- Modify: `demo_mcp_gateway/src/router.ts` (`APIKEY_TOOLS`, `APIKEY_BACKEND_ROUTES`)
- Modify: `demo_mcp_gateway/src/apiKeyDispatch.ts` (`TOOL_DISPLAY_NAMES`)
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts` (`TOOLS` map, visibility-only)
- PingOne: `npm run pingone:bootstrap` provisions `permits:read`, `transcript:read`

**Reference template (read, do not modify):** `demo_api_server/config/verticals/healthcare/manifest.json` and `mock-data.json` — the full-fat shape this plan mirrors.

---

# PR 1 — Config-only verticals (Tier 1 + Tier 2)

### Task 1: Government Tier-1 manifest + mock-data

**Files:**
- Create: `demo_api_server/config/verticals/government/manifest.json`
- Create: `demo_api_server/config/verticals/government/mock-data.json`

**Interfaces:**
- Produces: a Zod-valid vertical with id `government`, scopes `{read,write,transfer,featureScope:"permits:read"}`, featurePage `{mcpTool:"show_permit", dataKey:"permit"}`. Tasks 2–4 reference the chip labels and terminology defined here.

- [ ] **Step 1: Write the manifest** (`demo_api_server/config/verticals/government/manifest.json`)

```json
{
  "id": "government",
  "schemaVersion": 3,
  "identity": {
    "displayName": "CivicPermit",
    "headerTitle": "CivicPermit",
    "documentTitle": "CivicPermit · PingOne AI IAM Core",
    "logoAlt": "CivicPermit logo",
    "tagline": "AI-Powered Citizen Permitting Demo",
    "logoPath": null
  },
  "theme": {
    "cssVars": {
      "--app-primary-red": "#1d4ed8",
      "--app-primary-red-hover": "#1e40af",
      "--app-primary-red-mid": "#3b82f6",
      "--app-primary-red-border": "#1e40af",
      "--brand-dashboard-header-start": "#1e3a8a",
      "--brand-dashboard-header-end": "#2563eb",
      "--brand-app-shell-hero-start": "#1e3a8a",
      "--brand-app-shell-hero-end": "#2563eb",
      "--theme-accent": "#f59e0b",
      "--brand-dashboard-header-text": "#ffffff"
    }
  },
  "terminology": {
    "account": "Permit",
    "accounts": "Permits & Licenses",
    "accountTypes": ["Building", "Business", "Professional"],
    "transaction": "Filing",
    "transactions": "Filing History",
    "transactionTypes": ["Application", "Inspection", "Renewal", "Records Release"],
    "balance": "Fees Owed",
    "agent": "Permit Assistant",
    "dashboard": "My Permits",
    "highValueAction": "Records Release",
    "highValueLabel": "Sensitive permit-record release to a third party"
  },
  "agent": {
    "persona": "Liberty",
    "greeting": "Hi {name}! I'm Liberty. I can show your permits and licenses, check fees owed, review your filing history, and help you release permit records — I'll walk you through the consent steps. What do you need?",
    "systemPromptFlavor": "You are Liberty, a CivicPermit citizen-services assistant. Help residents view permits and licenses, check fees owed, review filing history, and release permit records. Use government permitting language: accounts are permits and licenses, transactions are filings (applications, inspections, renewals, records releases), balance is fees owed. Be clear and procedural."
  },
  "dashboard": {
    "kind": "government",
    "chips": [
      { "key": "balance", "label": "Fees Owed" },
      { "key": "accounts", "label": "My Permits" },
      { "key": "transactions", "label": "Filing History" },
      { "key": "transfer", "label": "Release Record" },
      { "key": "feature", "label": "Permit Status" }
    ],
    "hero": {
      "cards": [
        { "label": "Active Permits", "dataKey": "heroStats.activePermits", "format": "count" },
        { "label": "Fees Owed", "dataKey": "heroStats.feesOwed", "format": "money" },
        { "label": "Next Inspection", "dataKey": "heroStats.nextInspection", "format": "date" },
        { "label": "License Status", "dataKey": "heroStats.licenseStatus", "format": "text" }
      ]
    },
    "llmChipGroups": {
      "Permits": [
        { "id": "gov_permits", "label": "My permits", "message": "Show my permits and licenses" },
        { "id": "gov_expiring", "label": "Expiring soon", "message": "Which of my permits expire soon?" }
      ],
      "Fees": [
        { "id": "gov_fees", "label": "What do I owe?", "message": "What permit fees do I owe?" },
        { "id": "gov_pay", "label": "Pay a fee", "message": "I want to pay an outstanding permit fee" }
      ],
      "Filings": [
        { "id": "gov_filings", "label": "Filing history", "message": "Show my filing history" },
        { "id": "gov_inspection", "label": "Inspection status", "message": "What's the status of my latest inspection?" }
      ],
      "Records": [
        { "id": "gov_release", "label": "Release a record", "message": "Release my permit record to a third party" }
      ]
    }
  },
  "scopes": {
    "read": "read",
    "write": "write",
    "transfer": "transfer",
    "featureScope": "permits:read"
  },
  "featurePage": {
    "mcpTool": "show_permit",
    "pageTitle": "Permit Status",
    "badgeLabel": "API-KEY PATH",
    "accentColor": "#1d4ed8",
    "dataKey": "permit",
    "fields": [
      { "label": "Permit ID", "path": "permitId" },
      { "label": "Type", "path": "permitType" },
      { "label": "Property / business", "path": "subject" },
      { "label": "Jurisdiction", "path": "jurisdiction" },
      { "label": "Issued", "path": "issuedDate" },
      { "label": "Expires", "path": "expiresDate" },
      { "label": "Fees owed", "path": "feesOwed", "format": "money", "accent": true },
      { "label": "Status", "path": "status" },
      { "label": "Inspector", "path": "inspector" }
    ],
    "sectionTitle": "Permit details",
    "emptyPrompt": "show permit status",
    "scopeError": "The agent's access token does not carry the permits:read scope. Sign out and sign back in to consent to permit access, then try \"Permit Status\" again."
  },
  "demoUsers": {
    "customer": { "hint": "demoUser", "passwordHint": "Tigers7&" },
    "admin": { "hint": "demoAdmin", "passwordHint": "Tigers7&" }
  }
}
```

- [ ] **Step 2: Write the mock-data** (`demo_api_server/config/verticals/government/mock-data.json`)

```json
{
  "heroStats": {
    "activePermits": 3,
    "feesOwed": 240.0,
    "nextInspection": "2026-07-08",
    "licenseStatus": "Active"
  },
  "permits": [
    { "id": "P-1001", "permitType": "Building", "subject": "1234 Maple St", "status": "Active", "expiresDate": "2026-12-01" },
    { "id": "P-1002", "permitType": "Business", "subject": "Maple Cafe LLC", "status": "Active", "expiresDate": "2026-09-15" },
    { "id": "P-1003", "permitType": "Professional", "subject": "Contractor License", "status": "Renewal Due", "expiresDate": "2026-07-01" }
  ],
  "filings": [
    { "id": "F-5001", "type": "Application", "date": "2026-04-02", "status": "Approved" },
    { "id": "F-5002", "type": "Inspection", "date": "2026-05-10", "status": "Passed" },
    { "id": "F-5003", "type": "Renewal", "date": "2026-05-28", "status": "Pending" }
  ]
}
```

- [ ] **Step 3: Verify the manifest loads and is discoverable**

Run:
```bash
cd demo_api_server && node -e "const {verticalManifest}=require('./services/verticalManifest'); verticalManifest.init(); const ids=verticalManifest.list().map(v=>v.id); console.log('Loaded:', ids.join(', ')); process.exit(ids.includes('government')?0:1)"
```
Expected: `Loaded: …, government, …` and exit 0. If it prints `Invalid manifest at …`, the message names the failing Zod field — fix and re-run.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/verticals/government/manifest.json demo_api_server/config/verticals/government/mock-data.json
git commit -m "feat(government): add CivicPermit vertical manifest + mock-data"
```

---

### Task 2: Government heuristic vocabulary

**Files:**
- Modify: `demo_api_server/services/nlIntentParser.js` (`THEME_VOCAB` object)
- Test: `demo_api_server` jest suite (`npm run test:api-server`)

**Interfaces:**
- Consumes: chip labels/terms from Task 1.
- Produces: `THEME_VOCAB.government` — routes themed phrases to banking actions. `parseTheme` auto-extracts `$NNN` for `transfer`.

- [ ] **Step 1: Add the vocab entry.** Find `const THEME_VOCAB` and add a `government` key. **Order is load-bearing — the "release" → transfer regex MUST precede the generic "record"/"permit" → accounts regex:**

```javascript
  government: [
    { re: /\b(release|share|send|disclose)\s*(my\s*)?(permit\s*)?record/i, action: 'transfer' },
    { re: /\b(fees?\s*(owed|due)?|what\s*do\s*i\s*owe|balance)\b/i, action: 'balance' },
    { re: /\b(filing|inspection|renewal)s?\b|\bfiling\s*history\b/i, action: 'transactions' },
    { re: /\b(permit|license)s?\b|\bmy\s*permits\b/i, action: 'accounts' },
  ],
```

- [ ] **Step 2: Run the api-server tests**

Run: `npm run test:api-server`
Expected: PASS, no new failures. (Note: jest excludes `.claude/worktrees`; run from the repo root, not the worktree path, if the suite reports "No tests found" — see the `jest-worktree-ignore` memory.)

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/services/nlIntentParser.js
git commit -m "feat(government): heuristic THEME_VOCAB routing for CivicPermit"
```

---

### Task 3: Government Helix theme directive

**Files:**
- Modify: `docs/HELIX_AGENT_DIRECTIVES.json` (`themes` object)
- Modify: `docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md` (append a section)

**Interfaces:**
- Consumes: terminology + chip labels from Task 1. Produces: `themes.government` directive string read by `buildSystem()` in `geminiNlIntent.js` at call time.

- [ ] **Step 1: Add the `government` key inside the `"themes"` object** in `docs/HELIX_AGENT_DIRECTIVES.json`:

```json
"government": "THEME OVERRIDE — CIVICPERMIT (GOVERNMENT PERMITTING):\nThe user is an authenticated resident managing permits and licenses.\nTranslate all permitting language to the underlying banking actions — never surface banking terminology.\nRestrict allowed actions to the following — do not emit mortgage or deposit/withdraw shapes:\n{\"kind\":\"banking\",\"banking\":{\"action\":\"accounts\",\"params\":{}}}\n{\"kind\":\"banking\",\"banking\":{\"action\":\"balance\",\"params\":{}}}\n{\"kind\":\"banking\",\"banking\":{\"action\":\"transactions\",\"params\":{}}}\n{\"kind\":\"banking\",\"banking\":{\"action\":\"transfer\",\"params\":{\"fromId\":\"checking\",\"toId\":\"savings\",\"amount\":0}}}\n{\"kind\":\"none\",\"message\":\"short hint\"}\n\nTERMINOLOGY MAP (translate to banking actions):\n\"permits\" / \"licenses\" / \"my permits\" → accounts\n\"filings\" / \"filing history\" / \"inspections\" / \"renewals\" → transactions\n\"fees owed\" / \"what do I owe\" → balance\n\"release record\" / \"disclose permit record\" → transfer\n\nCHIP VOCABULARY for government:\n\"Fees Owed\" → balance\n\"My Permits\" → accounts\n\"Filing History\" → transactions\n\"Release Record\" → transfer\n\nRefuse only for clearly out-of-scope requests (e.g. issuing new law, accessing another resident's records):\n{\"kind\":\"none\",\"message\":\"I can only help with your own permits, fees, filings, and record releases.\"}\nNever refuse on demo-disclaimer or access grounds."
```

- [ ] **Step 2: Verify JSON still parses**

Run: `node -e "require('./docs/HELIX_AGENT_DIRECTIVES.json'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Append the plain-text version** to the end of `docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md`:

```markdown

---

### Theme: CivicPermit (Government)

THEME OVERRIDE — CIVICPERMIT (GOVERNMENT PERMITTING):
The user is an authenticated resident managing permits and licenses.
Translate all permitting language to the underlying banking actions — never surface banking terminology.
Restrict allowed actions to: accounts, balance, transactions, transfer.

TERMINOLOGY MAP:
"permits" / "licenses" / "my permits" → accounts
"filings" / "filing history" / "inspections" / "renewals" → transactions
"fees owed" / "what do I owe" → balance
"release record" / "disclose permit record" → transfer

Refuse only for clearly out-of-scope requests. Never refuse on demo-disclaimer or access grounds.
```

- [ ] **Step 4: Commit**

```bash
git add docs/HELIX_AGENT_DIRECTIVES.json docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md
git commit -m "feat(government): Helix theme directive for CivicPermit"
```

---

### Task 4: Government Tier-2 full-fat blocks

**Files:**
- Modify: `demo_api_server/config/verticals/government/manifest.json`

**Interfaces:**
- Consumes: Task 1 manifest. Produces: `chips10`, `securityShowcase`, `delegation`, `render` blocks (all schema-modeled).

- [ ] **Step 1: Add a `chips10` array** to `dashboard` (after `llmChipGroups`). Mirror healthcare's shape — themed labels, `mode`/`tool`/`hitlTrigger`, one `direct` chip:

```json
    "chips10": [
      { "id": "gv1", "label": "My permits", "message": "show my permits", "mode": "both", "tool": "view_accounts" },
      { "id": "gv2", "label": "Fees owed", "message": "what fees do I owe", "mode": "both", "tool": "view_balances" },
      { "id": "gv3", "label": "Filing history", "message": "show my filing history", "mode": "both", "tool": "view_transactions" },
      { "id": "gv4", "label": "Pay a fee", "message": "pay a permit fee", "mode": "both", "tool": "create_deposit" },
      { "id": "gv5", "label": "🔐 Release record", "message": "release my permit record", "mode": "both", "hitlTrigger": true, "tool": "create_transfer" },
      { "id": "gv-feature", "label": "Permit status", "message": "show permit status", "mode": "both", "tool": "show_permit" },
      { "id": "gv6", "label": "Expiring permits", "message": "which permits expire soon", "mode": "both" },
      { "id": "gv7", "label": "Inspection status", "message": "what is my inspection status", "mode": "both" },
      { "id": "gv8", "label": "Renew a license", "message": "renew my professional license", "mode": "llm" },
      { "id": "gv-direct", "label": "🔌 Direct MCP", "message": "get my permits", "mode": "direct", "tool": "view_accounts" }
    ],
```

- [ ] **Step 2: Add `securityShowcase`.** Copy the entire `dashboard.securityShowcase` block from `demo_api_server/config/verticals/healthcare/manifest.json` verbatim, then make exactly these edits in the copy:
  - In every chip whose `message` is `"release my records"`, change `message` to `"release my permit record"` and `tool` from `release_records` to `create_transfer`.
  - In the `caption` text for `sec_mfa_otp`, `sec_mfa_fido`, `sec_hitl`, replace "records release"/"money moved" phrasing with "a permit-record release". Leave the `attacks`, `ai`, and `pingone` tabs unchanged (domain-neutral).
  - Leave `sec_deny` (`show my mortgage` cross-vertical DENY) and `sec_bad_scope` exactly as-is — they demonstrate cross-vertical denial and apply unchanged.

- [ ] **Step 3: Add `delegation`** (top-level, sibling of `dashboard`). Copy healthcare's `delegation` block and reword for a permitting proxy:

```json
  "delegation": {
    "pageTitle": "Authorized Representative",
    "pageDescription": "Authorize a contractor or representative to manage your permits — powered by RFC 8693 token exchange",
    "granteeLabel": "contractor or representative",
    "scopeLabels": {
      "view_accounts":     { "label": "View Permits",     "description": "See permit and license list" },
      "view_balances":     { "label": "View Fees Owed",   "description": "See outstanding permit fees" },
      "create_deposit":    { "label": "Pay Fees",         "description": "Pay outstanding permit fees" },
      "create_withdrawal": { "label": "Withdraw Filing",  "description": "Withdraw a pending filing" },
      "create_transfer":   { "label": "Release Records",  "description": "Authorize permit-record release to a third party" }
    }
  },
```

- [ ] **Step 4: Add `render`** (top-level, sibling of `dashboard`). Copy healthcare's `render` block and adapt the tool keys/columns to permitting:

```json
  "render": {
    "view_balances": { "type": "fieldList", "title": "Fees Owed", "fields": [ { "label": "Total owed", "path": "total", "format": "money" }, { "label": "Oldest due", "path": "oldestDue", "format": "date" } ] },
    "view_accounts": { "type": "table", "columns": [ { "label": "Permit ID", "path": "id" }, { "label": "Type", "path": "permitType" }, { "label": "Subject", "path": "subject" }, { "label": "Status", "path": "status" } ] },
    "view_transactions": { "type": "table", "columns": [ { "label": "Filing #", "path": "id" }, { "label": "Type", "path": "type" }, { "label": "Date", "path": "date", "format": "date" }, { "label": "Status", "path": "status" } ] },
    "create_transfer": { "type": "card", "title": "Record Released", "fields": [ { "label": "Permit", "path": "permitType" }, { "label": "Status", "path": "status" } ] }
  },
```

- [ ] **Step 5: Verify the manifest still validates** (re-run Task 1 Step 3 loader command). Expected: exit 0, no `Invalid manifest`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/verticals/government/manifest.json
git commit -m "feat(government): Tier-2 chips10, securityShowcase, delegation, render"
```

---

### Task 5: University Tier-1 manifest + mock-data

**Files:**
- Create: `demo_api_server/config/verticals/university/manifest.json`
- Create: `demo_api_server/config/verticals/university/mock-data.json`

**Interfaces:**
- Produces: Zod-valid vertical id `university`, scopes `{read,write,transfer,featureScope:"transcript:read"}`, featurePage `{mcpTool:"show_enrollment", dataKey:"enrollment"}`.

- [ ] **Step 1: Write the manifest** (`demo_api_server/config/verticals/university/manifest.json`)

```json
{
  "id": "university",
  "schemaVersion": 3,
  "identity": {
    "displayName": "Super University",
    "headerTitle": "Super University",
    "documentTitle": "Super University · PingOne AI IAM Core",
    "logoAlt": "Super University logo",
    "tagline": "AI-Powered Campus Registrar Demo",
    "logoPath": null
  },
  "theme": {
    "cssVars": {
      "--app-primary-red": "#6d28d9",
      "--app-primary-red-hover": "#5b21b6",
      "--app-primary-red-mid": "#8b5cf6",
      "--app-primary-red-border": "#5b21b6",
      "--brand-dashboard-header-start": "#4c1d95",
      "--brand-dashboard-header-end": "#7c3aed",
      "--brand-app-shell-hero-start": "#4c1d95",
      "--brand-app-shell-hero-end": "#7c3aed",
      "--theme-accent": "#f59e0b",
      "--brand-dashboard-header-text": "#ffffff"
    }
  },
  "terminology": {
    "account": "Course",
    "accounts": "Enrolled Courses",
    "accountTypes": ["Core", "Elective", "Lab"],
    "transaction": "Enrollment Event",
    "transactions": "Enrollment History",
    "transactionTypes": ["Registration", "Drop", "Grade Posted", "Transcript Release"],
    "balance": "Credit Standing",
    "agent": "Registrar Assistant",
    "dashboard": "My Enrollment",
    "highValueAction": "Transcript Release",
    "highValueLabel": "Official transcript release to a third party"
  },
  "agent": {
    "persona": "Scholar",
    "greeting": "Hi {name}! I'm Scholar. I can show your enrolled courses, check your credit standing and holds, review your enrollment history, and help you release an official transcript — I'll walk you through the consent steps. What do you need?",
    "systemPromptFlavor": "You are Scholar, a Super University registrar assistant. Help students view enrolled courses, check credit standing and registration holds, review enrollment history, and release official transcripts. Use registrar language: accounts are enrolled courses, transactions are enrollment events (registration, drop, grade posted, transcript release), balance is credit standing. Be clear and supportive."
  },
  "dashboard": {
    "kind": "university",
    "chips": [
      { "key": "balance", "label": "Credit Standing" },
      { "key": "accounts", "label": "My Courses" },
      { "key": "transactions", "label": "Enrollment History" },
      { "key": "transfer", "label": "Release Transcript" },
      { "key": "feature", "label": "Enrollment Status" }
    ],
    "hero": {
      "cards": [
        { "label": "Enrolled Courses", "dataKey": "heroStats.enrolledCourses", "format": "count" },
        { "label": "Credits Earned", "dataKey": "heroStats.creditsEarned", "format": "count" },
        { "label": "Registration Holds", "dataKey": "heroStats.holds", "format": "count" },
        { "label": "Standing", "dataKey": "heroStats.standing", "format": "text" }
      ]
    },
    "llmChipGroups": {
      "Courses": [
        { "id": "uni_courses", "label": "My courses", "message": "Show my enrolled courses" },
        { "id": "uni_schedule", "label": "My schedule", "message": "What's my class schedule this term?" }
      ],
      "Standing": [
        { "id": "uni_credits", "label": "Credits earned", "message": "How many credits have I earned?" },
        { "id": "uni_holds", "label": "Any holds?", "message": "Do I have any registration holds?" }
      ],
      "History": [
        { "id": "uni_history", "label": "Enrollment history", "message": "Show my enrollment history" },
        { "id": "uni_grades", "label": "Recent grades", "message": "Show my most recent posted grades" }
      ],
      "Transcript": [
        { "id": "uni_release", "label": "Release transcript", "message": "Release my official transcript to a third party" }
      ]
    }
  },
  "scopes": {
    "read": "read",
    "write": "write",
    "transfer": "transfer",
    "featureScope": "transcript:read"
  },
  "featurePage": {
    "mcpTool": "show_enrollment",
    "pageTitle": "Enrollment Status",
    "badgeLabel": "API-KEY PATH",
    "accentColor": "#6d28d9",
    "dataKey": "enrollment",
    "fields": [
      { "label": "Student ID", "path": "studentId" },
      { "label": "Program", "path": "program" },
      { "label": "Term", "path": "term" },
      { "label": "Standing", "path": "standing" },
      { "label": "Enrolled credits", "path": "enrolledCredits", "format": "count" },
      { "label": "Credits earned", "path": "creditsEarned", "format": "count" },
      { "label": "GPA", "path": "gpa" },
      { "label": "Tuition balance", "path": "tuitionBalance", "format": "money", "accent": true },
      { "label": "Holds", "path": "holds" }
    ],
    "sectionTitle": "Enrollment details",
    "emptyPrompt": "show enrollment status",
    "scopeError": "The agent's access token does not carry the transcript:read scope. Sign out and sign back in to consent to transcript access, then try \"Enrollment Status\" again."
  },
  "demoUsers": {
    "customer": { "hint": "demoUser", "passwordHint": "Tigers7&" },
    "admin": { "hint": "demoAdmin", "passwordHint": "Tigers7&" }
  }
}
```

- [ ] **Step 2: Write the mock-data** (`demo_api_server/config/verticals/university/mock-data.json`)

```json
{
  "heroStats": {
    "enrolledCourses": 4,
    "creditsEarned": 78,
    "holds": 0,
    "standing": "Good Standing"
  },
  "courses": [
    { "id": "C-CS301", "title": "Algorithms", "courseType": "Core", "credits": 4, "grade": "In Progress" },
    { "id": "C-ENG210", "title": "Technical Writing", "courseType": "Elective", "credits": 3, "grade": "In Progress" },
    { "id": "C-PHY150", "title": "Physics II Lab", "courseType": "Lab", "credits": 1, "grade": "In Progress" },
    { "id": "C-HIS101", "title": "World History", "courseType": "Elective", "credits": 3, "grade": "A-" }
  ],
  "enrollmentHistory": [
    { "id": "E-9001", "type": "Registration", "course": "CS301", "date": "2026-01-12", "status": "Confirmed" },
    { "id": "E-9002", "type": "Drop", "course": "MAT220", "date": "2026-01-20", "status": "Processed" },
    { "id": "E-9003", "type": "Grade Posted", "course": "HIS101", "date": "2026-05-15", "status": "Final" }
  ]
}
```

- [ ] **Step 3: Verify the manifest loads** (same loader command as Task 1 Step 3, with `university`):
```bash
cd demo_api_server && node -e "const {verticalManifest}=require('./services/verticalManifest'); verticalManifest.init(); const ids=verticalManifest.list().map(v=>v.id); console.log('Loaded:', ids.join(', ')); process.exit(ids.includes('university')?0:1)"
```
Expected: exit 0, `university` in the list.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/verticals/university/manifest.json demo_api_server/config/verticals/university/mock-data.json
git commit -m "feat(university): add Super University vertical manifest + mock-data"
```

---

### Task 6: University heuristic vocabulary

**Files:**
- Modify: `demo_api_server/services/nlIntentParser.js` (`THEME_VOCAB`)

**Interfaces:** Produces `THEME_VOCAB.university`.

- [ ] **Step 1: Add the `university` key** to `THEME_VOCAB`. **"release transcript" → transfer MUST precede "transcript"/"courses" → accounts:**

```javascript
  university: [
    { re: /\b(release|share|send)\s*(my\s*)?(official\s*)?transcript/i, action: 'transfer' },
    { re: /\b(credit\s*standing|credits?\s*(earned)?|hold(s)?|gpa|standing)\b/i, action: 'balance' },
    { re: /\b(enrollment\s*(history)?|registration|drop|grade(s)?)\b/i, action: 'transactions' },
    { re: /\b(course|class)es?\b|\bmy\s*courses\b|\btranscript\b/i, action: 'accounts' },
  ],
```

- [ ] **Step 2: Run the api-server tests**

Run: `npm run test:api-server`
Expected: PASS, no new failures.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/services/nlIntentParser.js
git commit -m "feat(university): heuristic THEME_VOCAB routing for Super University"
```

---

### Task 7: University Helix theme directive

**Files:**
- Modify: `docs/HELIX_AGENT_DIRECTIVES.json`
- Modify: `docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md`

- [ ] **Step 1: Add the `university` key inside `"themes"`** in `docs/HELIX_AGENT_DIRECTIVES.json`:

```json
"university": "THEME OVERRIDE — SUPER UNIVERSITY (CAMPUS REGISTRAR):\nThe user is an authenticated student managing enrollment.\nTranslate all registrar language to the underlying banking actions — never surface banking terminology.\nRestrict allowed actions to the following — do not emit mortgage or deposit/withdraw shapes:\n{\"kind\":\"banking\",\"banking\":{\"action\":\"accounts\",\"params\":{}}}\n{\"kind\":\"banking\",\"banking\":{\"action\":\"balance\",\"params\":{}}}\n{\"kind\":\"banking\",\"banking\":{\"action\":\"transactions\",\"params\":{}}}\n{\"kind\":\"banking\",\"banking\":{\"action\":\"transfer\",\"params\":{\"fromId\":\"checking\",\"toId\":\"savings\",\"amount\":0}}}\n{\"kind\":\"none\",\"message\":\"short hint\"}\n\nTERMINOLOGY MAP (translate to banking actions):\n\"courses\" / \"classes\" / \"my courses\" → accounts\n\"enrollment history\" / \"registration\" / \"drop\" / \"grades\" → transactions\n\"credit standing\" / \"credits\" / \"holds\" / \"GPA\" → balance\n\"release transcript\" / \"send my transcript\" → transfer\n\nCHIP VOCABULARY for university:\n\"Credit Standing\" → balance\n\"My Courses\" → accounts\n\"Enrollment History\" → transactions\n\"Release Transcript\" → transfer\n\nRefuse only for clearly out-of-scope requests (e.g. changing a grade, accessing another student's record):\n{\"kind\":\"none\",\"message\":\"I can only help with your own courses, credit standing, enrollment history, and transcript releases.\"}\nNever refuse on demo-disclaimer or access grounds."
```

- [ ] **Step 2: Verify JSON parses**

Run: `node -e "require('./docs/HELIX_AGENT_DIRECTIVES.json'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Append the plain-text section** to `docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md`:

```markdown

---

### Theme: Super University (Registrar)

THEME OVERRIDE — SUPER UNIVERSITY (CAMPUS REGISTRAR):
The user is an authenticated student managing enrollment.
Translate all registrar language to the underlying banking actions — never surface banking terminology.
Restrict allowed actions to: accounts, balance, transactions, transfer.

TERMINOLOGY MAP:
"courses" / "classes" / "my courses" → accounts
"enrollment history" / "registration" / "drop" / "grades" → transactions
"credit standing" / "credits" / "holds" / "GPA" → balance
"release transcript" / "send my transcript" → transfer

Refuse only for clearly out-of-scope requests. Never refuse on demo-disclaimer or access grounds.
```

- [ ] **Step 4: Commit**

```bash
git add docs/HELIX_AGENT_DIRECTIVES.json docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md
git commit -m "feat(university): Helix theme directive for Super University"
```

---

### Task 8: University Tier-2 full-fat blocks

**Files:**
- Modify: `demo_api_server/config/verticals/university/manifest.json`

- [ ] **Step 1: Add `chips10`** to `dashboard`:

```json
    "chips10": [
      { "id": "un1", "label": "My courses", "message": "show my enrolled courses", "mode": "both", "tool": "view_accounts" },
      { "id": "un2", "label": "Credit standing", "message": "what is my credit standing", "mode": "both", "tool": "view_balances" },
      { "id": "un3", "label": "Enrollment history", "message": "show my enrollment history", "mode": "both", "tool": "view_transactions" },
      { "id": "un4", "label": "Register a course", "message": "register for a course", "mode": "both", "tool": "create_deposit" },
      { "id": "un5", "label": "🔐 Release transcript", "message": "release my official transcript", "mode": "both", "hitlTrigger": true, "tool": "create_transfer" },
      { "id": "un-feature", "label": "Enrollment status", "message": "show enrollment status", "mode": "both", "tool": "show_enrollment" },
      { "id": "un6", "label": "Any holds?", "message": "do I have any registration holds", "mode": "both" },
      { "id": "un7", "label": "Recent grades", "message": "show my recent grades", "mode": "both" },
      { "id": "un8", "label": "Am I on track to graduate?", "message": "am I on track to graduate", "mode": "llm" },
      { "id": "un-direct", "label": "🔌 Direct MCP", "message": "get my courses", "mode": "direct", "tool": "view_accounts" }
    ],
```

- [ ] **Step 2: Add `securityShowcase`.** Copy healthcare's `dashboard.securityShowcase` verbatim, then:
  - Every chip with `message: "release my records"` → `message: "release my official transcript"`, `tool: release_records` → `create_transfer`.
  - Reword `sec_mfa_otp` / `sec_mfa_fido` / `sec_hitl` captions from records-release wording to "an official transcript release".
  - Leave `sec_deny` (`show my mortgage`), `sec_bad_scope`, and the `attacks`/`ai`/`pingone` tabs unchanged.

- [ ] **Step 3: Add `delegation`** (sibling of `dashboard`):

```json
  "delegation": {
    "pageTitle": "Authorized Proxy",
    "pageDescription": "Authorize a parent or advisor to view your enrollment — powered by RFC 8693 token exchange",
    "granteeLabel": "parent or academic advisor",
    "scopeLabels": {
      "view_accounts":     { "label": "View Courses",        "description": "See enrolled course list" },
      "view_balances":     { "label": "View Credit Standing", "description": "See credits, holds, and standing" },
      "create_deposit":    { "label": "Register Courses",    "description": "Register for new courses" },
      "create_withdrawal": { "label": "Drop Courses",        "description": "Drop an enrolled course" },
      "create_transfer":   { "label": "Release Transcript",  "description": "Authorize official transcript release to a third party" }
    }
  },
```

- [ ] **Step 4: Add `render`** (sibling of `dashboard`):

```json
  "render": {
    "view_balances": { "type": "fieldList", "title": "Credit Standing", "fields": [ { "label": "Credits earned", "path": "creditsEarned", "format": "count" }, { "label": "Holds", "path": "holds" }, { "label": "Standing", "path": "standing" } ] },
    "view_accounts": { "type": "table", "columns": [ { "label": "Course", "path": "id" }, { "label": "Title", "path": "title" }, { "label": "Type", "path": "courseType" }, { "label": "Grade", "path": "grade" } ] },
    "view_transactions": { "type": "table", "columns": [ { "label": "Event #", "path": "id" }, { "label": "Type", "path": "type" }, { "label": "Course", "path": "course" }, { "label": "Date", "path": "date", "format": "date" } ] },
    "create_transfer": { "type": "card", "title": "Transcript Released", "fields": [ { "label": "Program", "path": "program" }, { "label": "Status", "path": "status" } ] }
  },
```

- [ ] **Step 5: Verify the manifest validates** (Task 5 Step 3 loader command). Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/verticals/university/manifest.json
git commit -m "feat(university): Tier-2 chips10, securityShowcase, delegation, render"
```

---

### Task 9: PR-1 end-to-end verification + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full api-server test run**

Run: `npm run test:api-server`
Expected: PASS (no regressions across heuristic + manifest tests).

- [ ] **Step 2: Manual UI smoke (both verticals).** Start the stack (`./run.sh`), then for each vertical switch via the UI vertical switcher (or `POST /api/verticals/active` with an admin cookie, body `{"id":"government"}` / `{"id":"university"}`). Confirm:
  - Chips render with themed labels (Fees Owed / My Permits / … and Credit Standing / My Courses / …), not banking labels.
  - Hero cards populate from `heroStats` (4 cards each).
  - Agent greeting uses the persona (Liberty / Scholar).
  - Typing each chip phrase routes to the correct banking action via the heuristic (no Helix/Ollama call) — verify in the token-chain / activity panel.
  - The 5th chip (Permit Status / Enrollment Status) renders its empty state / `scopeError` (backend not wired until PR 2) — this is expected.

- [ ] **Step 3: Add a CHANGELOG entry** under `## [Unreleased]` → `### Added`:

```markdown
- Government (CivicPermit) and University (Super University) demo verticals — manifests, mock data, heuristic routing, Helix directives, and full security-showcase/delegation blocks. Feature-page backends wired separately.
```

- [ ] **Step 4: Commit + open PR 1**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): government + university verticals"
git push -u origin worktree-gov-university-verticals
gh pr create --title "feat: Government + University verticals (config)" --body "Adds CivicPermit (government) and Super University (university) verticals: manifests, mock-data, heuristic vocab, Helix directives, Tier-2 showcase/delegation/render blocks. Feature pages ship in a follow-up PR. Spec: docs/superpowers/specs/2026-06-19-government-university-verticals-design.md"
```

---

# PR 2 — Feature-page backends, fully wired (Tier 3)

> Cross-service: touches REGRESSION_PLAN-protected gateway/registry files. Read the `mcp-gateway` and `mcp-server` skills first. Build order matters: backend → gateway → registry → rebuild → PingOne bootstrap.

### Task 10: Backend feature-page records

**Files:**
- Modify: `demo_api_resource_server/server.js` (`VERTICALS` map)

**Interfaces:**
- Produces: `GET /permit` and `GET /enrollment` (X-API-Key gated) returning `{ permit: {...} }` / `{ enrollment: {...} }` whose field paths match the manifest `featurePage.fields` from Tasks 1 and 5.

- [ ] **Step 1: Add two entries to the `VERTICALS` object** in `demo_api_resource_server/server.js` (the existing `for…of Object.entries(VERTICALS)` loop auto-registers the routes):

```javascript
  permit: {
    noun: 'permit record',
    record: {
      permit: {
        permitId: 'PRM-2026-04412',
        permitType: 'Building',
        subject: '1234 Maple Street, Springfield, IL',
        jurisdiction: 'City of Springfield',
        issuedDate: '2026-02-10',
        expiresDate: '2026-12-01',
        feesOwed: 240.00,
        currency: 'USD',
        status: 'Active — inspection pending',
        inspector: 'M. Alvarez (Code Enforcement)',
      },
    },
  },
  enrollment: {
    noun: 'enrollment record',
    record: {
      enrollment: {
        studentId: 'SU-2026-88102',
        program: 'B.S. Computer Science',
        term: 'Spring 2026',
        standing: 'Good Standing',
        enrolledCredits: 11,
        creditsEarned: 78,
        gpa: '3.62',
        tuitionBalance: 1840.00,
        currency: 'USD',
        holds: 'None',
      },
    },
  },
```

- [ ] **Step 2: Verify both endpoints return data**

Run (with the service running, or `node server.js` in `demo_api_resource_server`):
```bash
curl -s -H "X-API-Key: ${API_RESOURCE_SERVER_API_KEY:-demo-mortgage-key-0000}" http://localhost:3070/permit
curl -s -H "X-API-Key: ${API_RESOURCE_SERVER_API_KEY:-demo-mortgage-key-0000}" http://localhost:3070/enrollment
```
Expected: JSON with `permit`/`enrollment` objects + `source`, `authMechanism`, `note`. (Confirm the port from the service's startup log if 3070 differs.)

- [ ] **Step 3: Commit**

```bash
git add demo_api_resource_server/server.js
git commit -m "feat(backend): permit + enrollment feature-page records"
```

---

### Task 11: Gateway + MCP registry wiring

**Files:**
- Modify: `demo_mcp_gateway/src/router.ts` (`APIKEY_TOOLS`, `APIKEY_BACKEND_ROUTES`)
- Modify: `demo_mcp_gateway/src/apiKeyDispatch.ts` (`TOOL_DISPLAY_NAMES`)
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts` (`TOOLS` map)

**Interfaces:**
- Consumes: backend routes `permit`/`enrollment` from Task 10; manifest `featureScope` (`permits:read`/`transcript:read`) from Tasks 1/5.

- [ ] **Step 1: Add to `APIKEY_TOOLS`** (the `Set`) in `demo_mcp_gateway/src/router.ts`:

```typescript
  'show_permit',         // government — CivicPermit permit record
  'show_enrollment',     // university — Super University enrollment record
```

- [ ] **Step 2: Add to `APIKEY_BACKEND_ROUTES`** (same file):

```typescript
  show_permit:        'permit',
  show_enrollment:    'enrollment',
```

- [ ] **Step 3: Add to `TOOL_DISPLAY_NAMES`** in `demo_mcp_gateway/src/apiKeyDispatch.ts`:

```typescript
  show_permit:         'Permit Status',
  show_enrollment:     'Enrollment Status',
```

- [ ] **Step 4: Add visibility-only entries to the `TOOLS` map** in `demo_mcp_server/src/tools/BankingToolRegistry.ts`. Copy the shape of the existing `show_health_record` entry, with the vertical's `featureScope` (no handler needed — the gateway intercepts):

```typescript
  show_permit: {
    name: 'show_permit',
    description: 'Show the resident\'s permit status (CivicPermit feature page).',
    requiredScope: 'permits:read',
    // ...mirror the other show_* entry fields (inputSchema, etc.)
  },
  show_enrollment: {
    name: 'show_enrollment',
    description: 'Show the student\'s enrollment status (Super University feature page).',
    requiredScope: 'transcript:read',
    // ...mirror the other show_* entry fields (inputSchema, etc.)
  },
```
> Open the existing `show_health_record` / `show_gear_order` entry in the same file and copy its exact field set — match the surrounding entries' property names rather than the abbreviated sketch above.

- [ ] **Step 5: Build both services**

Run:
```bash
cd demo_mcp_gateway && npm run build
cd ../demo_mcp_server && npm run build
```
Expected: both compile with 0 errors.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/router.ts demo_mcp_gateway/src/apiKeyDispatch.ts demo_mcp_server/src/tools/BankingToolRegistry.ts
git commit -m "feat(gateway): route show_permit + show_enrollment to API-key backend"
```

---

### Task 12: Provision scopes + end-to-end verification

**Files:** none (operational)

- [ ] **Step 1: Provision the new scopes in PingOne**

Run: `npm run pingone:bootstrap`
Expected: log shows `permits:read` and `transcript:read` created/confirmed on the resource server.

- [ ] **Step 2: Rebuild + restart the full stack** (`./run.sh`, or the docker/k8s deploy path in use). Confirm gateway + MCP server picked up the new tools.

- [ ] **Step 3: End-to-end feature-page test (both verticals).** For each: switch to the vertical, sign out and back in to consent to the new scope, click the 5th chip (Permit Status / Enrollment Status). Confirm:
  - The page renders **real backend data** (the Task 10 record fields), not the empty state.
  - The token-chain panel shows the API-key path hop (no OAuth bearer on the backend hop).
  - Negative path: with a session lacking the scope, the chip shows the manifest `scopeError`.

- [ ] **Step 4: Commit any config (e.g. .env scope wiring) + push**

```bash
git add -- <only files you changed>
git commit -m "chore: provision permits:read + transcript:read for feature pages"
git push
```

- [ ] **Step 5: Open PR 2**

```bash
gh pr create --title "feat: Government + University feature-page backends" --body "Wires show_permit + show_enrollment through demo_api_resource_server, the MCP gateway, and the MCP registry; provisions permits:read + transcript:read in PingOne. Completes the two verticals (feature pages return real data). Spec: docs/superpowers/specs/2026-06-19-government-university-verticals-design.md"
```

---

## Self-Review notes

- **Spec coverage:** Tier 1 (Tasks 1–3, 5–7), Tier 2 (Tasks 4, 8), Tier 3 fully wired (Tasks 10–12), two-PR rollout (Task 9 / Task 12) — all mapped.
- **Schema risk (spec) cleared:** `chips10`, `securityShowcase`, `delegation`, `render`, `featurePage` are all present in `schema.js` (verified lines 113–154), so Tier 2 blocks are not stripped.
- **Heuristic ordering:** "release"/"transcript-release" → transfer regexes are first in both vocab blocks, before the generic noun → accounts regex.
- **Type/anchor consistency:** backend record top-level key (`permit`/`enrollment`) == manifest `featurePage.dataKey`; `APIKEY_BACKEND_ROUTES` value == backend route == `VERTICALS` key; `requiredScope` == manifest `featureScope`.
- **Known-issue references:** jest-worktree-ignore (Task 2/6 Step 2), pre-commit CHANGELOG hook (Task 9).
```
