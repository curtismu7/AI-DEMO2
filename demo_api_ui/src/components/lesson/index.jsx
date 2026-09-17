// The shared lesson shell for the DaVinci lessons: /davinci-orchestration-sdk (the
// Orchestration SDK) and the DaVinci widget guide. Both lessons use it so they
// read as one course, with the same header, resizable section nav, copyable
// code, tables, diagrams and "On this run" box.
//
// Extracted from DavinciLoginGuidePage's dlg-* shell, with neutral lesson-*
// classes. Every colour is a --th-* token and every font size comes from the
// scale (THEMING.md), so both lessons follow the app theme.
//
// The same primitives work inside a DraggableModal body, so each lesson's
// post-sign-in summary matches its page.
//
// Export PDF prints the lesson as a customer handout: Ping Identity branding at
// the top, a copyright and trademark notice at the end, and only the teaching
// sections (see DEFAULT_PRINT_EXCLUDE). The layout lives in lesson.css's
// @media print block; the browser's print dialog saves the PDF.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import useDividerDrag from "../../hooks/useDividerDrag";
import { useMermaidRender } from "../../hooks/useMermaidRender";
import { useThemeOptional } from "../../context/ThemeContext";
import "./lesson.css";

// Sections a customer handout leaves out: Try It Live is a live sign-in with
// this demo's tenant ids in its Step Inspector, and In This Repo lists the
// demo's own source files. Both DaVinci lessons use these ids.
export const DEFAULT_PRINT_EXCLUDE = ["try-it-live", "in-this-repo"];

const PrintExcludeContext = createContext(DEFAULT_PRINT_EXCLUDE);

// Copyright format as Ping publishes it (docs.pingidentity.com footer and the
// SDK's own source headers). The trademark sentence is the standard attribution
// form; Ping's site does not publish one to copy.
const LEGAL_COPYRIGHT = `Copyright © ${new Date().getFullYear()} Ping Identity Corporation. All rights reserved.`;
const LEGAL_TRADEMARK =
  "Ping Identity, PingOne and DaVinci are trademarks or registered trademarks of Ping Identity Corporation. All other trademarks are the property of their respective owners.";

