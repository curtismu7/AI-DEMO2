# Gartner Machine IAM Learning Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Gartner Machine IAM Survey findings (mapped to this demo's features) as an in-app Learning Hub education modal, a Google Doc, and a public GitHub Pages topic page.

**Architecture:** Deliverable A creates a Google Doc via the claude.ai Google Drive connector (main session only — subagents cannot reach it reliably). Deliverable B adds one new education panel component plus three one-line wirings, following the existing `EducationDrawer` + `tabs` pattern. Deliverable C hand-authors a static HTML page matching the snapshot-page pattern in the separate `curtismu7/llama-vscode-setup-guide` repo and pushes it via the GitHub API after user review.

**Tech Stack:** React (CRA, JSX inline styles), existing `EducationDrawer` shared component, GitHub REST API via `gh`, claude.ai Google Drive MCP connector.

**Spec:** `docs/superpowers/specs/2026-07-02-gartner-machine-iam-learning-design.md`

## Global Constraints

- **Licensing split:** Gartner stats/attribution/doc link appear ONLY in the in-app modal (Deliverable B). The public page (Deliverable C) contains ZERO Gartner content — no stats, quotes, citations, or doc link.
- Required attribution string in the modal: `Source: 2025 Gartner Machine Identity Management in a Hybrid, Automated AI World Survey`.
- No new test files (existing education panels carry none). Verification = lint + existing UI suite + manual smoke.
- Work on branch `worktree-gartner-machine-iam-learning` in this worktree. Stage files explicitly (`git add <files>`), never `git add -A`; run `git branch --show-current` before each commit.
- Task 1 must run in the **main session** (Google Drive connector); Task 3's push step requires **explicit user approval first** (it publishes live).

---

### Task 1: Google Doc (Deliverable A) — MAIN SESSION ONLY

**Files:**
- None in this repo. Produces a Google Doc in curtis@coachcurtis.org's Drive.
- Modify (after creation): this plan file — record the doc URL under "Task 1 Result" below.

**Interfaces:**
- Produces: `GARTNER_DOC_URL` — the doc's `webViewLink`, consumed by Task 2's `MachineIamSurveyPanel.js`.

- [ ] **Step 1: Load the Google Drive tools**

Use ToolSearch with query `select:mcp__claude_ai_Google_Drive__create_file,mcp__claude_ai_Google_Drive__get_file_metadata`.

- [ ] **Step 2: Create the Google Doc**

Call `mcp__claude_ai_Google_Drive__create_file` with title **"Top 5 Findings From the Gartner Machine IAM Survey — Shareable Summary"** and this content (markdown → Google Doc):

