# Education Content Refresh — Agent Prompt

## Purpose

This prompt is for refreshing the learning/education pages in the **Super Bank AI demo app** so that RFC statuses, LLM model info, and agent framework details stay current. It also creates a new **"What's New"** page that surfaces what changed in the latest refresh so users always know what was updated.

Run this prompt inside the repo with Claude Code (or equivalent) after a period of industry movement — new RFC publications, new model releases, or new agent framework versions.

---

## Repo Context

Working directory: the root of the `Banking` monorepo.

UI code lives in `banking_api_ui/src/components/`. Education panels live in:

| File | Route / Surface | What it covers |
|------|----------------|----------------|
| `education/IETFStandardsPanel.js` | Drawer, "IETF" chip | Emerging IETF drafts: RFC7523bis, Identity Chaining, JAG-IR (ID-JAG), AIMS, WIMSE, SD-JWT VC, PQ/T JOSE |
| `education/LlmLandscapePanel.js` | Drawer, "LLM Landscape" chip | Commercial LLMs (OpenAI, Anthropic, Google, Cohere), Open-Source LLMs (Meta Llama, Mistral, Qwen, DeepSeek), How LLMs Work, Comparison |
| `education/AgentBuilderLandscapePanel.js` | Drawer, "Agent Builders" chip | Agent frameworks: LangChain, LangGraph, LlamaIndex, CrewAI, AutoGen, n8n, Flowise, plus commercial platforms |
| `education/AiPlatformLandscapePanel.js` | Drawer, "AI Platforms" chip | Cloud AI platforms: AWS Bedrock, Microsoft Azure AI, Google Vertex AI, IBM watsonx, Anthropic, OpenAI |
| `education/TokenChainEducationPanel.js` | Drawer, Token Chain panel | RFC 8693 token exchange, JWT claims, delegation chains, transaction tokens |
| `OAuthSpecsEducationPanel.jsx` | Drawer, OAuth Specs | RFC 8693, RFC 6749, RFC 7636 (PKCE), OIDC Core, OIDC CIBA, RFC 9126 (PAR), RFC 9700 (Security BCP), RFC 8707, RFC 8705 (mTLS), RFC 9449 (DPoP), Transaction Tokens draft |
| `AgenticTrustEducation.tsx` | Route `/agentic-trust` | Six pillars of agentic trust; threat table using RFC 8693, RFC 8707 |
| `MCPToolsEducation.tsx` | Route `/mcp-tools` | MCP protocol, tool schemas, RFC 9728 (MCP Authorization) |
| `ActorTokenEducation.tsx` | Route `/actor-token-education` | may_act / act JWT claims, RFC 8693 delegation |
| `education/educationContent.js` | Underlying data | RFC spec descriptions and status used by `OAuthSpecsEducationPanel` |

**After any UI edit you must run:**
```bash
cd banking_api_ui && npm run build
```
Exit code must be **0** before the task is done.

**No emojis in UI text.** This is a professional banking demo — no emojis in button labels, headings, descriptions, or status text (only symbol characters like checkmarks are acceptable where data requires them).

---

## Task 1 — Research current state (do this first, in parallel)

Before editing any file, gather fresh facts. Use web search and the IETF datatracker for each topic below. Record version numbers, publication dates, and status changes — you will embed these directly into the components.

### 1a. IETF / OAuth drafts (check each on `datatracker.ietf.org`)

- **RFC7523bis** — what is the current draft version and status? Has it advanced to RFC?
- **Identity Chaining** (`draft-ietf-oauth-identity-chaining`) — current version and status?
- **JAG-IR / ID-JAG** (`draft-ietf-oauth-identity-assertion-authz-grant`) — current version and status?
- **AIMS** (`draft-ietf-oauth-agentic-oauth`) — current version and status? Does it have a new name?
- **WIMSE** (`draft-ietf-wimse-workload-identity-use-cases`) — current version and status?
- **SD-JWT VC** (`draft-ietf-oauth-sd-jwt-vc`) — current version and status?
- **PQ/T JOSE** — what is the current draft name and status for post-quantum JOSE?
- **RFC 9728** (MCP Authorization) — is this published as RFC or still a draft? What is the current status?
- **Transaction Tokens** (`draft-ietf-oauth-transaction-tokens`) — current version and status?
- **RFC 9700** (OAuth Security BCP) — still current? Any erratum or successor?

### 1b. LLM Models

Gather the most current production models and key specs for:

