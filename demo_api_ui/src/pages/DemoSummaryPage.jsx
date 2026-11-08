// /demo-summary — every demoable page, grouped as in the side nav.
//
// A static index built from src/data/pageCatalog.md: nothing on this page calls a service. Each card
// links to the page itself, which says for itself whether it is live or simulated.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first,
// P3 frame and sections (one per catalog group), P4 cards (one per page), P5 kv (route, access),
// P7 chips (access, always a word). Skipped: P6 inspector and P8 diagram (no step flow here).
//
// P9, one primary per view state:
//   - side menu visible: the page has no button at all, so no primary. The controls are the filter
//     field and the page links, and a link is navigation, not an action.
//   - side menu hidden: "Show side menu" is the only button and is the primary. It is the one action that
//     gets the user back to the grouped nav (the other restore is Ctrl+Shift+B). It unmounts when
//     clicked, so focus is moved to the filter field instead of being dropped to the page.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { parsePageCatalog } from "../utils/parsePageCatalog";
import catalogMd from "../data/pageCatalog.md?raw";
import PageHeader from "../components/common/PageHeader";
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from "../components/pingUi";
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

// What the catalog records for the page's access level ("Auth: public"). The word is always shown;
// the tone only adds colour to it. This is the catalog's text, not a check of the current sign-in.
const ACCESS = {
  public: { tone: "neutral", word: "Public" },
  user: { tone: "info", word: "Signed in" },
  admin: { tone: "warn", word: "Admin" },
};
const accessOf = (p) => {
  const m = /Auth:\s*([a-z]+)/i.exec(p.route || "");
  return ACCESS[m ? m[1].toLowerCase() : ""] || { tone: "neutral", word: "Unclear" };
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function DemoSummaryPage() {
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
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
    // The button unmounts once the rail is back: hand focus to the next control, not to the page.
    searchRef.current?.focus();
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
  const shown = groups.reduce((n, g) => n + g.pages.length, 0);

  return (
    <PingPage className="dsum-page">
      <SimBanner data-testid="dsum-banner">
        <strong>STATIC INDEX</strong> — this list is a snapshot of the page catalog file, not a live
        check. Nothing on it calls a service, and the Access chip is what the catalog records for each
        page, not your current sign-in. Each link opens the real page, which says for itself whether
        it is live or simulated.
      </SimBanner>
      <PageHeader
        eyebrow="Demo Summary"
        title={query ? <>Results for &ldquo;{query}&rdquo;</> : "Everything you can demo"}
        summary={`Every demoable page with what it proves, grouped as in the side nav. ${total} pages.`}
      />
      <PageFrame>
        <Section id="dsum-filter-h" kicker="Find a page" title="Filter the index">
          <Card tone="neutral" data-testid="dsum-filter">
            <label className="pu-label" htmlFor="dsum-search">Filter by name, route or what it demos</label>
            <input
              id="dsum-search"
              ref={searchRef}
              type="search"
              className="dsum-search"
              placeholder="Filter by name, route or what it demos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="pu-note" role="status" data-testid="dsum-count">
              {query.trim() ? `Showing ${shown} of ${total} pages.` : `Showing all ${total} pages.`}
            </p>
            {navHidden ? (
              <>
                <p className="pu-note">The side menu is hidden, so these links are the only way around the app.</p>
                <div className="pu-actions">
                  <button
                    type="button"
                    className="pu-btn pu-btn--primary"
                    onClick={showSideMenu}
                    data-testid="dsum-restore"
                  >
                    Show side menu
                  </button>
                </div>
              </>
            ) : null}
          </Card>
        </Section>

        {groups.length === 0 ? (
          <p className="pu-empty pu-note" data-testid="dsum-empty">
            No page matches &ldquo;{query.trim()}&rdquo;. Clear the filter to see all {total} pages.
          </p>
        ) : null}

        {groups.map((g, i) => {
          const id = `dsum-group-${i}`;
          return (
            <Section key={g.label} id={id} kicker={plural(g.pages.length, "page")} title={g.label}>
              <ul className="dsum-list">
                {g.pages.map((p) => {
                  const access = accessOf(p);
                  return (
                    <li key={`${g.label}:${p.label}`}>
                      <Card
                        className="dsum-card"
                        title={
                          <Link className="dsum-link" to={routePath(p)}>
                            {p.label}
                          </Link>
                        }
                      >
                        <p className="pu-note dsum-blurb">{p.demos || p.does}</p>
                        <KvList
                          items={[
                            { label: "Route", value: routePath(p), mono: true },
                            { label: "Access", value: <StatusChip tone={access.tone}>{access.word}</StatusChip> },
                          ]}
                        />
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </Section>
          );
        })}
      </PageFrame>
    </PingPage>
  );
}
