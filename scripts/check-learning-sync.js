#!/usr/bin/env node
'use strict';
/**
 * check-learning-sync.js — the Jev demo gallery lives in four places that must
 * name the same demos, and nothing made them agree:
 *   jevDemoContent.js  GALLERY (the demo list) and ARTICLES (each demo's body)
 *   AdminSideNav.jsx   a /jev-demos/<id> link per demo
 *   docs/reference/jev-demo-urls.md   the live-URL list
 * GALLERY is the source of truth; every other surface must list exactly its ids.
 */
const fs = require('fs');
const path = require('path');

const CONTENT = 'demo_api_ui/src/pages/jevDemoContent.js';
const NAV = 'demo_api_ui/src/components/AdminSideNav.jsx';
const DOC = 'docs/reference/jev-demo-urls.md';

const ids = (src, re) => new Set([...src.matchAll(re)].map((m) => m[1]));

/** @returns {string[]} one human-readable problem per mismatch */
function checkJevSync({ contentSrc, navSrc, docSrc }) {
  const galleryBlock = contentSrc.slice(contentSrc.indexOf('export const GALLERY'), contentSrc.indexOf('\n];'));
  const articlesStart = contentSrc.indexOf('export const ARTICLES');
  const articlesBlock = contentSrc.slice(articlesStart, contentSrc.indexOf('\n};', articlesStart));

  const gallery = ids(galleryBlock, /\{ id: '([^']+)'/g);
  const surfaces = [
    ['ARTICLES in jevDemoContent.js', ids(articlesBlock, /^ {2}'?([a-z][a-z0-9-]*)'?: \{/gm)],
    ['AdminSideNav.jsx', ids(navSrc, /"\/jev-demos\/([a-z][a-z0-9-]*)"/g)],
    ['docs/reference/jev-demo-urls.md (jev-demo-urls)', ids(docSrc, /\/jev-demos\/([a-z][a-z0-9-]*)/g)],
  ];

  const problems = [];
  for (const [name, found] of surfaces) {
    for (const id of gallery) if (!found.has(id)) problems.push(`"${id}" is in GALLERY but missing from ${name}`);
    for (const id of found) if (!gallery.has(id)) problems.push(`"${id}" is in ${name} but not in GALLERY`);
  }
  return problems;
}

module.exports = { checkJevSync };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const problems = checkJevSync({ contentSrc: read(CONTENT), navSrc: read(NAV), docSrc: read(DOC) });
  if (problems.length) {
    console.error('[check-learning-sync] FAILED — the Jev gallery surfaces disagree:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('[check-learning-sync] OK — GALLERY, ARTICLES, AdminSideNav and jev-demo-urls.md list the same demos.');
}