```markdown
# Top 5 Findings From the Gartner Machine IAM Survey — Shareable Summary

*Internal copy for demo/education use. Shared under Gartner's usage policy (noncommercial, organization-internal, with attribution). Source: 2025 Gartner Machine Identity Management in a Hybrid, Automated AI World Survey. Gartner summary document dated 18 June 2026.*

## Insights at a Glance

The volume of machine identities is growing at an unprecedented rate, creating an increasingly vulnerable attack surface. Nearly all surveyed organizations (94%) report an increase in machine identities, primarily driven by the adoption of AI and machine learning (52%), cloud deployments (43%) and CI/CD pipeline automation (38%). Notably, 71% of organizations are already actively managing AI agent identities.

Despite this rapid expansion of machine identities — including AI-linked workloads (autonomous agents and credentials), non-AI-linked workloads, and devices — machine identity and access management (IAM) remains poorly implemented at many organizations. Fragmented ownership of machine life cycle management and identity governance is a challenge (over half of leaders (53%) cite this as their top challenge), with lack of knowledge and lack of visibility contributing as well. And notably, 42% of organizations are yet to develop a formal machine IAM strategy.

As a result, 58% of surveyed organizations have faced cybersecurity incidents involving the compromise of AI-linked machine identities, and an equal percentage have experienced breaches affecting non-AI-linked machine identities. These compromises have led to business disruption (42%), financial loss (36%), and reputational damage (32%).

Cybersecurity leaders must mitigate the risks of increasing machine identities and agentic AI in order to prevent damaging compromises. To do this, cybersecurity leaders should:

- Formalize a comprehensive machine identity and agentic AI program.
- Establish clear accountability across a distributed environment for devices and workloads.
- Ensure visibility by establishing comprehensive, continuous discovery and inventory, as well as identity registration and governance of machine identities and AI agents.
- Consider incumbent and emerging tools, including workload identity management, API security and tools that control authorizations tailored to the authorization needs of machine identities.

## The Five Figures (text summaries; charts not reproduced)

**Figure 1 — Factors Driving Growth of Machine Identities:** Adoption of AI and machine learning, cloud-native technologies, CI/CD automation, digital transformation, and autonomous agents are the leading drivers of machine identity growth.

**Figure 2 — Impact of Machine Identity Compromises:** More than half of organizations faced at least one cybersecurity incident involving compromised machine identities, with 58% affected for both AI-linked and non-AI workloads.

**Figure 3 — Machine IAM Programs Lack Maturity:** 47% of organizations manage machine identities with broad IAM policies covering both humans and machines; 53% use IAM policies tailored to machines.

**Figure 4 — Top Challenges for Managing Machine Identities:** Fragmented ownership of machine identity lifecycle management is the most common challenge, followed by lack of cybersecurity knowledge, limited visibility, and insufficient resources.

**Figure 5 — Machine Identities Currently Being Managed:** Devices (88%), cloud-native accounts (81%), AI agents and service accounts (71% each), CI/CD pipelines (62%), third parties (52%), and RPA bots (45%).

## Recommended by the Authors (Gartner membership required)

- Leaders' Guide to Modern Machine IAM
- Strategic Roadmap for Modern Machine IAM
- Quick Answer: What Is the Difference Between Machine IAM and Nonhuman Identity?
- Innovation Insight: Improve Security With Machine Identity and Access Management
- Cybersecurity Trend: IAM Adapts to Secure and Enable AI Agents

---

*© Gartner, Inc. and/or its affiliates. This summary is attributed to Gartner and shared for internal, noncommercial use under Gartner's sharing guidelines. It may not be posted publicly or resold.*
```

- [ ] **Step 3: Fetch the `webViewLink`**

Call `mcp__claude_ai_Google_Drive__get_file_metadata` with the returned file id. Record the `webViewLink`.

- [ ] **Step 4: Record the result**

Edit this plan file: fill in the "Task 1 Result" line below, then commit:

```bash
git add docs/superpowers/plans/2026-07-02-gartner-machine-iam-learning.md
git commit -m "docs: record Gartner Google Doc link for learning modal"
```

**Task 1 Result:** `GARTNER_DOC_URL = https://docs.google.com/document/d/1gNl6VIUUahSrOZHizf3cH6TwlaJb_5zxW8y1NxrAdEc/edit`

**Fallback:** if the Drive connector fails, ask the user to create the doc manually from the markdown above and paste the link; do not block Tasks 2–3 on it (use the link when available, leave the Resources button pointing at the value recorded here).

---

### Task 2: Education modal + Learning Hub wiring (Deliverable B)

**Files:**
- Create: `demo_api_ui/src/components/education/MachineIamSurveyPanel.js`
- Modify: `demo_api_ui/src/components/education/educationIds.js` (add one key)
- Modify: `demo_api_ui/src/components/education/EducationPanelsHost.js` (import + registry entry)
- Modify: `demo_api_ui/src/components/LearningHub.tsx` (Special Topics card + action map entry)

**Interfaces:**
- Consumes: `GARTNER_DOC_URL` from Task 1 Result; `EducationDrawer({ isOpen, onClose, title, tabs, initialTabId })` where `tabs = [{ id, label, content: <JSX> }]`; `useEducationUI().open(panelId, tabId)`; `EDU` id map.
- Produces: `EDU.MACHINE_IAM_SURVEY = "machine-iam-survey"`; `MachineIamSurveyPanel({ isOpen, onClose, initialTabId })` default export; tab ids `findings | answers | gaps | resources`.

