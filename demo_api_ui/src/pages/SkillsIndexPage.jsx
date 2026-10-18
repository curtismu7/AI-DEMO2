import { useMemo, useState } from "react";
import PageHeader from "../components/common/PageHeader";
import "./SkillsIndexPage.css";

// The Claude Code skills catalog (claudSkills/skills-confluence-page.html),
// as an in-app Learning Hub page. Grouped by install path: plugins, manual
// bundle, the official Ping plugin, and the AI-DEMO2 repo's project skills.
// Counts are computed from the data below.
const GITHUB_SKILLS =
  "https://github.com/curtismu7/CDN/tree/96542ce632abfdffde215143183f77b1ab5fa908/claude-skills";

const PLUGIN_SKILLS = [
  ["verification-before-completion", "superpowers", "Enforces evidence before success claims — requires running verification commands and confirming output before marking any work complete or creating a PR."],
  ["brainstorming", "superpowers", "Structured ideation before implementation. Explores options, constraints, tradeoffs, and success criteria before choosing an approach."],
  ["test-driven-development", "superpowers", "Guides red-green-refactor workflow: write failing tests first, implement the smallest fix, and refactor only after tests pass."],
  ["systematic-debugging", "superpowers", "Systematic debugging workflow for reproducing issues, forming hypotheses, adding diagnostics, isolating root causes, and verifying fixes."],
  ["writing-plans / executing-plans", "superpowers", "Turns a spec into a phased implementation plan, then executes it — inline or via subagents. The same plugin also covers git worktrees, parallel-agent dispatch, and code-review handoffs."],
  ["skill-creator", "skill-creator", "Create new skills from scratch, improve existing ones, run evals to test trigger accuracy, and benchmark skill performance."],
  ["code-review", "code-review", "Reviews the current diff or a PR for correctness bugs, plus reuse/simplification/efficiency cleanups, at a chosen effort level."],
  ["code-simplifier", "code-simplifier", "Refines recently modified code for clarity, consistency, and maintainability while preserving functionality."],
  ["commit-commands", "commit-commands", "Slash commands for creating commits, commit-push-PR, and cleaning gone branches — with consistent message conventions."],
  ["mgrep", "mgrep", "Semantic code/search replacement for Grep/Glob/WebSearch — meaning-based matching instead of keyword matching."],
  ["playwright", "playwright", "Drives a real browser: navigate, click, fill forms, screenshot, read console/network — for testing web apps end to end."],
  ["context7", "context7", "Pulls up-to-date library documentation into context so code suggestions use current API versions instead of training-data guesses."],
];

const PLUGIN_ALSO = "ponytail (minimal-diff coding discipline), ralph-loop (long-running autonomous loops), watch (video), obsidian (vault integration), ui-ux-pro-max (design systems, branding, slide styling), tdd-guard (enforces TDD during edits)";

const MANUAL_SKILLS = [
  ["impeccable", "Bundle", "Design, redesign, audit, or polish any frontend interface. UX review, visual hierarchy, accessibility, typography, color, motion, micro-interactions, and design systems — with real working code."],
  ["frontend-design", "Manual", "Create distinctive, production-grade frontend interfaces; avoids generic AI aesthetics when building pages and components."],
  ["graphify", "Bundle", "Turn any codebase, docs, papers, or media into a persistent knowledge graph with community detection, god nodes, and query/path/explain tools. Best entry point for architecture questions."],
  ["mcp-builder", "Bundle", "Build high-quality MCP (Model Context Protocol) servers — FastMCP (Python) and MCP SDK (TypeScript), tool design, error handling, integration patterns."],
  ["static-analysis", "Bundle (security/)", "Semgrep, CodeQL, and SARIF-parsing skills (plus scanner subagents) for running and interpreting static security analysis."],
  ["agent-sandbox", "Manual", "Operate E2B sandboxes from the CLI — run untrusted code, test packages, and inspect binaries in isolation."],
  ["notebooklm", "Manual", "Full programmatic API for Google NotebookLM — create notebooks, add sources, generate artifacts (including podcast-style outputs) beyond the web UI."],
  ["supermemory", "Manual", "Add persistent memory, user profiles, and semantic search to apps you build — the Supermemory API/SDK integration guide."],
  ["webapp-testing", "Bundle", "Playwright-based toolkit for testing local web applications — UI verification, screenshots, browser log inspection, DOM interaction."],
  ["theme-factory", "Bundle", "Apply professional font/color themes to any artifact — slides, docs, reports, HTML pages. 10 preset themes plus on-the-fly generation."],
  ["docx", "Bundle", "Create, read, and edit Word documents — formatting, tables, images, tracked changes."],
  ["xlsx", "Bundle", "Create, read, and edit spreadsheets — formulas, charts, data cleaning."],
  ["pptx", "Bundle", "Create, read, and edit PowerPoint decks — slides, templates, speaker notes."],
  ["pdf", "Bundle", "PDF processing — extract text/tables, merge/split, rotate, watermark, OCR, fill forms."],
];

