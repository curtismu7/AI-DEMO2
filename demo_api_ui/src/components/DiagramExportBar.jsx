// demo_api_ui/src/components/DiagramExportBar.jsx
//
// Download row for the kept diagram pages (System, Overview, Sequence) so the
// diagrams can be reused in other tools: Mermaid source (.mmd), rendered
// PNG/SVG, and draw.io XML (.drawio) where a flowchart source exists.
//
// Interop routes the hint text points at (see docs/diagrams/DIAGRAMS.md):
//   - Lucidchart: File > Import > draw.io for the .drawio (draggable shapes),
//     or paste the .mmd into Insert > Diagram as code > Mermaid.
//   - draw.io: open the .drawio directly, or Insert > Advanced > Mermaid.
//   - mermaid.live / GitHub render the .mmd as-is.

const linkStyle = {
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#1d4ed8",
  textDecoration: "underline",
  whiteSpace: "nowrap",
};

/**
 * @param {{ items: Array<{label: string, href: string}> }} props
 *   items — one entry per downloadable format, e.g.
 *   [{ label: "Mermaid (.mmd)", href: "/architecture/architecture.mmd" }]
 */
export default function DiagramExportBar({ items }) {
  if (!items?.length) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
        padding: "0.4rem 0.6rem",
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        margin: "0.5rem 0",
      }}
    >
      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#475569" }}>
        Export:
      </span>
      {items.map(({ label, href }) => (
        <a key={href} href={href} download style={linkStyle}>
          {label}
        </a>
      ))}
      <span
        style={{
          marginLeft: "auto",
          fontSize: "0.72rem",
          color: "#64748b",
        }}
      >
        Lucidchart: import the .drawio (File &gt; Import) or paste the .mmd via
        Insert &gt; Diagram as code &gt; Mermaid
      </span>
    </div>
  );
}
