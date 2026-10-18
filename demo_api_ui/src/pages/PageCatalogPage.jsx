import React, { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import { notifyError } from "../utils/appToast";
import { parsePageCatalog } from "../utils/parsePageCatalog";
import { NAV_STRUCTURE_CATALOG } from "../config/navStructureCatalog";
import catalogMd from "../data/pageCatalog.md?raw";
import PageHeader from "../components/common/PageHeader";
import "./PageCatalogPage.css";

const GROUPS = parsePageCatalog(catalogMd);

// Labels the side nav can actually hide: top-level entries and group children.
const NAV_LABELS = new Set(
  NAV_STRUCTURE_CATALOG.flatMap((g) => [g.label, ...(g.children || [])]),
);
// Demo Config is exempt from hiding in AdminSideNav so a user can always undo.
const ALWAYS_SHOWN = "Demo Config";

/**
 * PageCatalogPage — every side-nav page with what it does / teaches / demos,
 * and a checkbox per page that shows or hides it in this user's side nav.
 * Visibility is the same per-user hiddenLabels list Demo Config edits, so the
 * two screens never disagree.
 */
export default function PageCatalogPage() {
  const [hidden, setHidden] = useState([]);
  const [flagOn, setFlagOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get("/api/user/nav-config");
      setHidden(data.hiddenLabels || []);
      setFlagOn(!!data.flagOn);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (label) => {
    const prev = hidden;
    const next = hidden.includes(label) ? hidden.filter((l) => l !== label) : [...hidden, label];
    setHidden(next);
    try {
      // navOrder/childOrder omitted on purpose: the server keeps the saved ones.
      await apiClient.put("/api/user/nav-config", { hiddenLabels: next, activeConfigId: null });
      window.dispatchEvent(new Event("nav-config-changed"));
    } catch (err) {
      setHidden(prev);
      notifyError(`Could not save side-nav visibility: ${err.message}`);
    }
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GROUPS;
    return GROUPS
      .map((g) => ({
        ...g,
        pages: g.pages.filter((p) =>
          [p.label, p.route, p.does, p.teaches, p.demos].some((t) => (t || "").toLowerCase().includes(q))),
      }))
      .filter((g) => g.pages.length > 0);
  }, [query]);

  const total = GROUPS.reduce((n, g) => n + g.pages.length, 0);

  return (
    <div className="pcat-page">
      <PageHeader
        className="pcat-head"
        eyebrow="Page Catalog"
        title="Every page: what it does, teaches and demos"
        summary={`Untick a page to hide it from your side nav; tick it to bring it back. ${total} pages. Changes save immediately and apply only to you.`}
      >
        <input
          type="search"
          className="pcat-search"
          placeholder="Filter by name, route or topic"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter pages"
        />
      </PageHeader>

      {error ? <p className="pcat-note pcat-note--error" role="alert">Could not load your side-nav settings: {error}</p> : null}
      {!flagOn && !loading ? (
        <p className="pcat-note">
          Sidebar customization is off (feature flag ff_sidebar_customization), so hiding is disabled
          until an admin turns it on.
        </p>
      ) : null}

      {groups.map((g) => (
        <section key={g.label} className="pcat-group">
          <h2>{g.label}</h2>
          <ul className="pcat-list">
            {g.pages.map((p) => {
              const hideable = NAV_LABELS.has(p.label) && p.label !== ALWAYS_SHOWN;
              return (
                <li key={`${g.label}:${p.label}`} className="pcat-item">
                  <label className="pcat-check">
                    <input
                      type="checkbox"
                      checked={!hidden.includes(p.label)}
                      disabled={loading || !flagOn || !hideable}
                      onChange={() => toggle(p.label)}
                      aria-label={`Show ${p.label} in side nav`}
                    />
                    <span className="pcat-name">{p.label}</span>
                  </label>
                  <span className="pcat-route">{p.route}</span>
                  <dl className="pcat-facts">
                    <dt>Does</dt><dd>{p.does}</dd>
                    <dt>Teaches</dt><dd>{p.teaches}</dd>
                    <dt>Demos</dt><dd>{p.demos}</dd>
                  </dl>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
