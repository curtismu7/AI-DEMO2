#!/usr/bin/env node
'use strict';
/**
 * check-llm-models.js — fail if a hardcoded model ID appears in the BFF's
 * services/ or routes/. Model IDs live in demo_api_server/config/llmModels.js.
 * Test files are exempt (they assert on concrete IDs).
 */
const fs = require('fs');
const path = require('path');

const MODEL_LITERAL = /['"`](claude-[a-z0-9.-]+|gemini-[0-9][a-z0-9.-]*|gpt-[0-9][a-z0-9.-]*)['"`]/g;
const DIRS = ['demo_api_server/services', 'demo_api_server/routes'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
    else if (p.endsWith('.js') && !p.endsWith('.test.js')) out.push(p);
  }
  return out;
}

/** @returns {{file:string,line:number,model:string}[]} */
function findOffenders(root) {
  const hits = [];
  for (const d of DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
        for (const m of text.matchAll(MODEL_LITERAL)) hits.push({ file: path.relative(root, file), line: i + 1, model: m[1] });
      });
    }
  }
  return hits;
}

module.exports = { findOffenders };

if (require.main === module) {
  const hits = findOffenders(path.resolve(__dirname, '..'));
  if (hits.length) {
    console.error('[check-llm-models] FAILED — model IDs must live in demo_api_server/config/llmModels.js:');
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.model}`);
    process.exit(1);
  }
  console.log('[check-llm-models] OK — no hardcoded model IDs in services/ or routes/.');
}