- [ ] **Step 1: Add the education id**

In `educationIds.js`, inside the `EDU` object (after the last entry, keep trailing comma style):

```js
  /** Gartner Machine IAM Survey — top 5 findings and how this demo answers them */
  MACHINE_IAM_SURVEY: "machine-iam-survey",
```

- [ ] **Step 2: Create the panel component**

Create `demo_api_ui/src/components/education/MachineIamSurveyPanel.js`:

```jsx
// demo_api_ui/src/components/education/MachineIamSurveyPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';

// webViewLink of the Google Doc created for this panel (see design spec).
const GARTNER_DOC_URL = '<GARTNER_DOC_URL from Task 1 Result>';

const ATTRIBUTION =
  'Source: 2025 Gartner Machine Identity Management in a Hybrid, Automated AI World Survey';

// ─── Shared sub-components ───────────────────────────────────────────────────

/** Big stat + caption, used on the Findings tab. */
function Stat({ value, label, colour = 'var(--brand-navy, #1e3a8a)' }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderTop: `4px solid ${colour}`,
      borderRadius: 10, padding: '12px 14px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.7rem', fontWeight: 800, color: colour }}>{value}</div>
      <div style={{ fontSize: '0.74rem', color: '#374151', lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

/** Numbered finding card. */
function Finding({ n, title, children }) {
  return (
    <div style={{
      background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.18)',
      borderRadius: 10, padding: '12px 16px', marginBottom: 12,
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.92rem' }}>
        <span style={{
          display: 'inline-flex', width: 22, height: 22, borderRadius: '50%',
          background: 'var(--brand-navy, #1e3a8a)', color: '#fff', alignItems: 'center',
          justifyContent: 'center', fontSize: '0.75rem', marginRight: 8,
        }}>{n}</span>
        {title}
      </p>
      <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

/** Finding → demo feature mapping row. */
function MapRow({ finding, answer, links }) {
  const { open } = useEducationUI();
  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', marginBottom: 12,
      background: '#fff',
    }}>
      <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.88rem' }}>{finding}</p>
      <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.6 }}>✅ {answer}</div>
      {links && (
        <div style={{ marginTop: 8 }}>
          {links.map(([label, panelId, tabId]) => (
            <button
              key={label}
              type="button"
              onClick={() => open(panelId, tabId)}
              style={{
                background: 'none', border: '1px solid #6366f1', borderRadius: 6,
                color: '#4f46e5', padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600,
                cursor: 'pointer', marginRight: 6, marginTop: 4, display: 'inline-block',
              }}
            >
              {label} ↗
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab bodies ──────────────────────────────────────────────────────────────

function FindingsTab() {
  return (
    <>
      <p>
        Gartner's Machine IAM survey looked at how organizations manage the identities of
        machines — AI agents, workloads, service accounts, pipelines, and devices. Five
        findings stand out; the <strong>How This Demo Answers</strong> tab maps each one to
        the controls implemented in this demo.
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))',
        gap: 10, margin: '14px 0 18px',
      }}>
        <Stat value="94%" label="report machine-identity growth" />
        <Stat value="52%" label="say AI/ML adoption drives it" colour="#7c3aed" />
        <Stat value="71%" label="already manage AI agent identities" colour="#0369a1" />
        <Stat value="42%" label="have no formal machine IAM strategy" colour="#b45309" />
        <Stat value="58%" label="had AI-linked identity compromises" colour="#9f1239" />
      </div>

      <Finding n={1} title="Machine identities are exploding">
        94% of organizations report growth, driven by AI/ML adoption (52%), cloud
        deployments (43%) and CI/CD automation (38%). 71% are already actively managing
        AI agent identities.
      </Finding>
      <Finding n={2} title="Machine IAM is poorly implemented">
        Fragmented ownership of machine lifecycle management is the top challenge (53%),
        with lack of knowledge and visibility close behind. 42% have no formal machine IAM
        strategy, and 47% still govern machines with the same broad IAM policies they use
        for humans (vs 53% with machine-tailored policies).
      </Finding>
      <Finding n={3} title="Compromises are common and costly">
        58% experienced incidents involving compromised AI-linked machine identities — and
        an equal share for non-AI machine identities — causing business disruption (42%),
        financial loss (36%) and reputational damage (32%).
      </Finding>
      <Finding n={4} title="Formalize, assign accountability, ensure visibility">
        Gartner recommends a comprehensive machine identity + agentic AI program, clear
        accountability across the distributed environment, and continuous discovery,
        inventory, registration and governance of machine identities and AI agents.
      </Finding>
      <Finding n={5} title="Adopt machine-tailored tooling">
        Consider workload identity management, API security, and authorization tools
        tailored to the needs of machine identities — not human IAM reused for machines.
      </Finding>

      <p style={{ fontSize: '0.78rem', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
        {ATTRIBUTION}
      </p>
    </>
  );
}

function AnswersTab() {
  return (
    <>
      <p>
        This demo is, in effect, Gartner recommendations 4 and 5 implemented for AI
        agents: registration, tailored authorization, delegation, and kill-switch
        governance — demonstrated live.
      </p>
      <MapRow
        finding="Finding 1–2 · Register agents with first-class identities"
        answer={
          <>Every agent gets a dedicated <code>AI_AGENT</code> identity in PingOne — no
          borrowed human credentials. The Agent Builder page makes identity registration
          the mandatory first step of creating an agent, with per-agent resource servers
          and ownership-guarded scope grants.</>
        }
        links={[["Agent Gateway", EDU.AGENT_GATEWAY, "overview"]]}
      />
      <MapRow
        finding="Finding 2 · Machine-tailored IAM, not reused human policies"
        answer={
          <>RFC 8693 token exchange issues each agent short-lived, delegated tokens with
          narrowed scope and audience and an <code>act</code> chain back to the human
          principal — the &quot;tailored policies&quot; side of Gartner's Figure 3.</>
        }
        links={[["Token Exchange (RFC 8693)", EDU.TOKEN_EXCHANGE, "why"]]}
      />
      <MapRow
        finding="Finding 3 · Prevent AI-linked identity compromise"
        answer={
          <>The Agent Gateway enforces RFC 7662 introspection plus a PingOne Authorize
          decision (PERMIT / DENY / HITL) before every tool call, and Intent Token binding
          denies calls whose action doesn't match the agent's stated intent. The Security
          Showcase demonstrates six live attacks — prompt injection, indirect injection,
          wrong audience, scope escalation, confused deputy, HITL replay — each stopped by
          a named control.</>
        }
        links={[
          ["Intent Auth Standards", EDU.INTENT_AUTH_STANDARDS, "rfc-foundations"],
          ["PingOne Authorize", EDU.PINGONE_AUTHORIZE, "what"],
        ]}
      />
      <MapRow
        finding="Finding 4 · Accountability and governance"
        answer={
          <>Human-in-the-loop consent puts a human decision on high-risk actions. The AI
          Control Plane gives one kill switch that revokes an agent's PingOne identity
          everywhere at once, with an audit trail and exportable compliance report.</>
        }
        links={[["Human-in-the-loop", EDU.HUMAN_IN_LOOP, "what"]]}
      />
      <MapRow
        finding="Finding 5 · Machine-tailored tooling"
        answer={
          <>Workload identity (agent OAuth clients), API/MCP security (gateway-fronted
          tool calls), and authorization tailored to machines (per-tool scopes, intent
          binding, policy decisions) are the demo's core building blocks.</>
        }
        links={[["Token Chain", EDU.TOKEN_CHAIN, "overview"]]}
      />
    </>
  );
}

function GapsTab() {
  return (
    <>
      <p>
        Honest scoping — the survey covers the whole machine-identity estate; this demo
        deliberately covers the agentic-AI slice of it.
      </p>
      <ul style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: '0.86rem', color: '#374151' }}>
        <li>
          <strong>No continuous discovery/inventory.</strong> The demo governs agents that
          enroll through it; it is not a discovery tool for shadow identities, secrets
          sprawl, or unmanaged workloads (Gartner's recommendation 3 needs adjacent
          tooling).
        </li>
        <li>
          <strong>No device / certificate / CI-CD identity lifecycle.</strong> Devices are
          88% of what organizations manage today; certificates and pipeline identities are
          out of this demo's scope.
        </li>
        <li>
          <strong>Organizational findings are process problems.</strong> Fragmented
          ownership (the #1 challenge) and missing strategy can't be fixed by software —
          but this demo is a strong artifact for making the case for a formal program.
        </li>
      </ul>
      <p style={{ fontSize: '0.86rem' }}>
        <strong>Positioning line for demos:</strong> &quot;This is what Gartner's
        recommendations 4 and 5 look like implemented for AI agents.&quot;
      </p>
    </>
  );
}

function ResourcesTab() {
  return (
    <>
      <p>
        Full shareable summary of the survey (internal use, Gartner attribution applies):
      </p>
      <a
        href={GARTNER_DOC_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block', background: '#1e3a8a', color: '#fff', borderRadius: 8,
          padding: '8px 16px', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none',
          marginBottom: 16,
        }}
      >
        📄 Open the survey summary (Google Doc) ↗
      </a>
      <h4 style={{ margin: '10px 0 6px' }}>Recommended by the authors (Gartner membership required)</h4>
      <ul style={{ paddingLeft: 20, lineHeight: 1.7, fontSize: '0.84rem', color: '#374151' }}>
        <li>Leaders' Guide to Modern Machine IAM</li>
        <li>Strategic Roadmap for Modern Machine IAM</li>
        <li>Quick Answer: What Is the Difference Between Machine IAM and Nonhuman Identity?</li>
        <li>Innovation Insight: Improve Security With Machine Identity and Access Management</li>
        <li>Cybersecurity Trend: IAM Adapts to Secure and Enable AI Agents</li>
      </ul>
      <p style={{ fontSize: '0.78rem', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
        {ATTRIBUTION}. Shared under Gartner's usage policy — organization-internal,
        noncommercial, with attribution; not for public posting or resale.
      </p>
    </>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

const tabs = [
  { id: 'findings', label: 'Findings', content: <FindingsTab /> },
  { id: 'answers', label: 'How This Demo Answers', content: <AnswersTab /> },
  { id: 'gaps', label: 'Gaps & Positioning', content: <GapsTab /> },
  { id: 'resources', label: 'Resources', content: <ResourcesTab /> },
];

export default function MachineIamSurveyPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Gartner Machine IAM Survey"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
```

