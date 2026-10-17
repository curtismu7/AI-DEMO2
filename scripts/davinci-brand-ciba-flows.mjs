#!/usr/bin/env node
// Brands the DaVinci CIBA flows' consent / approved / declined screens per vertical.
//
// The app prefixes the CIBA binding_message with a 2-char vertical code
// (demo_api_server/config/cibaVerticalCodes.js). Each screen reads that code in the
// browser and applies the vertical's name, tagline, logo and colors from the manifests.
//
// Usage (from repo root):
//   node scripts/davinci-brand-ciba-flows.mjs --out <dir>            # write patched flow JSON + preview data, no PingOne writes
//   node scripts/davinci-brand-ciba-flows.mjs --out <dir> --apply    # also PUT the patched flows as DRAFTS (someone must click Deploy in DaVinci)
//
// Needs (ENV_FILE=<path> overrides demo_api_server/.env, which worktrees do not have) PINGONE_WORKER_CLIENT_ID/SECRET + PINGONE_ENVIRONMENT_ID in demo_api_server/.env.
// Backs up each flow to <out>/<flowId>.backup.json before touching it.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CODES = require(path.join(root, 'demo_api_server/config/cibaVerticalCodes.js'));

const FLOWS = { 'email only': '4597119f17ad658a655d582f110c870c', 'SMS only': '6e7556ee3a831153d588bde652ca4c68' };
// consent, approved, declined (the two "failed" error screens use a different rich-text format and are left alone)
const SCREENS = { pp5o0c3t2y: 'consent', u41p8pvmfm: 'approved', g0seo3tq81: 'declined' };
const SITE = 'https://ai-demo.ping-devops.com';

const args = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
const apply = args.includes('--apply');
if (!out || out.startsWith('--')) { console.error('--out <dir> required'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

// ---- brand table from the manifests ------------------------------------------
const BRANDS = {};
for (const [vid, code] of Object.entries(CODES)) {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'demo_api_server/config/verticals', vid, 'manifest.json'), 'utf8'));
  const c = m.theme?.cssVars || {};
  BRANDS[code] = {
    n: m.identity.displayName,
    t: m.identity.tagline || '',
    l: SITE + m.identity.logoPath,
    p: c['--app-primary-red'],
    a: c['--brand-dashboard-header-start'] || c['--app-primary-red'],
    b: c['--brand-dashboard-header-end'] || c['--app-primary-red'],
    x: c['--theme-accent'] || c['--app-primary-red'],
  };
}

// ---- browser-side script (runs inside the DaVinci screen) --------------------
const SCRIPT = `(function () {
  var B = ${JSON.stringify(BRANDS)};
  var el = document.getElementById('brand-code');
  var raw = ((el && el.textContent) || '').trim();
  var b = raw.length === 8 ? B[raw.slice(0, 2)] : null;
  if (!b) return;
  function lum(h) { h = h.replace('#', ''); var r = [0, 2, 4].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2]; }
  var onP = lum(b.p) > 0.4 ? '#111111' : '#ffffff';
  var css = document.createElement('style');
  css.textContent =
    'body,.page{background-color:' + b.a + '14 !important}' +
    '.card{overflow:hidden;border:0 !important;border-radius:10px}' +
    '#brand-band{background:linear-gradient(135deg,' + b.a + ',' + b.b + ');color:#fff;text-align:center;padding:22px 16px 18px}' +
    '#brand-band .org-logo{margin:0 auto 10px}' +
    '#brand-band img{background:#fff;border-radius:12px;padding:8px;box-sizing:border-box;object-fit:contain}' +
    '#brand-name{font-size:18px;font-weight:600;letter-spacing:.2px}' +
    '#brand-tag{font-size:12px;opacity:.85;margin-top:2px}' +
    'button.approve{background:' + b.p + ' !important;color:' + onP + ' !important;border-radius:6px !important;font-weight:600}' +
    'button.decline{color:' + b.p + ' !important}' +
    'body a,body .text-description strong{color:inherit}' +
    '.icon-feedback--success,.icon-feedback__icon{color:' + b.x + ' !important}';
  document.head.appendChild(css);
  var logoBox = document.querySelector('.org-logo');
  var body = logoBox && logoBox.parentNode;
  if (body) {
    var band = document.createElement('div');
    band.id = 'brand-band';
    body.insertBefore(band, logoBox);
    band.appendChild(logoBox);
    var nm = document.createElement('div'); nm.id = 'brand-name'; nm.textContent = b.n; band.appendChild(nm);
    if (b.t) { var tg = document.createElement('div'); tg.id = 'brand-tag'; tg.textContent = b.t; band.appendChild(tg); }
    var h1 = body.querySelector('h1,.result-title'); if (h1) h1.style.marginTop = '22px';
  }
  var img = document.getElementById('brand-logo');
  if (img) { img.src = b.l; img.alt = b.n + ' logo'; }
  var app = document.getElementById('brand-app');
  if (app) app.textContent = b.n;
})();`;