const MANUAL_RETIRED = "the June bundle's tighten-prompt, cheapest-model, agent-tool, and supergoal skills (superseded by plugin equivalents and Claude Code's built-in Agent tooling)";

const PING_PLUGIN_SKILLS = [
  ["ping-foundation", "Orientation and routing — \"where do I start\", which Ping product fits, migration guidance. Use before the other Ping skills when the platform is unknown."],
  ["ping-quickstart", "Set up, configure, and administer any Ping platform — PingOne, Advanced Identity Cloud, PingAM/PingFederate/PingAccess/PingDirectory/PingID. Tenant setup, app registration, worker apps, M2M service accounts."],
  ["ping-identity-for-ai", "AI agents + identity: agent machine identity, client credentials for agents, Verified Trust, PingGateway as MCP gateway, CIBA human-in-the-loop approvals, bot detection with PingOne Protect."],
  ["ping-app-integration", "App/SDK integration — Android/iOS/JavaScript SDKs, OIDC + PKCE flows, token management, ForgeRock SDK migration, redirect/CORS/refresh troubleshooting."],
  ["ping-orchestration", "Design authentication flows and orchestration — DaVinci flows, AIC journeys, PingAM trees, MFA/step-up/passwordless, social login."],
  ["ping-universal-services", "Shared services at policy level — PingOne Protect (risk), Verify (KYC), MFA, Credentials (verifiable credentials), IGA, Authorize, Privilege."],
];

const PING_BUNDLE_SKILLS = [
  ["oauth-pingone", "Authoritative PingOne OAuth 2.0 / OIDC guide for all grant types — Authorization Code + PKCE, Client Credentials, CIBA, Token Exchange, Device Authorization, refresh, revocation, introspection, PAR, act/may_act claims, DaVinci, error codes."],
  ["ciba", "CIBA (Client-Initiated Backchannel Authentication) — auth_req_id polling, binding_message, login_hint, acr_values for DaVinci, CIBA-gated step-up flows."],
  ["pingone-mfa", "MFA device lifecycle — create, list, activate, order, delete, rename devices. SMS, Email, TOTP, FIDO2/passkey, WebAuthn, WhatsApp, mobile-push, OTP activation, device-authentication-policies API."],
  ["pingone-recognize", "Recognize biometric face authentication — WebSDK integration, face enrollment, face authentication, enroll-from-image, unenroll, OTP fallback chain, REST endpoints, config."],
  ["pingone-api-calls", "Patterns for calling the PingOne Management API — user CRUD, attribute updates, worker tokens, endpoint structure, error handling, common service patterns."],
  ["pingone-session-termination", "Terminate active PingOne SSO sessions via Management API — logout flows that must kill PingOne sessions (not just revoke tokens), and when NOT to use this vs token revocation."],
  ["pingone-mcp", "Read/update PingOne resources through the hosted PingOne MCP server — apps, populations, users, DaVinci flows, env config. Covers connecting Claude Code/Cursor/VS Code, the MCP-first vs Management-API fallback rule, and interactive-OAuth vs worker client_credentials auth."],
  ["pingone-sample-apps", "Build, run, and troubleshoot the PingOne devdocs sample apps (custom-admin-role, m2m-credentials, mfa-demo, user-registration × go/js/python/react/angular) — worker roles, 401/403/406/415 handling, pi.flow architecture."],
  ["par", "PAR (Pushed Authorization Request, RFC 9126) — understand the flow, verify PingOne PAR endpoint configuration, and test authorization intent binding live."],
];

const PING_RETIRED = "authz-server, authz-server-parity, and pingone-authorize-configure (demo-specific, superseded by project skills). pingone-mcp-install and pingone-remote-mcp-connect ship via the repo rather than the bundle";

