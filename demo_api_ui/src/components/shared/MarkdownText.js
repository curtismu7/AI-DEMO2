// MarkdownText.js — shared inline markdown renderer
// Supports: **bold**, *italic*, `code`, # headings, - bullet lists, numbered lists, ---
// Also auto-links references to "RFC NNNN" (with optional §section) when present in RFC_LINKS.
import React from 'react';
import RfcLink from './RfcLink';
import { RFC_LINKS } from '../../config/rfcLinks';

// Matches "RFC 8693" or "RFC 8693 §3.1" — number is captured, optional section follows.
const RFC_PATTERN = /\b(RFC\s+\d{3,5})(\s+§[\d.]+)?\b/g;

function renderRfcRuns(text, keyPrefix) {
  if (!text || !RFC_PATTERN.test(text)) return text;
  RFC_PATTERN.lastIndex = 0;
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  while ((m = RFC_PATTERN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const rfcKey = m[1].replace(/\s+/, '_'); // "RFC 8693" → "RFC_8693"
    const section = m[2] ? m[2].trim() : undefined;
    if (RFC_LINKS[rfcKey]) {
      out.push(<RfcLink key={`${keyPrefix}-rfc-${i++}`} rfc={rfcKey} section={section} />);
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders a single run of text with inline markdown tokens:
 * **bold**, *italic*, `code`, plus auto-linked `RFC NNNN` references.
 */
export function InlineMd({ text }) {
  if (!text) return null;
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.startsWith('**') && tok.endsWith('**'))
          return <strong key={i}>{renderRfcRuns(tok.slice(2, -2), `b${i}`)}</strong>;
        if (tok.startsWith('*') && tok.endsWith('*'))
          return <em key={i}>{renderRfcRuns(tok.slice(1, -1), `i${i}`)}</em>;
        if (tok.startsWith('`') && tok.endsWith('`'))
          return <code key={i} className="md-inline-code" style={{ background: 'rgba(0,0,0,0.08)', borderRadius: 3, padding: '0 3px' }}>{tok.slice(1, -1)}</code>;
        const linked = renderRfcRuns(tok, `t${i}`);
        return Array.isArray(linked) ? <React.Fragment key={i}>{linked}</React.Fragment> : <React.Fragment key={i}>{linked}</React.Fragment>;
      })}
    </>
  );
}

/**
 * Renders a block of markdown text with:
 * - Paragraphs (double newline)
 * - Headings (#, ##, ###)
 * - Horizontal rules (---)
 * - Unordered lists (- item)
 * - Ordered lists (1. item)
 * - Inline bold/italic/code per line
 *
 * @param {string}  text
 * @param {string}  [className]   wrapper className
 * @param {boolean} [isEvent]     apply event variant styling
 */
export function MarkdownContent({ text, className = '', isEvent = false }) {
  if (!text) return null;

  const baseClass = ['md-content', isEvent ? 'md-content--event' : '', className]
    .filter(Boolean).join(' ');

  // Split into blocks on double newline
  const blocks = text.split(/\n{2,}/);

  return (
    <div className={baseClass}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');

        // Detect list block: all non-empty lines start with "- " or "N. "
        const isBulletList = lines.every(l => !l.trim() || /^[-*]\s/.test(l.trim()));
        const isOrderedList = lines.every(l => !l.trim() || /^\d+\.\s/.test(l.trim()));

        if (isBulletList && lines.some(l => l.trim())) {
          return (
            <ul key={bi} className="md-list md-list--ul">
              {lines.filter(l => l.trim()).map((l, li) => (
                <li key={li} className="md-list-item">
                  <InlineMd text={l.replace(/^[-*]\s+/, '')} />
                </li>
              ))}
            </ul>
          );
        }

        if (isOrderedList && lines.some(l => l.trim())) {
          return (
            <ol key={bi} className="md-list md-list--ol">
              {lines.filter(l => l.trim()).map((l, li) => (
                <li key={li} className="md-list-item">
                  <InlineMd text={l.replace(/^\d+\.\s+/, '')} />
                </li>
              ))}
            </ol>
          );
        }

        // Single-line blocks
        if (lines.length === 1) {
          const line = lines[0];
          const hrMatch = /^---+$/.test(line.trim());
          if (hrMatch) return <hr key={bi} className="md-hr" />;

          const h3 = line.match(/^###\s+(.*)/);
          if (h3) return <h3 key={bi} className="md-h3"><InlineMd text={h3[1]} /></h3>;
          const h2 = line.match(/^##\s+(.*)/);
          if (h2) return <h2 key={bi} className="md-h2"><InlineMd text={h2[1]} /></h2>;
          const h1 = line.match(/^#\s+(.*)/);
          if (h1) return <h1 key={bi} className="md-h1"><InlineMd text={h1[1]} /></h1>;
        }

        // Normal paragraph
        return (
          <p key={bi} className="md-para">
            {lines.map((line, li) => {
              // heading inside multi-line paragraph
              const h3 = line.match(/^###\s+(.*)/);
              if (h3) return <React.Fragment key={li}>{li > 0 && <br />}<strong><InlineMd text={h3[1]} /></strong></React.Fragment>;
              const h2 = line.match(/^##\s+(.*)/);
              if (h2) return <React.Fragment key={li}>{li > 0 && <br />}<strong><InlineMd text={h2[1]} /></strong></React.Fragment>;
              const h1 = line.match(/^#\s+(.*)/);
              if (h1) return <React.Fragment key={li}>{li > 0 && <br />}<strong><InlineMd text={h1[1]} /></strong></React.Fragment>;

              return (
                <React.Fragment key={li}>
                  {li > 0 && <br />}
                  <InlineMd text={line} />
                </React.Fragment>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
