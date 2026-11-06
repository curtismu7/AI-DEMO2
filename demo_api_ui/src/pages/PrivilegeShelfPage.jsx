import { Link } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import features from "../data/privilegeFeatures.json";
import { PRIVILEGE_MAP_PAGES } from "../config/privilegeMapPages";
import "./PrivilegeShelfPage.css";

// Every Privilege resource in one place. Cards link to existing pages; nothing here is a new claim.
const SECTIONS = [
  {
    id: "map",
    title: "Privilege Map",
    blurb: `${features.length} features, one page per area: why we need it, how it works, the value to the end user, and the components it uses.`,
    cards: PRIVILEGE_MAP_PAGES.map((p) => ({
      title: p.title,
      text: p.purpose,
      to: `/privilege-map?page=${p.id}`,
      meta: `${features.filter((f) => f.page === p.id).length} features`,
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
      { title: "Intent, Purpose and Behaviour", text: "Three signals per call: what it attempts, whether it was in scope, whether the agent normally does it. (Platform Update, new)", to: "/privilege-intent-triage" },
      { title: "Coding Agents", text: "Privilege at the hook: Claude Code, Cursor, Codex, Gemini CLI, Copilot, Antigravity. (Platform Update, new)", to: "/privilege-coding-agents" },
      { title: "SaaS Access Management", text: "JIT, time-bound access with a receipt per grant and drift detection. (Platform Update, new)", to: "/privilege-saas-access" },
      { title: "Prompt Logging, encrypted to you", text: "Sealed prompt records opened only with your private key, in the browser. (Platform Update, new)", to: "/privilege-prompt-log" },
      { title: "Personal data detection", text: "PII from 5 kinds to 23, checksum-validated, with the graduated response. (Platform Update, new)", to: "/privilege-pii-detection" },
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
    <div className="pshelf-page">
      <PageHeader
        eyebrow="Ping products · Privilege info"
        title="Privilege shelf"
        summary="Everything about Privilege in one place: the Privilege Map, guides and diagrams, documentation, and demos."
      />
      <div className="pshelf-body">
        {SECTIONS.map((s) => (
          <section key={s.id} className="pshelf-section" aria-labelledby={`pshelf-${s.id}`}>
            <h2 id={`pshelf-${s.id}`}>{s.title}</h2>
            <p className="pshelf-blurb">{s.blurb}</p>
            <ul className="pshelf-cards">
              {s.cards.map((c) => (
                <li key={c.to || c.href}>
                  {c.href ? (
                    <a className="pshelf-card" href={c.href} target="_blank" rel="noopener noreferrer">
                      <span className="pshelf-card-title">{c.title} <span aria-hidden="true">&#8599;</span></span>
                      <span className="pshelf-card-text">{c.text}</span>
                    </a>
                  ) : (
                    <Link className="pshelf-card" to={c.to}>
                      <span className="pshelf-card-title">{c.title}</span>
                      <span className="pshelf-card-text">{c.text}</span>
                      {c.meta ? <span className="pshelf-card-meta">{c.meta}</span> : null}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
