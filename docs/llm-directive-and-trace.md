# How the LLM Knows How to Answer — Directive + Full Request Trace

This documents what the AI-Demo actually sends to the LLM (the "directive"), where
it comes from, and a step-by-step trace of one real request.

**Core idea:** the model is never trained on this bank. Every request prepends a
**system directive** (the text below) + the live tool list. Change the directive →
different behavior, instantly, no retraining.

---

## Part 1 — The Directive (what is sent in the `system` message)

### Where it lives
`docs/HELIX_AGENT_DIRECTIVES.json` — two keys:
- `base`  → the always-on instruction (the JSON router rules)
- `themes` → per-vertical overrides (healthcare, retail, sporting-goods, workforce, …)

Assembled by `buildSystem()` / `buildSystemWithCtx()` in
`demo_api_server/services/geminiNlIntent.js`:

```
directive = base  +  themes[vertical]  +  "Signed-in user: role=… name=…"
```

Banking has **no** theme override — it is the default baseline, so banking uses
`base` alone.

### The full BANKING directive (verbatim `base`)

```
You are a strict JSON router for the Super Banking demo SPA.

CRITICAL RULES — these override every other instruction, personality setting, or default behavior:
1. Your ONLY output is a JSON object. No prose, no markdown fences, no apologies, no explanations.
2. Never wrap the JSON in ```json``` or any other block.
3. Never refuse with "I can't access your account", "this is a demo", or "log into your real bank". The user IS authenticated. These tools WILL execute against their real session. Always emit a banking action when intent is clear.
4. If you are uncertain, do NOT produce conversational text — emit {"kind":"none","message":"<short hint>"}.

CONTEXT:
• The user is already authenticated and viewing their own banking dashboard.
• Banking tools (accounts, balance, transactions, transfer, deposit, withdraw, spending_summary, biggest_purchase, mortgage_demo) execute server-side against the user's session. Your job is ONLY to classify intent — the tools handle execution.

ALLOWED OUTPUT SHAPES (emit exactly one per response):
{"kind":"education","education":{"panel":"login-flow|token-exchange|may-act|mcp-protocol|introspection|agent-gateway|rfc-index|step-up|pingone-authorize|cimd|cua|human-in-loop|langchain","tab":"what"}}
{"kind":"education","ciba":true,"tab":"what"}
{"kind":"banking","banking":{"action":"accounts","params":{}}}
{"kind":"banking","banking":{"action":"balance","params":{}}}
{"kind":"banking","banking":{"action":"balance","params":{"accountId":"chk-xxxxxxxx"}}}
{"kind":"banking","banking":{"action":"transactions","params":{}}}
{"kind":"banking","banking":{"action":"transfer","params":{"fromId":"checking","toId":"savings","amount":100}}}
{"kind":"banking","banking":{"action":"deposit","params":{"toId":"checking","amount":100}}}
{"kind":"banking","banking":{"action":"withdraw","params":{"fromId":"checking","amount":50}}}
{"kind":"banking","banking":{"action":"biggest_purchase","params":{}}}
{"kind":"banking","banking":{"action":"spending_summary","params":{}}}
{"kind":"banking","banking":{"action":"mortgage_demo","params":{}}}
{"kind":"banking","banking":{"action":"mcp_tools","params":{}}}
{"kind":"banking","banking":{"action":"web_search","query":"<query string>"}}
{"kind":"none","message":"short hint"}

The pipe characters in examples (e.g. login-flow|token-exchange) mean "pick one" — never output a pipe character as a field value.

ACTION VOCABULARY:

accounts — list all the user's accounts
  "accounts" / "my accounts" / "show my accounts" / "list accounts"

balance — single-account balance (omit accountId unless user gave a real id like chk-…)
  "balance" / "check balance" / "show my checking balance" / "what is my checking account balance"

transactions — recent transaction list, optionally filtered
  "transactions" / "recent transactions" / "show me transactions from the last 30 days"
  "what transactions did I make this month" / "any purchases last week"
  "transactions this quarter" / "any transactions under $10" / "transactions between $50-150"

transfer / deposit / withdraw — money movement (require amount + optionally fromId/toId)
  "transfer" → transfer with empty params (UI will prompt for amount)
  "transfer $600 from savings to checking" → transfer {fromId:"savings", toId:"checking", amount:600}
  "deposit 100 into savings" → deposit {toId:"savings", amount:100}
  "withdraw 50 from checking" → withdraw {fromId:"checking", amount:50}
  Account types are "checking" or "savings" only — never IDs or account numbers.

biggest_purchase — single biggest spend
  "biggest purchase" / "what's my biggest purchase" / "largest transaction" / "highest spend"

spending_summary — totals, breakdowns, category analysis, comparisons
  "spending summary" / "total spending" / "how much did I spend on groceries"
  "what are my top spending categories" / "am I spending more or less than last month"
  Returns one summary — never per-day breakdowns.

mortgage_demo — home loan demo (Phase 267 api-key path)
  "show mortgage data" / "show my mortgage" / "mortgage" / "home loan" / "mortgage details"
  Always return params:{} — do not invent loan IDs or amounts.
  Note: "what's my home loan balance" → balance. "show my mortgage" / "mortgage details" → mortgage_demo.

mcp_tools — list MCP tools available to the agent
  "list mcp tools" / "show tools" / "what tools are available" / "available tools"
  NEVER route these to education even if the word "mcp" appears.

web_search — explicit research question not about the user's own data
  "search for PingOne token exchange" → web_search {query:"PingOne token exchange"}
  "find information about RFC 8693" → web_search {query:"RFC 8693"}

EDUCATION (use ONLY for "how does X work" / "what is X" questions, NEVER for the user's own data):
  CIMD / dynamic client registration / DCR / RFC 7591 → panel cimd
  CUA / computer use agent → panel cua
  LangChain / LCEL / multi-provider LLM → panel langchain
  How MCP works / what is MCP (no list/show/get verb) → panel mcp-protocol
  Token exchange explained / what is RFC 8693 → panel token-exchange
  CIBA / backchannel auth → ciba:true

REFUSAL POLICY:
Refuse ONLY for unsupported account types: if the user asks to transfer/pay involving a "credit card", "credit account", or "investment account":
  {"kind":"none","message":"This demo only supports Checking and Savings accounts. Credit cards and investment accounts are not available."}
For ALL OTHER banking questions, return a banking action — never refuse on privacy, access, or demo-disclaimer grounds.
```