const PROJECT_GROUPS = [
  {
    heading: "Identity & Ping Products",
    skills: [
      ["pingfederate-install", "Stand up PingFederate (zip, Docker/Compose, or Kubernetes) — licence, ports, Java, admin console first-run, readiness checks."],
      ["pingfederate-id-jag", "Configure PingFederate 13.1+ to issue/accept ID-JAG (Identity Assertion JWT Authorization Grant, cross-app access) via RFC 8693 token exchange — processor policies, SP connections, JWT Bearer Grant debugging."],
      ["creating-pingfederate-id-jag-resource-server", "Build the resource-server side of ID-JAG enterprise-managed MCP authorization — receiving and validating exchanged tokens."],
      ["pingid-ai-demo", "PingID MFA — device enrollment, authentication policy, user experience, IdP integration."],
      ["pingone-davinci-orchestration", "DaVinci widget and Orchestration SDK flows — collectors, multi-screen progression, callbacks, PKCE, embedded/pop-out runners, safe flow debugging."],
      ["pingone-protect-ai-demo", "PingOne Protect / Signals risk integration — risk evaluations, risk policy inputs, risk-result handling."],
      ["pingone-authorize-ea-api-build", "Build PingOne Authorize policies, Trust Framework attributes, resolvers, and AAM rules against the Early Access Admin API — including sideband decision debugging with PingGateway/Kong. Captures many undocumented API behaviors."],
      ["p1az-import-generator", "Generate a PingOne Authorize snapshot import file from plain-language rules (\"deny if amount over 2000\", \"require step-up MFA over 500\") — produces schema-correct JSON."],
      ["pingauthorize-aam-ai-demo", "PingOne Authorize API Access Management — Sideband decisions, API services, operations, Gateway integration route."],
      ["pingaccess-ai-demo", "PingAccess as a web/API access enforcement layer, and how it differs from PingGateway."],
      ["pingdirectory-ai-demo", "Connect demos to PingDirectory — LDAP identity lookup, user/group data, schema, replication, TLS."],
      ["a2a-protocol", "Agent2Agent protocol work — distinguishes RFC 8693 nested-act identity from the Linux Foundation A2A wire protocol (Agent Cards, JSON-RPC handoff, bearer auth on the A2A hop)."],
    ],
  },
  {
    heading: "Agent & AI",
    skills: [
      ["bedrock-agentcore-pingone", "Deploy an AI agent to AWS Bedrock AgentCore Runtime with PingOne as OAuth IdP — both M2M (client_credentials) and user-federation (3LO login) flows. The gotchas here are from real debugging, not docs."],
      ["oauth-teaching-agent", "Teach or demonstrate OAuth 2.0/2.1, OIDC, scopes, token exchange, delegation, and human approval through an interactive teaching agent."],
      ["agent-demo-triage", "Diagnose demo-agent misbehavior — wrong-mode replies, unknown-action toasts, gateway 502/503s, scope denials — and review routing/flag/scope changes safely."],
      ["chip-correctness-testing", "Verify agent UI chips return the RIGHT answer — real values from the store, correct routing, identical results in heuristics and every LLM mode. Includes the traps that make chip tests silently prove nothing."],
    ],
  },
  {
    heading: "Ping Privilege",
    skills: [
      ["privilege-console-api", "Automate the Privilege console REST API — full CRUD on Agentic Apps, MCP doors, PAC policies, agent registry keys, tags, and tenant API keys without the console UI. Covers how to get credentials per host: key/secret headers (Settings → For Developers) on the local console (local.procyon.ai:8643), browser auth_token cookie on the cloud console — plus the unvalidated session-id, the agent-key namespaced-PUT trap, entry-path recompute, aggregate RefID, CTags semantics, and \"no-policy = deny all\" gotchas."],
      ["privilege-mcpgw-agent-k8s", "Deploy, repair, and verify the PingOne Privilege AI Gateway on Kubernetes from the helm package — Agentic App registration, policy authoring, proving the chain from an MCP client."],
      ["privilege-new-demo-environment", "Stand up a fresh, separate Privilege demo environment — own PingOne env, own gateway, own apps/agents; turns a one-off setup into a repeatable handover."],
      ["privilege-cloud-mcp", "Privilege Cloud MCP integration — the Privilege Gateway, the BFF MCP client relay, and extension patterns."],
      ["privilege-admin-config-ui", "Recipe for building Privilege-facing admin/config pages — config store, thin Express route, themed React component wired into an existing page."],
    ],
  },
  {
    heading: "Demo Engineering",
    skills: [
      ["regression-guard", "Enforce the demo's do-not-break contract before/during changes to OAuth/login, token exchange, BFF sessions, role enforcement, HITL consent, ports/hosts, or the UI — even for one-liners."],
      ["verify-ai-demo2", "Prove a code/env change actually took effect in the running stack — the repeat failure where a feature is merged but inert because the code sits where requests never go. Worktree-aware."],
      ["generate-tests", "Write new unit/integration tests in this repo — routes to the right runner per service, applies repo error-shape/mocking conventions, flags jest/vitest traps that cause false green/red runs."],
      ["se-k8-deploy", "Deploy/undeploy the demo to the SE DevOps Kubernetes cluster — build, GHCR push, kubectl context, health checks."],
      ["inspector-template", "Build or convert admin/dev-tool pages onto the shared MCP-Inspector-style layout (left tool tree, middle param form, right tabbed output) instead of re-hand-rolling it."],
      ["karpathy-guidelines", "Behavioral guidelines to reduce common LLM coding mistakes — surgical changes, no overcomplication, surfaced assumptions, verifiable success criteria."],
      ["pingcli-demo-page", "Build a UI demo page that showcases PingCLI commands — command display, live execution, terminal-style output pane, nav wiring."],
    ],
  },
  {
    heading: "Workflow Skills (Oct 2026)",
    skills: [
      ["docker-local-deploy", "Local Docker deploy on OrbStack — run-docker.sh builds, PROD_MODE vs dev, and the three silent failures of a fresh checkout/worktree (gitignored certs/ and .env files, image-baked MCP config)."],
      ["brand-compliance", "Ping Brand Refresh 2026 — Montserrat, official 2026 logo, Ping Red gradients, the three hardcoded font stacks that must stay in sync, and the documented exceptions."],
    ],
  },
];