- **OpenAI**: Current flagship reasoning model(s), current GPT-4-class model, current cost-efficient model. Parameter counts if known. Context window sizes.
- **Anthropic**: Current Claude 4 family — Opus, Sonnet, Haiku model IDs and release status. Any new capability flags (extended thinking, etc.)
- **Google**: Current Gemini 2.x family — Ultra/Pro/Flash/Nano status. Context window. Any Gemini 3 announcements?
- **Meta**: Current Llama 4 models — Scout, Maverick, or newer. Are Llama 3.x models still relevant?
- **Mistral**: Current Mistral Small, Medium, Large versions. Any model renamed?
- **Alibaba Qwen**: Current Qwen 3 family — flagship and coder models.
- **DeepSeek**: Current DeepSeek R2 or V3 successor status. MIT license still applies?
- **Cohere**: Current Command A / Command R+ status. Any new models?
- **Google Gemma**: Current Gemma 3 models. Any Gemma 4?

### 1c. Agent Frameworks

- **LangChain / LangGraph**: Current stable version. Any major API changes since early 2026?
- **LlamaIndex**: Current version. Any rebrand or major features?
- **CrewAI**: Current version. Production-ready status?
- **AutoGen**: Current version (Microsoft). Any name change?
- **n8n**: Current stable version. Any major AI node updates?
- **Flowise**: Current version and status.
- **New entrants**: Any new agent frameworks that have reached production use since early 2026 that belong in the landscape?

### 1d. AI Cloud Platforms

- **AWS Bedrock**: Any new foundation models added? Bedrock Agents updates?
- **Azure AI Foundry**: Any major service changes or rebrands since early 2026?
- **Google Vertex AI**: Any new Gemini integration or feature parity changes?
- **IBM watsonx**: Any major product or model updates?
- **Anthropic API**: Any new features (batch API, extended thinking GA, etc.)?
- **OpenAI Platform**: Any new API features or model availability changes?

---

## Task 2 — Update each education file

Apply only the facts gathered in Task 1 — do not speculate or invent version numbers. Update each file as described below.

### 2a. `education/IETFStandardsPanel.js`

For each draft tab (RFC7523bis, Identity Chaining, JAG-IR, AIMS, WIMSE, SD-JWT VC, PQ/T JOSE):

1. Update the draft version number mentioned in the tab content.
2. Update the maturity status string (e.g., "Working Group Draft -07" → "-09 (WGLC)").
3. If a draft became an RFC since last refresh: change its label from draft to RFC, update the IETF link from `datatracker` to the RFC publication URL, update any description that said "draft" to "published RFC".
4. If AIMS has been renamed (the working group renamed it to something else), update the tab label and all references.
5. Update the "IDC Guardrails" table rows if any standard in those rows changed status.

### 2b. `OAuthSpecsEducationPanel.jsx` and `education/educationContent.js`

1. For **Transaction Tokens**: update the draft version string. If it became an RFC, change the status badge from `draft` to `stable` and update the IETF link.
2. For **RFC 9700** (Security BCP): confirm still current; update "Last Updated" footer date.
3. For **RFC 9728** (MCP Authorization, referenced in `MCPToolsEducation.tsx` and `educationContent.js`): if it became an RFC or the draft version changed, update all references.
4. Update the `Last Updated` line at the bottom of `OAuthSpecsEducationPanel.jsx` to today's date.

### 2c. `education/LlmLandscapePanel.js`

Update each `ModelCard` or equivalent JSX block:

1. **OpenAI**: Update model names, context windows, and strengths description. If o3/o4-mini or GPT-5 is out, add it; remove or demote stale model references.
2. **Anthropic**: Confirm Claude 4 family model IDs are correct (`claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`). Update strengths description if new capabilities shipped.
3. **Google**: Update Gemini model family name and versions. Correct context window figures.
4. **Meta Llama**: Update to current Llama 4 models. Note deprecation of Llama 3.x if applicable.
5. **Mistral**: Update model names to current versions.
6. **Qwen**: Update Qwen 3 model names. Add Qwen3-Coder if not present.
7. **DeepSeek**: Update to current R2 or V3 successor. Confirm license.
8. **Cohere**: Update to current Command models.
9. Update the "How LLMs Work" section's comparison table if benchmark data changed significantly.
10. Update the caption/footer date in the panel if one exists.

### 2d. `education/AgentBuilderLandscapePanel.js`

1. Update version numbers in each framework card (LangChain, LlamaIndex, CrewAI, AutoGen, n8n, Flowise).
2. Update the comparison table ("Table reflects framework capabilities as of early 2026") — change the date to the current date.
3. If a new framework reached clear production readiness, add a `FrameworkCard` for it following the existing pattern. Do not add experimental/niche frameworks.
4. If any framework changed its license, update that field.

### 2e. `education/AiPlatformLandscapePanel.js`

1. Update each platform tab's model list and service descriptions.
2. Update the comparison table at the bottom.

### 2f. `AgenticTrustEducation.tsx`