Replace `<GARTNER_DOC_URL from Task 1 Result>` with the actual URL recorded in Task 1. If Task 1 hasn't produced it yet, use the value once available before the PR.

- [ ] **Step 3: Register the panel in EducationPanelsHost**

In `EducationPanelsHost.js`: add the import next to the other panel imports, and the registry entry next to `[EDU.BEST_PRACTICES]: BestPracticesPanel,`:

```js
import MachineIamSurveyPanel from './MachineIamSurveyPanel';
```

```js
  [EDU.MACHINE_IAM_SURVEY]: MachineIamSurveyPanel,
```

(Match the exact registry object shape used in the file — check how `BestPracticesPanel` is registered and mirror it.)

- [ ] **Step 4: Add the Learning Hub card**

In `LearningHub.tsx`, two edits:

(a) In `LEARNING_CATEGORIES`, `special` category `items` array, after the "OWASP Agentic" item:

```ts
      {
        label: "Gartner Machine IAM Survey",
        description: "Top 5 findings and how this demo answers them",
        icon: "📊",
        action: () => {},
      },
```

(b) In `categoryActionMap.special`, after the `"OWASP Agentic"` entry:

```ts
      "Gartner Machine IAM Survey": () =>
        openEdu(EDU.MACHINE_IAM_SURVEY, "findings"),
```