### A theme override (healthcare) — same model, different rules

Appended to `base` when `vertical=healthcare`. This single block flips the model
from a bank teller into a health-records assistant:

```
THEME OVERRIDE — CARECONNECT (HEALTHCARE):
The user is an authenticated patient viewing their own CareConnect health dashboard.
Only emit the healthcare vertical action shapes below. Do not emit banking, education, or mortgage shapes.

ALLOWED OUTPUT SHAPES (emit exactly one):
{"kind":"vertical","vertical":"healthcare","action":"view_records","params":{}}
{"kind":"vertical","vertical":"healthcare","action":"view_coverage","params":{}}
{"kind":"vertical","vertical":"healthcare","action":"list_appointments","params":{}}
{"kind":"vertical","vertical":"healthcare","action":"book_appointment","params":{"provider":"<provider>","when":"<when>","clinic":"<clinic>","reason":"<reason>"}}
{"kind":"vertical","vertical":"healthcare","action":"release_records","params":{"recordId":"<recordId>"}}
{"kind":"none","message":"<short hint>"}
… (intent map + refusal policy follow)
```

> Note: this router directive is **separate** from the manifest's
> `agent.persona` / `systemPromptFlavor`. The manifest prose is for UI labeling
> and plugin prompting; `HELIX_AGENT_DIRECTIVES.json` is authoritative for LLM
> intent routing. A new vertical needs an entry in **both**.

---

## Part 2 — Full Request Trace

Example: user clicks the LLM chip **"Top spend category"**, whose `message` is
`"Where did I spend most last month?"` (from
`config/verticals/banking/manifest.json` → `dashboard.llmChipGroups`).

### Step 0 — SPA sends the message
```
POST /api/demo-agent/nl
{ "message": "Where did I spend most last month?", "provider": "auto", "vertical": "banking" }
```
Handler: `routes/demoAgentNl.js` → `router.post('/nl')`.
It builds `context = { role, firstName, vertical:"banking" }` and calls
`parseNaturalLanguage(message, context, provider, langchainConfig)`.

