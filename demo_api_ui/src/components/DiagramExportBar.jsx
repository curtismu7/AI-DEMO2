// demo_api_ui/src/components/DiagramExportBar.jsx
//
// Download row for diagram pages: static file links, dynamic .mmd download,
// and .mmd upload (for live Mermaid diagrams).
//
// Interop routes the hint text points at (see docs/diagrams/DIAGRAMS.md):
//   - Lucidchart: File > Import > draw.io for the .drawio (draggable shapes),
//     or paste the .mmd into Insert > Diagram as code > Mermaid.
//   - draw.io: open the .drawio directly, or Insert > Advanced > Mermaid.
//   - mermaid.live / GitHub render the .mmd as-is.

import { useRef } from "react";
import "./DiagramExportBar.css";

const linkStyle = {
  fontWeight: 600,
  textDecoration: "underline",
  whiteSpace: "nowrap",
};

const btnStyle = {
  ...linkStyle,
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
};

/**
 * @param {{
 *   items?: Array<{label: string, href: string}>,
 *   source?: string,
 *   sourceFilename?: string,
 *   onSourceChange?: (newSource: string) => void,
 * }} props
 *   items         — static file download links
 *   source        — current Mermaid source; enables dynamic .mmd download
 *   sourceFilename — filename for the dynamic download (default "diagram.mmd")
 *   onSourceChange — called with text of uploaded .mmd; enables upload button
 */
export default function DiagramExportBar({ items, source, sourceFilename = "diagram.mmd", onSourceChange }) {
  const fileInputRef = useRef(null);

  function handleDownload() {
    const blob = new Blob([source], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sourceFilename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onSourceChange(ev.target.result);
    reader.readAsText(file);
    e.target.value = "";
  }

  const hasContent = items?.length || source || onSourceChange;
  if (!hasContent) return null;

  return (
    <div className="deb-bar">
      <span className="deb-label">Export:</span>
      {items?.map(({ label, href }) => (
        <a key={href} href={href} download className="deb-link" style={linkStyle}>
          {label}
        </a>
      ))}
      {source != null && (
        <button onClick={handleDownload} className="deb-link" style={btnStyle}>
          Download .mmd
        </button>
      )}
      {onSourceChange && (
        <>
          <button onClick={() => fileInputRef.current?.click()} className="deb-link" style={btnStyle}>
            Upload .mmd
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mmd,.txt"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </>
      )}
      <span className="deb-hint">
        {items?.length
          ? "Lucidchart: import the .drawio (File \u203a Import) or paste the .mmd via Insert \u203a Diagram as code \u203a Mermaid"
          : "Edit the .mmd in mermaid.live or any text editor, then upload to update the diagram"}
      </span>
    </div>
  );
}
