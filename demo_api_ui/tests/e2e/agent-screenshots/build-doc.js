// demo_api_ui/tests/e2e/agent-screenshots/build-doc.js
// Assembles README.md from every __screenshots__/<vertical>/manifest.json.
// Each chip becomes one comparison row: the 4 mode screenshots side by side.
// Skipped cells show WHY (provider unconfigured / chip disabled / no response).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '__screenshots__');
const MODE_ORDER = ['llamacpp', 'claude', 'helix_google', 'gemini'];
const MODE_LABEL = { llamacpp: 'llama.cpp', claude: 'Claude', helix_google: 'Helix', gemini: 'Google Gemini' };

function loadManifests() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT)
    .map((v) => path.join(ROOT, v, 'manifest.json'))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));
}

// Skip reasons can include a chip's `title` attribute (uncontrolled text); a
// stray `|` or newline would corrupt the markdown table row, so neutralize them.
function safeReason(reason) {
  return String(reason || 'unavailable').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

function cellFor(row, modeId) {
  const cell = row.cells.find((c) => c.modeId === modeId);
  if (!cell) return '_no data_';
  if (cell.skipped) return `_skipped: ${safeReason(cell.reason)}_`;
  return `![${modeId}](__screenshots__/${cell.file.split(path.sep).join('/')})`;
}

function build() {
  const manifests = loadManifests();
  const skipped = [];
  let md = '# Agent UI Response — 4-Mode Screenshot Comparison\n\n';
  md += 'Real-UI (no mock) captures of the agent response per use-case chip, across four LLM modes.\n\n';
  md += `Modes: ${MODE_ORDER.map((m) => MODE_LABEL[m]).join(' - ')}\n\n`;

  for (const man of manifests) {
    md += `## ${man.vertical}\n\n`;
    md += `| Chip | ${MODE_ORDER.map((m) => MODE_LABEL[m]).join(' | ')} |\n`;
    md += `| --- | ${MODE_ORDER.map(() => '---').join(' | ')} |\n`;
    for (const row of man.rows) {
      const cells = MODE_ORDER.map((m) => {
        const c = row.cells.find((x) => x.modeId === m);
        if (c && c.skipped) skipped.push(`${man.vertical} / ${row.chipId} / ${MODE_LABEL[m]} — ${c.reason || 'unavailable'}`);
        return cellFor(row, m);
      });
      md += `| **${row.chipLabel}** | ${cells.join(' | ')} |\n`;
    }
    md += '\n';
  }

  if (skipped.length) {
    md += '## Skipped cells (mode unavailable at capture time)\n\n';
    for (const s of skipped) md += `- ${s}\n`;
    md += '\n';
  }

  fs.writeFileSync(path.join(__dirname, 'README.md'), md);
  console.log(`Wrote README.md — ${manifests.length} vertical(s), ${skipped.length} skipped cell(s)`);
}

build();
