// The shared lesson shell for the DaVinci lessons: /davinci-sdk-login (the
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
import { useEffect, useRef, useState } from "react";
import useDividerDrag from "../../hooks/useDividerDrag";
import { useMermaidRender } from "../../hooks/useMermaidRender";
import "./lesson.css";

/**
 * Header, a resizable section nav, and the content column.
 * @param {{ title: string, subtitle?: import('react').ReactNode,
 *   sections: Array<{ id: string, label: string }>, storageKey?: string,
 *   children: import('react').ReactNode }} props
 */
export function LessonLayout({ title, subtitle, sections = [], storageKey, children }) {
  const [active, setActive] = useState(sections[0]?.id);
  const { size, handleProps } = useDividerDrag({ min: 180, max: 400, initial: 220, storageKey });

  const go = (id) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth" });
  };

  return (
    <div className="lesson-page">
      <header className="lesson-header">
        <h1>{title}</h1>
        {subtitle && <p className="lesson-subtitle">{subtitle}</p>}
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
        <main className="lesson-content">{children}</main>
      </div>
    </div>
  );
}

export function Section({ id, title, children }) {
  return (
    <section id={id} className="lesson-section">
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
