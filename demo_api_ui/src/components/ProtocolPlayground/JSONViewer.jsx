import React from 'react';
import './JSONViewer.css';

/**
 * Render JSON with syntax highlighting via regex-based tokenization.
 * No external libraries; pure CSS coloring.
 */
export default function JSONViewer({ data }) {
  if (!data) return null;

  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  // Tokenize and colorize JSON
  const highlighted = json
    .split('\n')
    .map((line) => {
      let html = line
        // Keys (quoted strings followed by colon)
        .replace(/"([^"]*)"(\s*):/g, '<span class="json-key">"$1"</span>$2<span class="json-colon">:</span>')
        // String values
        .replace(/:\s*"([^"]*)"/g, (m) => m.replace(/"([^"]*)"/g, '<span class="json-string">"$1"</span>'))
        .replace(/\[\s*"([^"]*)"/g, (m) => m.replace(/"([^"]*)"/g, '<span class="json-string">"$1"</span>'))
        // Numbers
        .replace(/([:\[,]\s*)(\d+\.?\d*)/g, '$1<span class="json-number">$2</span>')
        // Booleans
        .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
        // Null
        .replace(/\b(null)\b/g, '<span class="json-null">$1</span>')
        // Braces/brackets
        .replace(/(\{|\})/g, '<span class="json-brace">$1</span>')
        .replace(/(\[|\])/g, '<span class="json-bracket">$1</span>')
        .replace(/,/g, '<span class="json-comma">,</span>');

      return <div key={line} dangerouslySetInnerHTML={{ __html: html }} />;
    });

  return <div className="json-viewer">{highlighted}</div>;
}
