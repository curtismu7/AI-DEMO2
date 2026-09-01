'use strict';
/**
 * Resolve a NotebookLM citation back to the docs page it came from.
 *
 * `ask` returns references as { source_id, citation_number, cited_text }. The
 * source_id is the uploaded bundle, identical for every citation, so it says
 * nothing about which page was cited. ping-docs-notebook.sh writes a
 * `# source: <url>` header above every page it bundles; this module locates the
 * excerpt in the bundle and walks back to the nearest preceding header.
 *
 * Matching is on lowercase alphanumerics only. NotebookLM collapses whitespace
 * in cited_text, so exact substring matching resolves nothing at all.
 */
const fs = require('fs');
const path = require('path');

/** Probe length, in normalised characters. Measured unique at 60 and 120. */
const PROBE_LEN = 120;
/** Below this, a probe is too generic to attribute safely. */
const MIN_PROBE_LEN = 40;

/** Strip markdown link syntax, then reduce to lowercase alphanumerics. */
function normalize(text) {
  return String(text == null ? '' : text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^0-9a-zA-Z]/g, '')
    .toLowerCase();
}

/**
 * Index one bundle: its normalised text, a map from normalised offset back to
 * raw offset, and the byte offset of every `# source:` header.
 */
function buildIndex(bundleText) {
  const text = String(bundleText == null ? '' : bundleText).replace(
    /\[([^\]]*)\]\([^)]*\)/g,
    '$1',
  );

  const headers = [];
  const headerRe = /^# source: (\S+)[ \t]*$/gm;
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    headers.push({ rawOffset: m.index, url: m[1] });
  }

  let norm = '';
  const rawAt = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      norm += c.toLowerCase();
      rawAt.push(i);
    }
  }
  return { norm, rawAt, headers };
}

/** The url of the last `# source:` header at or before a raw offset. */
function urlAt(index, rawOffset) {
  let url = null;
  for (const h of index.headers) {
    if (h.rawOffset <= rawOffset) url = h.url;
    else break;
  }
  return url;
}

/**
 * Resolve one citation against one bundle index.
 * Returns null on no match, an ambiguous match, or too short a probe — a wrong
 * docs URL is worse than none.
 */
function resolveCitation(citedText, index) {
  const probe = normalize(citedText).slice(0, PROBE_LEN);
  if (probe.length < MIN_PROBE_LEN) return null;

  const first = index.norm.indexOf(probe);
  if (first === -1) return null;
  if (index.norm.indexOf(probe, first + 1) !== -1) return null;

  return urlAt(index, index.rawAt[first]);
}

/** Resolve against several bundles; a hit in more than one bundle is ambiguous. */
function resolveAgainst(citedText, indexes) {
  const hits = [];
  for (const idx of indexes) {
    const url = resolveCitation(citedText, idx);
    if (url) hits.push(url);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Read and index every *.md in a directory tree. Missing dir -> []. */
function loadIndexes(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...loadIndexes(full));
    else if (e.isFile() && e.name.endsWith('.md')) {
      try {
        out.push(buildIndex(fs.readFileSync(full, 'utf8')));
      } catch {
        // An unreadable bundle must not take the route down.
      }
    }
  }
  return out;
}

module.exports = { buildIndex, resolveCitation, resolveAgainst, loadIndexes, normalize };