1. Confirm the RFC references (8693, 8707) are still correct and the threat table mitigations are accurate.
2. If RFC 9728 is now published, update any draft references to it in this file.

### 2g. `MCPToolsEducation.tsx`

1. If RFC 9728 (MCP Authorization) changed status, update the reference text and link.
2. Update any MCP specification version strings (the `2025-11-25` spec version string appears in comments/links — update if a newer spec version was published).

---

## Task 3 — Create the "What's New" page

Create a new component: `banking_api_ui/src/components/education/WhatsNewPanel.js`

This page displays a structured log of what changed in the most recent education refresh. It renders inside the existing `EducationDrawer` shell (same pattern as `LlmLandscapePanel.js`).

### Data shape

Define a `REFRESH_LOG` array at the top of the file. Each entry is one change from this refresh:

```js
const REFRESH_LOG = [
  {
    date: "YYYY-MM-DD",          // today's date
    area: "LLM Landscape",       // which panel was updated
    type: "update",              // "update" | "new" | "removed" | "promoted"
    summary: "...",              // one sentence: what changed
    detail: "...",               // optional: why or what the old value was
  },
  // ...one entry per discrete change made in Tasks 2a–2g
];
```

`type` values:
- `"update"` — existing content revised (version bump, description refresh)
- `"new"` — new item added (new model, new framework, new tab)
- `"removed"` — item removed (deprecated model, obsolete draft)
- `"promoted"` — a draft became an RFC

### Component structure

```jsx
export default function WhatsNewPanel() {
  // Group REFRESH_LOG by area for display
  // Render one section per area, sorted by date desc

  return (
    <EducationDrawer
      isOpen={...}
      onClose={...}
      title="Education Content — What's New"
      tabs={[{ id: "latest", label: "Latest Refresh", content: <ChangeLog /> }]}
    />
  );
}
```

The inner `<ChangeLog />` renders:

1. A header row showing the refresh date and a count: "Updated MM/DD/YYYY — N changes across M panels."
2. For each area: a section heading (bold, with a left border accent) listing the changes as a compact list.
3. Each list item: a colored badge for the type (`UPDATE` blue, `NEW` green, `REMOVED` red, `PROMOTED` purple) + the summary text.
4. A footer: "Next review recommended: ~3 months" (static text).

Style with inline styles or a co-located `.module.css` file — no new global CSS classes.

### Wire it up

After creating `WhatsNewPanel.js`:

1. Open `education/EducationPanelsHost.js` and add `WhatsNewPanel` to the list of hosted panels.
2. Open `education/educationIds.js` and add an id for the new panel: `WHATS_NEW = "whats-new"`.
3. Open `education/educationCommands.js` and add the command that opens the new panel.
4. Open `banking_api_ui/src/components/BankingAgent.js` and add a chip for it in the `learn` action group:
   ```js
   { id: "whats-new-education", label: "What's New", desc: "Recent updates to education content", rfcs: [] }
   ```
5. In the `handleActionClick` switch (or dispatch map) in `BankingAgent.js`, add a case for `"whats-new-education"` that opens the panel using the existing `openEducationPanel` pattern.

---

## Task 4 — Verification

Run these checks before marking the task complete:

```bash
# 1. Build must pass
cd banking_api_ui && npm run build

# 2. Unit tests that touch education components
cd banking_api_ui && npx react-scripts test --watchAll=false --testPathPattern="education|Landscape|IETF|WhatsNew" 2>&1 | tail -20
```

Confirm:
- Build exits 0.
- No new test failures introduced.
- The What's New panel renders in the browser when clicking the chip (manual check if possible).
- No emojis appear in any updated text.
- Every version number or date you updated came from research, not invention.

---

## Task 5 — Commit

Stage only the files changed in this refresh (education panel files + the new `WhatsNewPanel.js`). Do not stage unrelated working-tree changes.

Commit message format:
```
feat(education): refresh content — <RFC/model highlights>

Updated: IETFStandardsPanel (draft versions), LlmLandscapePanel (models),
AgentBuilderLandscapePanel (versions), AiPlatformLandscapePanel,
OAuthSpecsEducationPanel (dates), MCPToolsEducation (RFC 9728).
Added: WhatsNewPanel with structured change log.
```

---

## Notes for the agent

- Do not guess version numbers. If a web search returns no clear answer for a specific version, leave the existing text unchanged and add a `// TODO: verify` comment on that line.
- Do not rewrite prose that is still accurate — minimal diff only.
- Do not add features, tabs, or explanations beyond what is described above.
- If a draft was renumbered (e.g., `-06` → `-08`) but the content description is still accurate, only update the version number — not the surrounding explanation.
- This is a professional banking demo. Tone should be technical and factual throughout.