- [ ] **Step 5: Lint + run UI suite for touched areas**

```bash
cd demo_api_ui
npx eslint src/components/education/MachineIamSurveyPanel.js src/components/education/EducationPanelsHost.js src/components/LearningHub.tsx
CI=true npx jest --watchAll=false --testPathPattern='LearningHub|education' 2>&1 | tail -5
```

Expected: eslint clean; jest passes (or reports "No tests found" for the pattern — both acceptable per spec).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print worktree-gartner-machine-iam-learning
git add demo_api_ui/src/components/education/MachineIamSurveyPanel.js \
        demo_api_ui/src/components/education/educationIds.js \
        demo_api_ui/src/components/education/EducationPanelsHost.js \
        demo_api_ui/src/components/LearningHub.tsx
git commit -m "feat: add Gartner Machine IAM Survey education panel to Learning Hub"
```

---

### Task 3: Public GitHub Pages topic page (Deliverable C)

**Files:**
- Create (in scratchpad, pushed to the `curtismu7/llama-vscode-setup-guide` repo, NOT this repo): `learning/machine-iam-for-agentic-ai.html`
- Modify (same external repo): `learning/index.html` (one card + pill text)

**Interfaces:**
- Consumes: existing `assets/app.css` + `assets/snapshot.css` classes (`snap-top`, `snap-drawer`, `snap-title`, `snap-toc`, `snap-tab`, `snap-tab-h`, `edu-drawer`, `edu-drawer-body`, `edu-code`, `snap-foot`).
- Produces: live page at `https://curtismu7.github.io/llama-vscode-setup-guide/learning/machine-iam-for-agentic-ai.html`.

