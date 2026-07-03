# Gartner Machine IAM Survey — Learning Hub Content (Design)

**Date:** 2026-07-02
**Status:** Approved by user (brainstorming session)

## Goal

Surface the "Top 5 Findings From the Gartner Machine IAM Survey" (Gartner Shareable
Summary deck, 18 June 2026) in the demo's learning surfaces, mapped to how this demo
answers each finding. Three deliverables:

- **A.** A Google Doc version of the deck's content in the user's Drive
  (curtis@coachcurtis.org), linked from the in-app modal.
- **B.** An in-app **education modal** wired into the Learning Hub (`/learning`).
- **C.** A **public GitHub Pages topic page** in `curtismu7/llama-vscode-setup-guide`
  containing only our own narrative (no Gartner content).

## Licensing constraint (drives the split between B and C)

The deck's Gartner sharing guidelines permit sharing within the organization for
noncommercial use with Gartner attribution, and prohibit posting on an intranet or
public site. Therefore:

- Gartner findings, stats, and the Google Doc link appear **only** in the in-app modal
  (org-internal demo surface) with attribution.
- The public GitHub Pages page carries **zero Gartner content** — no stats, quotes,
  citations, or doc link. Our narrative only.

## Deliverable A — Google Doc

- Created via the connected Google Drive integration in curtis@coachcurtis.org's Drive.
- Title: **"Top 5 Findings From the Gartner Machine IAM Survey — Shareable Summary"**.
- Content: Insights at a Glance text (deck slides 2–4), the five figures rendered as
  text summaries (using the deck's own alt-text descriptions — chart images are not
  carried over), the "Recommended by the Authors" list, and the Gartner attribution +
  sharing-guidelines note.
- Fetch the doc's `webViewLink`; it feeds the modal's Resources tab.
- **Known limitation:** the doc is private by default. The user must flip sharing to
  "anyone in org with link" themselves for others to open it.

## Deliverable B — In-app education modal

New file `demo_api_ui/src/components/education/MachineIamSurveyPanel.js`, following
the `BestPracticesPanel` / `AgenticMaturityPanel` pattern: `EducationDrawer` + `tabs`
array, inline styles, small sub-components (stat callout card, mapping row with
✅/⚠️ status, `EduLink` cross-link buttons).

### Tabs

1. **Findings** (`findings`) — Gartner's top 5 findings with large stat callouts:
   94% report machine-identity growth; 52% driven by AI/ML adoption; 71% already
   managing AI agent identities; 53% cite fragmented ownership as top challenge;
   42% have no formal machine IAM strategy; 58% experienced compromises of AI-linked
   machine identities (business disruption 42%, financial loss 36%, reputational
   damage 32%). Figure 3 framing: 47% still govern machines with broad human IAM
   policies vs 53% tailored.
2. **How This Demo Answers** (`answers`) — per-finding mapping to demo features:
   - Registration/identity: dedicated `AI_AGENT` identities, Agent Builder.
   - Tailored IAM: RFC 8693 delegation, scope/audience narrowing, `act` chain.
   - Runtime authorization: Agent Gateway, RFC 7662 introspection, PingOne Authorize
     PERMIT/DENY/HITL, Intent Token binding.
   - Compromise prevention: Security Showcase attack demos (prompt injection, wrong
     audience, scope escalation, confused deputy, HITL replay).
   - Governance/accountability: HITL consent, AI Control Plane kill switch + audit.
   - `EduLink` cross-links to existing panels: `TOKEN_EXCHANGE`, `AGENT_GATEWAY`,
     `HUMAN_IN_LOOP`, `INTENT_AUTH_STANDARDS`.
3. **Gaps & Positioning** (`gaps`) — honest scope limits: no continuous
   discovery/inventory of unknown identities; no device/cert/CI-CD identity lifecycle
   management; org-level findings (fragmented ownership, missing strategy) are
   process problems the demo can only make the case for. Positioning line: "this is
   Gartner recommendations 4 and 5 implemented for AI agents."
4. **Resources** (`resources`) — button linking to the Google Doc (from Deliverable A),
   the deck's "Recommended by the Authors" research titles (text only), and required
   attribution: *Source: 2025 Gartner Machine Identity Management in a Hybrid,
   Automated AI World Survey* plus a note that the summary is shared under Gartner's
   usage policy (org-internal, noncommercial).

### Wiring (3 edits)

- `demo_api_ui/src/components/education/educationIds.js`: add
  `MACHINE_IAM_SURVEY: "machine-iam-survey"` with a doc comment.
- `demo_api_ui/src/components/education/EducationPanelsHost.js`: register
  `[EDU.MACHINE_IAM_SURVEY]: MachineIamSurveyPanel`.
- `demo_api_ui/src/components/LearningHub.tsx`: new card under **Special Topics**:
  label "Gartner Machine IAM Survey", description "Top 5 findings and how this demo
  answers them", icon 📊, action `openEdu(EDU.MACHINE_IAM_SURVEY, "findings")`
  (both the `LEARNING_CATEGORIES` entry and the `categoryActionMap.special` entry).

## Deliverable C — Public GitHub Pages topic page

Repo `curtismu7/llama-vscode-setup-guide` (no local clone; author locally, commit via
GitHub API to `main`, which publishes to GitHub Pages immediately).

- New `learning/machine-iam-for-agentic-ai.html`, hand-authored to match the existing
  snapshot page pattern (`assets/app.css` + `assets/snapshot.css`; breadcrumb
  `snap-top`, `snap-drawer`, `snap-title`, `snap-toc` jump list, stacked `snap-tab`
  sections, `snap-foot`). Title: **"Machine IAM for Agentic AI"**. Sections:
  1. *Why machine IAM matters* — agents/workloads/pipelines outnumber human
     identities; reusing human IAM policies for machines leaves gaps. Own framing,
     no Gartner references.
  2. *Register every agent* — dedicated `AI_AGENT` identities, Agent Builder, no
     borrowed human credentials.
  3. *Delegate, don't impersonate* — RFC 8693, `act` chain, scope/audience narrowing.
  4. *Authorize every action* — Agent Gateway, RFC 7662, PingOne Authorize
     PERMIT/DENY/HITL, Intent Token binding.
  5. *Govern and kill* — AI Control Plane revocation, HITL approvals, audit trail.
  6. *Scope & limits* — what the pattern doesn't cover (discovery/inventory,
     device/cert lifecycle).
- `learning/index.html`: add a card under ✨ Special Topics linking to the new page;
  bump the hero pill "39 topic pages" → "40 topic pages".
- User sees the page content before it is pushed (pushing publishes it live).

## Order of work

1. Google Doc (A) — link is needed by the modal.
2. In-app modal + wiring (B) — in this worktree, one branch.
3. Public page (C) — authored locally, shown to user, then pushed via GitHub API.

## Testing / verification

- No new test files: existing education panels carry no per-panel tests.
- Verification: UI smoke check (Learning Hub → card → all four tabs render, Google
  Doc link opens, cross-links open the right panels) and the existing UI test suite
  still passes.
- Public page: visual check of the rendered page and index card on GitHub Pages
  after push.

## Out of scope

- Embedding the PPTX or its chart images anywhere.
- Uploading the PPTX to Drive as Google Slides.
- Any Gartner content on the public site.
- Changes to other education panels or Learning Hub categories.
