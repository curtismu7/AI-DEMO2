import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { parsePageCatalog } from "../utils/parsePageCatalog";
import catalogMd from "../data/pageCatalog.md?raw";
import PageHeader from "../components/common/PageHeader";
import "./DemoSummaryPage.css";

const GROUPS = parsePageCatalog(catalogMd);

// Entries with no in-app route to link to, duplicates, or dev-only pages.
// Each is a page label from pageCatalog.md.
const HIDDEN_PAGES = new Set([
  // External tools / no in-app route (PAC editor, BFF-served docs, Grafana, LibreChat)
  "PAC Editor",
  "API Docs (Swagger)",
  "API Reference (Scalar)",
  "Grafana",
  "LibreChat (browser)",
  // Side-nav actions with no route (attack drawer tabs, overlay triggers)
  "Prompt Injection",
  "HITL Bypass",
  "Indirect Injection",
  "Unauthorized Commitments",
  "Scope Abuse",
  "Intent Bypass",
  "Demo Script",
  "Learning Log",
  // Redirect stubs duplicating their target page
  "DaVinci Login",
  "DaVinci SDK Login",
  "DaVinci Orchestration",
  "DaVinci Orchestration Overview",
  "Orchestration SDK Guide",
  "Ping AI Test Lab",
  // Dev / audit / TODO pages
  "Code Explorer",
  "Graphify",
  "Demo Steps Lifeline Audit",
  "SPIFFE → PingOne Bridge (TODO)",
  "Snapshot Import",
  // Management screens, not demos
  "Page Catalog",
  "Demo Config",
  "Feature Flags",
]);

// The catalog's route field is the full line ("/weather-mcp · Auth: public");
// the linkable path is the first token. Entries whose route does not start
// with "/" (external tools, "none" side-nav actions) have no in-app route.
const routePath = (p) => (p.route || "").split(" ")[0];
const hasAppRoute = (p) => (p.route || "").startsWith("/");

export default function DemoSummaryPage() {
  const [query, setQuery] = useState("");
  // The logo opens this page — including for users whose side rail was
  // hidden by the old magic-link behavior. Without a way back, the rail
  // stays hidden forever (the only other restore is Ctrl+Shift+B).
  const [navHidden, setNavHidden] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setNavHidden(localStorage.getItem("adminSideNav.hidden") === "1");
      } catch {
        setNavHidden(false);
      }
    };
    read();
    window.addEventListener("admin-sidenav-hidden-toggle", read);
    return () => window.removeEventListener("admin-sidenav-hidden-toggle", read);
  }, []);
  const showSideMenu = () => {
    try {
      localStorage.setItem("adminSideNav.hidden", "0");
    } catch {
      /* private mode — ignore */
    }
    window.dispatchEvent(new CustomEvent("admin-sidenav-hidden-toggle"));
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({
      ...g,
      pages: g.pages.filter(
        (p) =>
          !HIDDEN_PAGES.has(p.label) &&
          hasAppRoute(p) &&
          (!q ||
            [p.label, p.route, p.demos].some((t) => (t || "").toLowerCase().includes(q))),
      ),
    })).filter((g) => g.pages.length > 0);
  }, [query]);

  const total = GROUPS.reduce(
    (n, g) => n + g.pages.filter((p) => !HIDDEN_PAGES.has(p.label) && hasAppRoute(p)).length,
    0,
  );

  return (
    <div className="dsum-page">
      <PageHeader
        className="dsum-head"
        eyebrow="Demo Summary"
        title={query ? <>Results for &ldquo;{query}&rdquo;</> : "Everything you can demo"}
        summary={`Every demoable page with what it proves, grouped as in the side nav. ${total} pages.`}
      >
        <input
          type="search"
          className="dsum-search"
          placeholder="Filter by name, route or what it demos"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter demo pages"
        />
        {navHidden ? (
          <button type="button" className="dsum-restore" onClick={showSideMenu}>
            Show side menu
          </button>
        ) : null}
      </PageHeader>

      {groups.map((g) => (
        <section key={g.label} className="dsum-group">
          <h2>{g.label}</h2>
          <ul className="dsum-list">
            {g.pages.map((p) => (
              <li key={`${g.label}:${p.label}`} className="dsum-item">
                <Link className="dsum-link" to={routePath(p)}>
                  {p.label}
                </Link>
                <p className="dsum-blurb">{p.demos || p.does}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