**REMINDER: zero Gartner content on this page. No stats, no survey references, no doc link.**

- [ ] **Step 1: Author the page**

Write to the scratchpad as `machine-iam-for-agentic-ai.html`:

```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Machine IAM for Agentic AI — AI Demo Learning Hub</title>
<link rel="stylesheet" href="assets/app.css">
<link rel="stylesheet" href="assets/snapshot.css">
</head><body>
<div class="snap-top"><a href="index.html">← Learning Hub</a><span class="crumb">/ Machine IAM for Agentic AI</span></div>
<div class="edu-drawer snap-drawer">
<div class="snap-title">Machine IAM for Agentic AI</div>
<nav class="snap-toc"><span class="snap-toc-label">On this page — 6 sections</span><ul><li><a href="#sec-why">Why machine IAM matters</a></li><li><a href="#sec-register">Register every agent</a></li><li><a href="#sec-delegate">Delegate, don't impersonate</a></li><li><a href="#sec-authorize">Authorize every action</a></li><li><a href="#sec-govern">Govern and kill</a></li><li><a href="#sec-scope">Scope &amp; limits</a></li></ul></nav>
<div class="edu-drawer-body">

<section class="snap-tab" id="sec-why"><h3 class="snap-tab-h">Why machine IAM matters</h3>
<p>AI agents, workloads, service accounts, and CI/CD pipelines now outnumber human identities in most environments — and agentic AI is accelerating that curve. Each one holds credentials, calls APIs, and acts with real authority. Yet many organizations still govern machines with IAM policies designed for humans: long-lived credentials, broad scopes, no per-action authorization, and no way to answer &quot;which agent did this, on whose behalf?&quot;</p>
<p>Machines are not humans. They don't respond to MFA prompts, they scale to thousands of instances, and a leaked machine credential is exploitable at machine speed. Machine IAM means giving every non-human actor a first-class identity, credentials scoped to a single task, authorization checked at every action, and a lifecycle that can be killed instantly. This page shows how the AI Demo implements that pattern for AI agents with PingOne.</p></section>

<section class="snap-tab" id="sec-register"><h3 class="snap-tab-h">Register every agent</h3>
<p>The foundation is identity: every agent is a registered <code>AI_AGENT</code> identity in PingOne with its own <code>client_id</code> — never a borrowed human credential, never a shared API key. Registration is the mandatory first step of creating an agent: the demo's Agent Builder provisions the agent identity, per-agent resource servers, and custom scopes with ownership-guarded grants, so an agent exists in the identity system before it can do anything at all.</p>
<p>Because the agent has its own identity, every downstream log line, token, and policy decision can name it. Attribution stops being forensics and becomes a claim in the token.</p></section>

<section class="snap-tab" id="sec-delegate"><h3 class="snap-tab-h">Delegate, don't impersonate</h3>
<p>When an agent acts for a user, it must not simply carry the user's token — that's impersonation, and it erases the actor from the audit trail. Instead the demo uses OAuth 2.0 Token Exchange (RFC 8693): the user's token and the agent's own credentials are exchanged for a new, short-lived token whose <code>sub</code> is still the human principal and whose <code>act</code> claim names the agent.</p>
<pre class="edu-code">// Delegated token after RFC 8693 exchange
{
  "sub":   "user-abc123",                  // on whose behalf
  "act":   { "client_id": "demo-agent" },  // who is acting
  "aud":   "https://mcp.example.com",      // narrowed audience
  "scope": "accounts:read"                 // narrowed scope
}</pre>
<p>Audience and scope are narrowed to exactly what the current tool call needs, so a stolen token is useful for one thing, briefly, and nothing else.</p></section>

<section class="snap-tab" id="sec-authorize"><h3 class="snap-tab-h">Authorize every action</h3>
<p>Identity alone isn't control. Every agent tool call in the demo passes through an Agent Gateway that validates the token by introspection (RFC 7662) and asks PingOne Authorize for a policy decision — <strong>PERMIT</strong>, <strong>DENY</strong>, or <strong>HITL</strong> (require a human) — before the call reaches any backend.</p>
<p>On top of that, each call carries an Intent Token: a signed statement of what the agent believes it is doing (<code>intent</code>, <code>confidence</code>, <code>permitted_tools</code>). If the tool being invoked doesn't match the stated intent — say, the agent claimed &quot;view balance&quot; and then called &quot;create transfer&quot; — the gateway denies the call with an <code>intent_mismatch</code>. This closes the gap between what an LLM says it will do and what its code actually does, and it defeats classic confused-deputy and scope-escalation moves.</p></section>

<section class="snap-tab" id="sec-govern"><h3 class="snap-tab-h">Govern and kill</h3>
<p>High-impact actions require a human in the loop: the agent is blocked until a person explicitly approves the specific action, and the approval is logged with the user, agent, tool, and correlation ID. Day to day, an AI Control Plane shows every registered agent and its activity.</p>
<p>The critical property is the kill switch: stopping an agent revokes its PingOne identity, so its access dies everywhere at once — every gateway, every API, every MCP server — rather than requiring a hunt for scattered credentials. The revocation is audited and broadcast, and a compliance report of agent activity can be exported for review.</p></section>

<section class="snap-tab" id="sec-scope"><h3 class="snap-tab-h">Scope &amp; limits</h3>
<p>This pattern covers the agentic-AI slice of machine IAM: agents you register, tokens you mint, calls you gate. It deliberately does not cover:</p>
<ul>
<li><strong>Discovery and inventory</strong> of machine identities you don't know about — shadow agents, sprawled secrets, unmanaged workloads need dedicated discovery tooling.</li>
<li><strong>Device and certificate lifecycle</strong> — TLS certs, device identities, and CI/CD pipeline credentials are adjacent disciplines with their own tooling.</li>
<li><strong>Organizational ownership</strong> — deciding who owns machine identity lifecycle is a process problem; the technology here is the argument for solving it, not the solution.</li>
</ul>
<p>Explore the related topics on the <a href="index.html">Learning Hub</a> — Token Exchange (RFC 8693), Agent Gateway, Human-in-the-loop, and Intent Auth Standards — for deeper dives into each control.</p></section>

</div></div>
<div class="snap-foot">Snapshot of the AI Demo Learning Hub · all sections of this topic on one page · <a href="index.html">back to index</a></div>
</body></html>
```