const INSTALL_PATHS = [
  {
    heading: "Official Plugins (Claude Code plugin system)",
    body: [
      "Some skills ship as official Claude Code plugins. Install them inside Claude Code with:",
    ],
    code: "/plugin install <plugin-name>@<marketplace>",
    after: "Or via the command line:",
    code2: "claude plugin install <plugin-name>@<marketplace>",
    tail: "The plugin-based general skills below come from the superpowers, skill-creator, code-review, commit-commands, and other official marketplaces. Ping skills come from the official ping-identity marketplace.",
  },
  {
    heading: "Manual Skills (copy to your skills directory)",
    body: [
      "Download claude-skills-bundle.zip, unzip it, then copy the skill folder(s) you want into ~/.claude/skills/ and restart Claude Code.",
    ],
    code: "unzip claude-skills-bundle.zip\ncp -r claude-skills-bundle/general/graphify ~/.claude/skills/",
    after: "To install every manual skill at once:",
    code2:
      "cp -r claude-skills-bundle/general/* ~/.claude/skills/\ncp -r claude-skills-bundle/security/* ~/.claude/skills/\ncp -r claude-skills-bundle/pingone/* ~/.claude/skills/",
    tail: null,
  },
  {
    heading: "Project Skills (copy from the AI-DEMO2 repo)",
    body: [
      "The AI-DEMO2 project skills live in the repo at .claude/skills/. Clone the repo and copy the folder(s) you want into your own project's .claude/skills/ (or ~/.claude/skills/ to load them everywhere). Many are AI-DEMO2-specific but encode reusable Ping identity patterns.",
    ],
    code: null,
    after: null,
    code2: null,
    tail: null,
  },
];

const totalSkills =
  PLUGIN_SKILLS.length +
  MANUAL_SKILLS.length +
  PING_PLUGIN_SKILLS.length +
  PING_BUNDLE_SKILLS.length +
  PROJECT_GROUPS.reduce((sum, g) => sum + g.skills.length, 0);