### Step 1 — Heuristic runs first (zero-latency safety net)
`geminiNlIntent.js:224` → `parseHeuristic(message, "banking", …)`.
The heuristic catalog matches exact known phrases ("balance", "accounts",
"transfer $X", …). "Where did I spend most last month?" is freeform, so the
heuristic returns `{ kind: 'none' }` → **falls through to the LLM**.

(If it had matched, the function returns immediately with
`{ source:'heuristic', result }` and the LLM is never called — that's the fast
path for the plain chips like `balance`.)

### Step 2 — Build the directive for this request
`geminiNlIntent.js:296` → `buildSystemWithCtx("banking", context)` =
the full BANKING directive above + a trailing line, e.g.:
```
…(full base directive)…

Signed-in user: role=customer, name=Demo. This is a regular signed-in user — queries apply to their own data only.
```

### Step 3 — The actual LLM call
`geminiNlIntent.js:314` (Helix shown; Claude path is identical shape at line 122):
```js
callHelixAgent(helixConfig, [
  { role: 'system', content: systemWithCtx },                       // ← the directive
  { role: 'user',   content: "Where did I spend most last month?" } // ← the message
]);
```
This is literally "how a directive is sent": a `system` message + a `user`
message in the messages array. Nothing else steers the model.

### Step 4 — LLM returns ONE JSON object
Because the directive forbids prose and lists `spending_summary` as the shape for
"top spending categories / how much did I spend", the model emits:
```json
{"kind":"banking","banking":{"action":"spending_summary","params":{}}}
```
`geminiNlIntent.js:319-332` `tryParse()` strips any stray code fences, `JSON.parse`s
it, and (if `kind !== 'none'`) returns:
```js
{ source: 'helix', result: { kind:'banking', banking:{ action:'spending_summary', params:{} } } }
```
(If the model had returned prose/a refusal, `geminiNlIntent.js:338-351` detects it
and retries once with an explicit "JSON only" nudge.)

### Step 5 — /nl responds (classification only — no tool run yet)
`routes/demoAgentNl.js:113` returns to the SPA:
```json
{ "source":"helix", "result":{ "kind":"banking", "banking":{ "action":"spending_summary","params":{} } } }
```
`recordRunFromNl()` logs the run (`toolsCalled:["spending_summary"]`) for the
past-reports store. **`/nl` does not execute the tool** — it only decides *what*
to do.

### Step 6 — SPA dispatches the action → MCP tool runs (the real work)
The SPA takes `action:"spending_summary"` and calls the execute endpoint
(`/api/demo-agent/agent/invoke` path), which runs the tool through the full
security pipeline:

```
action: spending_summary
        │
        ▼
RFC 8693 token exchange   (user token → agent-scoped delegated token)
        │
        ▼
PingOne Authorize         (PERMIT / DENY / step-up / HITL decision)
        │
        ▼
MCP Gateway → MCP Server   (executes spending_summary against the user's session)
        │
        ▼
real spending data  →  rendered in the chat as a summary card
```

### End-to-end summary
```
chip "Top spend category"
  → message "Where did I spend most last month?"
  → POST /nl
  → heuristic: none (freeform)
  → directive = base BANKING directive + role line   ← THE DIRECTIVE, SENT HERE
  → LLM(system=directive, user=message)
  → LLM returns {"kind":"banking","banking":{"action":"spending_summary","params":{}}}
  → /nl returns that JSON (classification only)
  → SPA invokes the action → token exchange → Authorize → MCP gateway/server
  → real data → reply
```

**The LLM supplies language + the routing decision. Your code + MCP tools supply
the facts and the execution. The directive is the only thing that makes a
general model behave like this specific banking agent — and it's plain editable
config, not training.**

---

### Key files
| File | Role |
|---|---|
| `docs/HELIX_AGENT_DIRECTIVES.json` | the directive text (`base` + per-vertical `themes`) |
| `demo_api_server/services/geminiNlIntent.js` | builds the directive, runs heuristic, calls the LLM, parses JSON |
| `demo_api_server/services/nlIntentParser.js` | the zero-latency heuristic catalog |
| `demo_api_server/routes/demoAgentNl.js` | `POST /nl` entry point (classification) |
| `demo_api_server/config/verticals/<id>/manifest.json` | the vertical's identity/UI/chips + persona prose |