- [ ] **Step 2: Prepare the index.html edit**

Download the current `learning/index.html` from the repo (fresh copy — it may have changed):

```bash
gh api repos/curtismu7/llama-vscode-setup-guide/contents/learning/index.html --jq .content | base64 -d > index.html
```

Two edits:
1. Pill: `39 topic pages` → `40 topic pages` (in the `lx-pill` div).
2. In the ✨ Special Topics `lx-grid`, immediately after the AuthZEN card (`<a class="lx-card" href="authzen.html">…</a>`), insert:

```html
<a class="lx-card" href="machine-iam-for-agentic-ai.html"><div class="lx-t">Machine IAM for Agentic AI</div><div class="lx-b">6 sections →</div></a>
```

- [ ] **Step 3: USER CHECKPOINT — show before publishing**

STOP. Present the authored page (and the index diff) to the user and get explicit approval — pushing publishes live on GitHub Pages. Do not proceed without it. (If executing via subagents, this step returns to the main session.)

- [ ] **Step 4: Push both files via the GitHub API**

```bash
# new page (no sha needed — file doesn't exist yet)
gh api -X PUT repos/curtismu7/llama-vscode-setup-guide/contents/learning/machine-iam-for-agentic-ai.html \
  -f message="feat: add Machine IAM for Agentic AI topic page" \
  -f content="$(base64 -i machine-iam-for-agentic-ai.html)"

# index update (needs current sha)
SHA=$(gh api repos/curtismu7/llama-vscode-setup-guide/contents/learning/index.html --jq .sha)
gh api -X PUT repos/curtismu7/llama-vscode-setup-guide/contents/learning/index.html \
  -f message="feat: add Machine IAM for Agentic AI card to learning index" \
  -f content="$(base64 -i index.html)" \
  -f sha="$SHA"
```