// ---- patch the three screen nodes --------------------------------------------
const LOGO_IMG = /<img class="org-logo__image"/;
const CODE_SPAN = '<span id="brand-code" hidden>{{global.parameters.authorizationRequest.binding_message}}</span>';

function patchNode(data, kind) {
  const p = data.properties;
  let html = JSON.parse(p.customHTML.value);
  if (!html.includes('id="brand-code"')) {
    if (!LOGO_IMG.test(html)) throw new Error(`${data.id}: logo <img> not found`);
    html = html.replace(LOGO_IMG, `${CODE_SPAN}<img id="brand-logo" class="org-logo__image"`);
    html = html.replace('<strong>{{global.parameters.application.name}}</strong>', '<strong id="brand-app">{{global.parameters.application.name}}</strong>');
  }
  p.customHTML.value = JSON.stringify(html);
  const prior = (p.customScript?.value || '').replace(/\(function \(\) \{\n  var B = [\s\S]*?\}\)\(\);\n?/, '');
  p.customScript = { value: (prior ? prior.trimEnd() + '\n' : '') + SCRIPT };
  return kind;
}

function patchFlow(flow) {
  const touched = [];
  for (const n of flow.graphData.elements.nodes) {
    const kind = SCREENS[n.data.id];
    if (kind && n.data.capabilityName === 'customHTMLTemplate') touched.push(patchNode(n.data, kind));
  }
  if (touched.length !== 3) throw new Error(`expected 3 screens, patched ${touched.join(',')}`);
  return flow;
}

// ---- main --------------------------------------------------------------------
fs.writeFileSync(path.join(out, 'brands.json'), JSON.stringify(BRANDS, null, 2));
const env = Object.fromEntries(fs.readFileSync(process.env.ENV_FILE || path.join(root, 'demo_api_server/.env'), 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
const E = env.PINGONE_ENVIRONMENT_ID;
const tok = (await (await fetch(`https://auth.pingone.com/${E}/as/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${env.PINGONE_WORKER_CLIENT_ID}:${env.PINGONE_WORKER_CLIENT_SECRET}`).toString('base64') },
  body: 'grant_type=client_credentials',
})).json()).access_token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

for (const [label, id] of Object.entries(FLOWS)) {
  const url = `https://api.pingone.com/v1/environments/${E}/flows/${id}`;
  const flow = await (await fetch(url, { headers: H })).json();
  fs.writeFileSync(path.join(out, `${id}.backup.json`), JSON.stringify(flow, null, 2));
  const patched = patchFlow(structuredClone(flow));
  fs.writeFileSync(path.join(out, `${id}.patched.json`), JSON.stringify(patched, null, 2));
  console.log(`${label}: patched 3 screens (v${flow.currentVersion}) -> ${out}/${id}.patched.json`);
  if (apply) {
    const body = { name: patched.name, description: patched.description, settings: patched.settings, graphData: patched.graphData, trigger: patched.trigger, color: patched.color, enabled: patched.enabled, connectors: patched.connectors };
    const r = await fetch(url, { method: 'PUT', headers: H, body: JSON.stringify(body) });
    console.log(`  PUT ${r.status}`, r.ok ? '' : (await r.text()).slice(0, 300));
  }
}
