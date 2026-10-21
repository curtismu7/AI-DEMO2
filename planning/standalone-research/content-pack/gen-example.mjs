// Builds id-jag.pack.json from the ID-JAG kit's REAL data files (read only) and validates it against the schema.
import fs from 'node:fs'; import { createRequire } from 'node:module'; import { execFileSync } from 'node:child_process';
const KIT = '/Users/cmuir/Development/id-jag-standalone';
const require = createRequire('/Users/cmuir/Development/AI-DEMO2/package.json');
const Ajv = require('ajv/dist/2020');
const terms = JSON.parse(fs.readFileSync(`${KIT}/web/src/data/terms.json`, 'utf8'));
const sources = JSON.parse(fs.readFileSync(`${KIT}/web/src/data/sources.json`, 'utf8'));
const commit = execFileSync('git', ['-C', KIT, 'rev-parse', 'main']).toString().trim();
// from web/src/pages/GuidesPage.jsx GUIDES and web/src/utils/idJagPlaygroundDiagrams.js modes (mock, pf-as, pf-pf, byo)
const guides = [['pf-issuer','PingFederate as the ID-JAG issuer'],['pf-redeemer','PingFederate as the redeemer'],['okta','Okta Cross App Access'],['generic','Any other IdP: the ID-JAG checklist'],['xaa','Use xaa.dev (IdenX) as a free outside IdP'],['desktop','Use mcpc or VS Code as the client']];
const modes = [['mock','Mock'],['pf-as','pf-as'],['pf-pf','pf-pf'],['byo','byo']];
const pack = {
  schema: 'demo-content-pack/1', id: 'id-jag', title: 'ID-JAG', version: '0.1.0',
  source: { repo: 'cmuir_pingcorp/id-jag-standalone', commit, generated: new Date().toISOString().slice(0,10) },
  demo: { id: 'id-jag-standalone', name: 'ID-JAG playground', catalog: 'C1', baseUrl: 'http://localhost:5173', doctor: '/api/doctor', tags: ['tokens','pingfederate','mcp'] },
  glossary: terms,
  sources,
  cards: [
    ...guides.map(([id,t]) => ({ id: `guide-${id}`, label: t, group: 'setup', action: { type: 'route', href: `/guides#${id}` } })),
    { id: 'playground', label: 'ID-JAG Playground', description: 'The flow one step at a time, with every request, response and the code behind it.', group: 'try-it', action: { type: 'route', href: '/' }, terms: ['id-jag','token-exchange','jwt-bearer-grant'], story: 'S11' },
    { id: 'trusted-idps', label: 'Trusted IdPs', description: 'Register your IdP so the resource authorization server accepts its ID-JAGs.', group: 'try-it', action: { type: 'route', href: '/trusted-idps' }, terms: ['resource-authorization-server'] },
    { id: 'inspector', label: 'Inspector', description: 'Check an ID-JAG against the draft and the trust registry.', group: 'try-it', action: { type: 'route', href: '/inspect' }, terms: ['jti-replay','strict-client-binding'] },
  ],
  diagrams: modes.map(([m,l]) => ({ id: `flow-${m}`, label: `${l} diagram`, href: `/diagram/${m}`, mode: m })),
  stories: [{ id: 'S11', title: 'Lena from Acme reads a shared dataset', say: 'No shared passwords, no duplicate accounts, and we still decide.', file: 'stories/S11.json' }],
};
const ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
const validate = ajv.compile(JSON.parse(fs.readFileSync(new URL('./content-pack.schema.json', import.meta.url))));
// cross-reference checks the schema cannot express
const termIds = new Set(pack.glossary.map(t=>t.id)), storyIds = new Set(pack.stories.map(s=>s.id)), problems = [];
for (const c of pack.cards) { for (const t of c.terms||[]) if(!termIds.has(t)) problems.push(`card ${c.id}: unknown term ${t}`); if (c.story && !storyIds.has(c.story)) problems.push(`card ${c.id}: unknown story ${c.story}`); }
const ok = validate(pack);
console.log('schema valid:', ok, ok ? '' : JSON.stringify(validate.errors)); console.log('cross-refs:', problems.length ? problems : 'ok');
console.log('counts', { terms: pack.glossary.length, sources: pack.sources.length, cards: pack.cards.length, diagrams: pack.diagrams.length });
fs.writeFileSync(new URL('./id-jag.pack.json', import.meta.url), JSON.stringify(pack, null, 2) + '\n');