Expected: each call returns JSON with a `commit.sha`.

- [ ] **Step 5: Verify live**

Wait ~1–2 minutes for Pages to deploy, then fetch:

```bash
curl -s https://curtismu7.github.io/llama-vscode-setup-guide/learning/machine-iam-for-agentic-ai.html | grep -c snap-tab
curl -s https://curtismu7.github.io/llama-vscode-setup-guide/learning/ | grep -c "machine-iam-for-agentic-ai"
```

Expected: first ≥ 6, second ≥ 1. Also confirm the page contains no occurrence of "Gartner": `curl -s <page url> | grep -ci gartner` → `0`.

---

### Task 4: Final verification + handoff

**Files:** none new.

- [ ] **Step 1: Smoke-check the modal in the app**

The running Docker stack serves the MAIN checkout, not this worktree — the modal won't be live until the branch lands. Two options: (a) run the worktree UI locally (`cd demo_api_ui && npm start` with the BFF from the main stack), or (b) defer the live check to post-merge. Either way, verify: Learning Hub shows the "Gartner Machine IAM Survey" card under Special Topics; all four tabs render; the Google Doc button opens the doc; the cross-link buttons open the Token Exchange / Agent Gateway / HITL / Intent Auth Standards / PingOne Authorize / Token Chain panels.

- [ ] **Step 2: Confirm working tree is clean and commits are scoped**

```bash
git status --short   # expect: empty (or only untracked scratch files)
git log --oneline main..HEAD
```

Expected commits: the spec, the plan + doc-link record, and the feat commit from Task 2.

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch to decide merge/PR. Default: open a PR to `main` titled "feat: Gartner Machine IAM Survey learning content (modal + public page)".
