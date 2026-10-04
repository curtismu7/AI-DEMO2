'use strict';

/**
 * Edition filter. A generated edition (scripts/export-edition.js) ships
 * config/edition.json with the use-case ids it drops; the main repo ships no
 * such file, so a missing file means "drop nothing". Lives under
 * demo_api_server/config so it is visible natively, in the bind-mounted
 * container and in the image (all three carry this directory).
 */

const fs = require('node:fs');
const path = require('node:path');

const EDITION_FILE = path.join(__dirname, 'edition.json');

function loadEdition(file = EDITION_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { dropUseCases: [] };
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`edition.json is not valid JSON (${file}): ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.dropUseCases) || parsed.dropUseCases.some((id) => typeof id !== 'string')) {
    throw new Error(`edition.json: dropUseCases must be an array of strings (${file})`);
  }
  return { ...parsed, dropUseCases: parsed.dropUseCases };
}

module.exports = { loadEdition, EDITION_FILE };