// Prints in the light theme whatever the viewer uses: print drops background
// colours by default, so dark-theme ink would come out pale on white paper.
// "Save as PDF" suggests document.title as the file name, so it names the
// lesson for the duration of the print. Both are restored on afterprint, or at
// once if print() throws. A print a browser silently blocks never fires
// afterprint; nothing in this app runs sandboxed, so that case is not handled.
function exportPdf(title) {
  const root = document.documentElement;
  const previousTheme = root.getAttribute("data-theme");
  const previousTitle = document.title;
  root.setAttribute("data-theme", "light");
  document.title = `Ping Identity – ${title}`;
  const restore = () => {
    if (previousTheme === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", previousTheme);
    document.title = previousTitle;
  };
  window.addEventListener("afterprint", restore, { once: true });
  try {
    window.print();
  } catch {
    window.removeEventListener("afterprint", restore);
    restore();
  }
}

/**
 * Header, a resizable section nav, and the content column.
 * @param {{ title: string, subtitle?: import('react').ReactNode,
 *   sections: Array<{ id: string, label: string }>, storageKey?: string,
 *   printExclude?: string[], headerNav?: import('react').ReactNode,
 *   pageClassName?: string, children: import('react').ReactNode }} props
 */
export function LessonLayout({
  title,
  subtitle,
  sections = [],
  storageKey,
  printExclude = DEFAULT_PRINT_EXCLUDE,
  headerNav,
  pageClassName = "",
  children,
}) {
  const [active, setActive] = useState(sections[0]?.id);
  const { size, handleProps } = useDividerDrag({ min: 180, max: 400, initial: 220, storageKey });
  const { darkMode, toggleDarkMode } = useThemeOptional();

  // Every printed page carries the copyright and trademark notice in its bottom
  // margin, via an @page margin box. Measured in Chromium's PDF output: a
  // position:fixed footer repeats but covers the page's last lines of text, and
  // a table-footer-group does not repeat at all; the margin box does neither.
  // @page cannot be scoped to one page of a single-page app and cannot compute
  // the year, so the rule exists only while a lesson is mounted. Browsers
  // without margin-box support still get the end-of-document notice.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-lesson-print", "");
    style.textContent = `@media print { @page { margin: 16mm 14mm 24mm; @bottom-center { content: ${JSON.stringify(
      `${LEGAL_COPYRIGHT} ${LEGAL_TRADEMARK}`,
    )}; font-family: system-ui, -apple-system, sans-serif; font-size: 7.5pt; color: var(--th-text-muted, #555); } } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const go = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" });
  };

  return (
    <PrintExcludeContext.Provider value={printExclude}>
      <div className={`lesson-page${pageClassName ? ` ${pageClassName}` : ""}`}>
        <header className="lesson-header">
          {/* A text wordmark, not an image: the repo's branding/ping-logo.svg
              is a placeholder "P" badge, not Ping Identity's logo, and a
              customer handout must not pass one off as the other. */}
          <div className="lesson-print-brand">
            <strong className="lesson-print-wordmark">Ping Identity</strong>
            <span>pingidentity.com</span>
          </div>
          <div className="lesson-header-row">
            <h1>{title}</h1>
            <div className="lesson-header-actions">
              <button
                type="button"
                className="lesson-theme-toggle"
                onClick={toggleDarkMode}
                title="Switch between light and dark mode"
                aria-pressed={darkMode}
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
              </button>
              <button type="button" className="lesson-export" onClick={() => exportPdf(title)}>
                Export PDF
              </button>
            </div>
          </div>
          {subtitle && <p className="lesson-subtitle">{subtitle}</p>}
          {headerNav && <div className="lesson-header-nav">{headerNav}</div>}
        </header>
        <div className="lesson-layout" style={{ "--lesson-nav-w": `${size}px` }}>
          <nav className="lesson-sidebar" aria-label="Lesson sections">
            {sections.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`lesson-nav-item${active === s.id ? " lesson-nav-item--active" : ""}`}
                aria-current={active === s.id ? "true" : undefined}
                onClick={() => go(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="divider-drag-handle" aria-label="Resize section navigation" {...handleProps} />
          <main className="lesson-content">
            {children}
            <footer className="lesson-print-legal">
              <p>{LEGAL_COPYRIGHT}</p>
              <p>{LEGAL_TRADEMARK}</p>
            </footer>
          </main>
        </div>
      </div>
    </PrintExcludeContext.Provider>
  );
}

export function Section({ id, title, children }) {
  const printExclude = useContext(PrintExcludeContext);
  const className = printExclude.includes(id) ? "lesson-section lesson-no-print" : "lesson-section";
  return (
    <section id={id} className={className}>
      <h2 className="lesson-section-title">{title}</h2>
      {children}
    </section>
  );
}

/** A code sample with a Copy button. `code` is the exact text copied. */
export function CodeBlock({ title, code, language }) {
  // "Copy" | "Copied" | "Copy failed". Clipboard access throws on insecure
  // origins and when permission is denied, so say so rather than pretend.
  const [label, setLabel] = useState("Copy");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setLabel("Copied");
    } catch {
      setLabel("Copy failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel("Copy"), 1500);
  };

  return (
    <div className="lesson-code">
      <div className="lesson-code-bar">
        <span className="lesson-code-title">{title}</span>
        <button type="button" className="lesson-code-copy" onClick={copy}>
          {label}
        </button>
      </div>
      <pre>
        <code data-language={language}>{code}</code>
      </pre>
    </div>
  );
}

export function TableBlock({ headers, rows }) {
  return (
    <div className="lesson-table-wrap">
      <table className="lesson-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={i}>
              {row.map((cell, j) => (
                // eslint-disable-next-line react/no-array-index-key
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MermaidFigure({ source, label }) {
  const { containerRef, error } = useMermaidRender(source, {
    securityLevel: "strict",
    sequence: { useMaxWidth: true, wrap: false },
  });
  return (
    <figure className="lesson-mermaid" aria-label={label}>
      {error ? (
        <p className="lesson-mermaid-error">Diagram failed to render: {error}</p>
      ) : (
        <div className="lesson-mermaid-canvas" ref={containerRef} />
      )}
    </figure>
  );
}

/** What actually happened in this browser, from a real trace. */
export function OnThisRun({ title = "On this run", children }) {
  return (
    <div className="lesson-run">
      <p className="lesson-run-title">{title}</p>
      {children}
    </div>
  );
}

export function Status({ ok, children }) {
  return (
    <span className={ok ? "lesson-ok" : "lesson-warn"}>
      {ok ? "✓" : "⚠️"} {children}
    </span>
  );
}

export function Lede({ children }) {
  return <p className="lesson-lede">{children}</p>;
}

export function LessonFoot({ children }) {
  return <p className="lesson-foot">{children}</p>;
}
