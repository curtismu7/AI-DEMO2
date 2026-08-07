/**
 * Convert an SVG file to PNG using Chrome via Puppeteer.
 *
 * Usage:
 *   node scripts/svg2png.js <input.svg> <output.png>
 *
 * Requires Chrome at the default macOS path. Adjust CHROME_PATH if different.
 */
const puppeteer = require('/Users/cmuir/.npm/_npx/668c188756b835f3/node_modules/puppeteer-core');
const fs = require('fs');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function svgToPng(svgPath, pngPath) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; }
  body { background: #0a1628; }
  svg { display: block; }
</style></head>
<body>${svg}</body></html>`;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const svgEl = await page.$('svg');
  const box = await svgEl.boundingBox();
  await page.setViewport({
    width: Math.ceil(box.width) + 40,
    height: Math.ceil(box.height) + 40,
    deviceScaleFactor: 2,
  });
  await page.screenshot({ path: pngPath, fullPage: true });
  await browser.close();
  console.log(`Written: ${pngPath}`);
}

const [, , svgPath, pngPath] = process.argv;
if (!svgPath || !pngPath) {
  console.error('Usage: node svg2png.js <input.svg> <output.png>');
  process.exit(1);
}
svgToPng(svgPath, pngPath).catch(e => { console.error(e.message); process.exit(1); });