export default function SkillsIndexPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { plugins: PLUGIN_SKILLS, manual: MANUAL_SKILLS, pingPlugin: PING_PLUGIN_SKILLS, pingBundle: PING_BUNDLE_SKILLS, project: PROJECT_GROUPS };
    const hit = (...parts) => parts.filter(Boolean).join(" ").toLowerCase().includes(q);
    return {
      plugins: PLUGIN_SKILLS.filter(([name, install, what]) => hit(name, install, what)),
      manual: MANUAL_SKILLS.filter(([name, install, what]) => hit(name, install, what)),
      pingPlugin: PING_PLUGIN_SKILLS.filter(([name, what]) => hit(name, what)),
      pingBundle: PING_BUNDLE_SKILLS.filter(([name, what]) => hit(name, what)),
      project: PROJECT_GROUPS.map((g) => ({
        ...g,
        skills: g.skills.filter(([name, what]) => hit(name, what, g.heading)),
      })).filter((g) => g.skills.length > 0),
    };
  }, [query]);

  const tables = [
    { id: "plugins", label: "General purpose — plugins", rows: filtered.plugins, cols: ["Skill", "Install", "What It Does"] },
    { id: "manual", label: "General purpose — manual", rows: filtered.manual, cols: ["Skill", "Install", "What It Does"] },
    { id: "ping-plugin", label: "Ping — official plugin", rows: filtered.pingPlugin, cols: ["Skill", "What It Does"] },
    { id: "ping-bundle", label: "Ping — bundle (sanitized)", rows: filtered.pingBundle, cols: ["Skill", "What It Does"] },
  ];

  return (
    <div className="ski-page">
      <PageHeader
        eyebrow="Learning Hub · Claude Code"
        title="Skills I use with Claude"
        summary={
          <>
            {totalSkills} skills across {4 + PROJECT_GROUPS.length} groups, by
            install path. The downloadable bundle is{" "}
            <a href={GITHUB_SKILLS} target="_blank" rel="noopener noreferrer">
              curtismu7/CDN · claude-skills
            </a>{" "}
            — sanitized (no environment IDs, worker credentials, client
            secrets, or tenant-specific values; PingOne skills reference values
            by .env variable name only). Start here:{" "}
            <code>privilege-console-api</code> (AI-DEMO2 project skill, below)
            — newest and most reused.
          </>
        }
      />

      <div className="ski-body">
        <form className="ski-search" onSubmit={(e) => e.preventDefault()} role="search">
          <label htmlFor="ski-query" className="ski-visually-hidden">
            Search the skills index
          </label>
          <input
            id="ski-query"
            type="search"
            placeholder="Filter by skill, install path, or topic…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>

        <section className="ski-section" aria-label="How to install skills">
          <h2>How to install skills</h2>
          {INSTALL_PATHS.map((p) => (
            <div key={p.heading} className="ski-install-path">
              <h3>{p.heading}</h3>
              {p.body.map((t) => (
                <p key={t}>{t}</p>
              ))}
              {p.code && <pre><code>{p.code}</code></pre>}
              {p.after && <p>{p.after}</p>}
              {p.code2 && <pre><code>{p.code2}</code></pre>}
              {p.tail && <p>{p.tail}</p>}
            </div>
          ))}
          <p className="ski-note">After copying, restart Claude Code so the new skills are discovered.</p>
        </section>

        {tables.map(
          (t) =>
            t.rows.length > 0 && (
              <section key={t.id} id={`ski-${t.id}`} className="ski-section" aria-label={t.label}>
                <h2>
                  {t.label}
                  <span className="ski-count">{t.rows.length}</span>
                </h2>
                <div className="ski-tablewrap">
                  <table>
                    <thead>
                      <tr>
                        {t.cols.map((c) => (
                          <th key={c} scope="col">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.rows.map((row) => (
                        <tr key={row[0]}>
                          {row.map((cell, i) =>
                            i === 0 ? (
                              <th scope="row" key="name">
                                {cell}
                              </th>
                            ) : (
                              <td key={i}>{cell}</td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ),
        )}

        {filtered.plugins.length > 0 && (
          <p className="ski-note">
            Also installed and worth a look: <strong>{PLUGIN_ALSO}</strong>.
          </p>
        )}
        {filtered.manual.length > 0 && (
          <p className="ski-note">
            Retired from the June bundle: {MANUAL_RETIRED}.
          </p>
        )}

        {filtered.pingPlugin.length > 0 && (
          <p className="ski-note">
            Ping now ships an official Claude Code plugin from the{" "}
            <code>pingidentity</code> marketplace — it supersedes most of the
            original hand-built PingOne bundle below.
          </p>
        )}
        {filtered.pingBundle.length > 0 && (
          <p className="ski-note">
            The bundle's Ping skills were re-verified October 2026: real
            credentials removed, demo-specific skills retired, current
            user-level Ping skills added. {PING_BUNDLE_SKILLS.length} skills.
          </p>
        )}
        {filtered.pingBundle.length > 0 && (
          <p className="ski-note">Retired from the bundle: {PING_RETIRED}.</p>
        )}

        {filtered.project.map((g) => (
          <section key={g.heading} className="ski-section" aria-label={g.heading}>
            <h3 className="ski-project-heading">{g.heading}</h3>
            <div className="ski-tablewrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Skill</th>
                    <th scope="col">What It Does</th>
                  </tr>
                </thead>
                <tbody>
                  {g.skills.map(([name, what]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p className="ski-footer-meta">
          Last updated: 11 October 2026 — the zip bundle was rebuilt October
          2026 (sanitized; retired skills removed; current user-level Ping
          skills added) and pushed to GitHub 11 October 2026. Source doc:{" "}
          <code>claudSkills/skills-confluence-page.html</code>.
        </p>
      </div>
    </div>
  );
}
