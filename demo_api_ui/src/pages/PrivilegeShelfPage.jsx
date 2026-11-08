import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import features from "../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../config/privilegeMapPages";
import { PingPage, SimBanner, PageFrame, Section, StatusChip } from "../components/pingUi";
import "./PrivilegeShelfPage.css";

// Every Privilege resource in one place. Cards link to existing pages; nothing here is a new claim.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the
// shared primitives (components/pingUi, styles/ping-ui.css): P2 banner first, P3 frame, P4 cards, P7 chips.
// Skipped on purpose: P5 key-value (no label/value pairs here), P6 inspector and P8 diagram (an index has
// neither). P9: this page has no buttons, only links, so it has no primary button in any state.
// "1 feature", "2 features": a count that is a single item must not read as a plural.
const countOf = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const SECTIONS = [
  {
    id: "map",
    title: "Privilege Map",
    blurb: `${features.length} features, one page per area: why we need it, how it works, the value to the end user, and the components it uses.`,
    cards: PRIVILEGE_MAP_PAGES.map((p) => ({
      title: p.title,
      text: p.purpose,
      to: `/privilege-map?page=${p.id}`,
      meta: countOf(features.filter((f) => f.page === p.id).length, "feature"),
    })),
  },
  {
    id: "guides",
    title: "Guides and diagrams",
    blurb: "How the gateway is put together and how traffic flows through it.",
    cards: [
      { title: "Agent Privilege Guide", text: "The AI agent gateway explained, including the non-human identity section.", to: "/privilege-mcp-learning" },
      { title: "Agent Privilege Diagrams", text: "The gateway as interactive diagrams.", to: "/privilege-mcp-diagrams" },
      { title: "Agent Privilege Topologies", text: "Deployment topologies for the gateway.", to: "/privilege-gateway-topologies" },
      { title: "External Agent App Diagrams", text: "External agent apps through the gateway: dual path and sequence.", to: "/external-door-diagrams" },
    ],
  },
  {
    id: "docs",
    title: "Documentation",
    blurb: "The written record.",
    cards: [
      { title: "Privilege Docs Index", text: "Every Privilege document we own, with Drive links.", to: "/privilege-docs-index" },
    ],
  },
  {
    id: "demos",
    title: "Demos",
    blurb: "Hands-on pages that exercise the features.",
    cards: [
      { title: "AI Policies Demo", text: "Cedar AI policies: allow, deny and hold.", to: "/privilege-ai-policies" },
      { title: "PingFederate Token Demo", text: "A PingFederate token presented to the gateway.", to: "/privilege-pf-token" },
      { title: "Agent Privilege Demo", text: "The Privilege demo app.", to: "/privilege-demo" },
      { title: "Intent, Purpose and Behaviour", text: "Three signals per call: what it attempts, whether it was in scope, whether the agent normally does it.", isNew: true, to: "/privilege-intent-triage" },
      { title: "Coding Agents", text: "Privilege at the hook: Claude Code, Cursor, Codex, Gemini CLI, Copilot, Antigravity.", isNew: true, to: "/privilege-coding-agents" },
      { title: "SaaS Access Management", text: "JIT, time-bound access with a receipt per grant and drift detection.", isNew: true, to: "/privilege-saas-access" },
      { title: "Prompt Logging, encrypted to you", text: "Sealed prompt records opened only with your private key, in the browser.", isNew: true, to: "/privilege-prompt-log" },
      { title: "Personal data detection", text: "PII from 5 kinds to 23, checksum-validated, with the graduated response.", isNew: true, to: "/privilege-pii-detection" },
    ],
  },
  {
    id: "source",
    title: "Source code",
    blurb: "The standalone Privilege Map repository on GitHub (private, sign-in required).",
    cards: [
      { title: "privilege-map on GitHub", text: "The standalone Privilege Map app: data, diagrams, tests and docs.", href: "https://github.com/cmuir_pingcorp/privilege-map" },
    ],
  },
];

export default function PrivilegeShelfPage() {
  return (
    <PingPage className="pshelf-page">
      <SimBanner data-testid="pshelf-banner">
        <strong>INDEX ONLY</strong> — this page links to other pages. It makes no calls and shows no simulated
        results; any simulation lives on the linked pages, not here. One link opens GitHub in a new tab.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege info"
        title="Privilege shelf"
        summary="Everything about Privilege in one place: the Privilege Map, guides and diagrams, documentation, and demos."
      />
      <PageFrame>
        {SECTIONS.map((s, i) => (
          <Section key={s.id} id={`pshelf-${s.id}`} kicker={`${i + 1} of ${SECTIONS.length} · ${countOf(s.cards.length, "link")}`} title={s.title} lede={s.blurb}>
            <div className="pu-card-grid" role="list">
              {s.cards.map((c, n) => {
                // The "Opens in a new tab" chip is the link's description, so a screen reader hears it with the link name.
                const noteId = `pshelf-${s.id}-${n}-note`;
                return (
                <div key={c.to || c.href} role="listitem" className={`pu-card pshelf-card${c.href ? " pu-card--neutral" : ""}`}>
                  <h3 className="pu-h3">
                    {c.href ? (
                      <a className="pshelf-link" href={c.href} target="_blank" rel="noopener noreferrer" aria-describedby={noteId}>
                        {c.title} <span aria-hidden="true">&#8599;</span>
                      </a>
                    ) : (
                      <Link className="pshelf-link" to={c.to}>{c.title}</Link>
                    )}
                  </h3>
                  <p className="pu-note">{c.text}</p>
                  {c.isNew || c.meta || c.href ? (
                    <p className="pshelf-chips" id={c.href ? noteId : undefined}>
                      {c.isNew ? <StatusChip tone="info">New in the Platform Update</StatusChip> : null}
                      {c.meta ? <StatusChip>{c.meta}</StatusChip> : null}
                      {c.href ? <StatusChip>Opens in a new tab</StatusChip> : null}
                    </p>
                  ) : null}
                </div>
                );
              })}
            </div>
          </Section>
        ))}
      </PageFrame>
    </PingPage>
  );
}
