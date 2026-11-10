import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-ignore - plain ESM script shared with CI (npm run check:ui-patterns)
import {
  checkPage,
  runAll,
  loadRoutes,
  loadAllowlist,
  readPage,
  isVioletIndigo,
  violetLiterals,
  colourFunctionToRgb,
  lengthToPx,
  expandVars,
  buttonClasses,
  parseCss,
  loadGlobalTokens,
  scanColours,
  scanEscapes,
  classTokens,
  colorSpaceToRgb,
  SHARED_FILES,
} from '../../scripts/check-ui-patterns.mjs';

/**
 * Ping UI Standard ratchet: every route listed in scripts/ui-pattern-converted.txt must keep passing
 * the static pattern check (banner first, one primary button, chips carry text, no inline colour,
 * no violet/indigo or vertical colour on buttons, 10px floor). All other pages are advisory.
 * The mutation cases prove each rule can fail, so a green run is not vacuous. The shared stylesheet and
 * components are one more rule set, enforced whatever the allowlist says. End-to-end mutations (a temp copy
 * of the page and shared files, run through the real script) live in uiPatternsMutation.test.js.
 */
// Round 2 fails closed on a var() it cannot resolve, so pages are checked with the app's real token map.
const tokens = loadGlobalTokens();
const check = (page) => checkPage({ tokens, ...page });
const drifted = (results) => results.filter((r) => r.status === 'DRIFT').map((r) => r.rule);

const saasFile = loadRoutes()['/privilege-saas-access'];
const saas = readPage(saasFile);
const cssWith = (extra) => [{ file: 'x.css', css: `${saas.css[0].css}\n${extra}` }];

describe('ui pattern check', () => {
  it('every allowlisted route resolves to a page and passes all rules', () => {
    const allowlist = loadAllowlist();
    expect(allowlist.length).toBeGreaterThan(0);
    const { pages, missing } = runAll({ allowlist });
    expect(missing, 'allowlisted routes with no <Route> in App.js').toEqual([]);
    const failing = pages.filter((p) => p.enforced && p.failed.length);
    const msg = failing.map((p) => `${p.routes.join(',')} ${p.failed.map((f) => `${f.rule}: ${f.detail}`).join(' | ')}`).join('\n');
    expect(failing.length, `enforced pages drifted:\n${msg}`).toBe(0);
  });

  it('the shared stylesheet and components pass as their own rule set', () => {
    const { shared } = runAll();
    expect(shared.failed.map((f) => `${f.rule}: ${f.detail}`)).toEqual([]);
    for (const f of [...SHARED_FILES, 'src/components/pingUi/index.jsx']) expect(shared.files).toContain(f);
  });

  it('the allowlist keeps every route a merged conversion added (floor in scripts/ui-pattern-converted.floor.txt)', () => {
    const floor = loadAllowlist(path.join(__dirname, '..', '..', 'scripts', 'ui-pattern-converted.floor.txt'));
    const list = loadAllowlist();
    expect(floor.length, 'the floor file is empty').toBeGreaterThanOrEqual(43);
    expect(new Set(floor).size, 'duplicate routes in the floor file').toBe(floor.length);
    expect(
      floor.filter((r) => !list.includes(r)),
      'routes dropped from scripts/ui-pattern-converted.txt. Restore them, or (to retire a route on purpose) delete the line from BOTH that file and ui-pattern-converted.floor.txt and say why in the PR',
    ).toEqual([]);
    expect(list.length).toBeGreaterThanOrEqual(floor.length);
  });

  it('starts with the SaaS Access page and nothing else is enforced silently', () => {
    expect(loadAllowlist()).toContain('/privilege-saas-access');
    expect(Object.keys(loadRoutes()).length).toBeGreaterThan(50);
  });

  it('the converted page passes as published', () => {
    expect(drifted(check(saas))).toEqual([]);
  });

  it('fails when a second primary button appears', () => {
    const jsx = saas.jsx.replace('className="pu-btn" onClick={reset}', 'className="pu-btn pu-btn--primary" onClick={reset}');
    expect(jsx).not.toBe(saas.jsx);
    expect(drifted(check({ jsx, css: saas.css }))).toEqual(['P9 one primary button']);
  });

  it('counts the live-check default trigger (btn-primary) as a primary', () => {
    const jsx = saas.jsx.replace('buttonClassName="pu-btn"', '');
    expect(drifted(check({ jsx, css: saas.css }))).toEqual(['P9 one primary button']);
  });

  it('fails on a chip with no text, whether StatusChip or a chip class', () => {
    const a = saas.jsx.replace('<StatusChip tone="info">Live call</StatusChip>', '<StatusChip tone="info" />');
    expect(drifted(check({ jsx: a, css: saas.css }))).toEqual(['P7 chips carry text']);
    const b = saas.jsx.replace(
      '<StatusChip tone="info">Live call</StatusChip>',
      '<span className="pu-chip pu-chip--info"><span className="pu-chip__dot" aria-hidden="true" /></span>',
    );
    expect(drifted(check({ jsx: b, css: saas.css }))).toEqual(['P7 chips carry text']);
  });

  it('fails on an indigo/violet button literal and on a vertical colour token on a button', () => {
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-x-btn { background: #4f46e5; }') }))).toEqual([
      'P9 no violet/indigo or vertical colour on buttons',
    ]);
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-x-btn { background: var(--app-primary-red); }') }))).toEqual([
      'P9 no violet/indigo or vertical colour on buttons',
    ]);
    // A non-button rule may still use a vertical colour (card edges do).
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-x-card { border-top-color: var(--app-primary-red); }') }))).toEqual([]);
  });

  it('fails on inline colour, a font under 10px, and a banner that is not first', () => {
    const inline = saas.jsx.replace('<p className="psa-justification">', '<p className="psa-justification" style={{ color: "#333" }}>');
    expect(drifted(check({ jsx: inline, css: saas.css }))).toEqual(['H3 no inline colour']);
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-tiny { font-size: 9px; }') }))).toEqual(['H2 10px font floor']);
    const noBanner = saas.jsx.replace(/<SimBanner[\s\S]*?<\/SimBanner>/, '');
    expect(drifted(check({ jsx: noBanner, css: saas.css }))).toEqual(['P2 banner first']);
  });

  it('ignores commented-out violations', () => {
    const jsx = `${saas.jsx}\n// <button className="pu-btn--primary">x</button>\n/* style={{ color: '#fff' }} */`;
    expect(drifted(check({ jsx, css: saas.css }))).toEqual([]);
  });

  it('classifies violet and indigo but not Ping blue, red or green', () => {
    expect(isVioletIndigo([0x4f, 0x46, 0xe5])).toBe(true);
    expect(isVioletIndigo([0x6d, 0x28, 0xd9])).toBe(true);
    expect(isVioletIndigo([0x12, 0x53, 0x8d])).toBe(false);
    expect(isVioletIndigo([0xd2, 0x0e, 0x0f])).toBe(false);
    expect(violetLiterals('linear-gradient(90deg, #d20e0f 55%, #aa0005)')).toEqual([]);
  });

  it('the shared stylesheet is imported once, from the entry', () => {
    const entry = fs.readFileSync(path.resolve(__dirname, '..', 'index.jsx'), 'utf8');
    expect(entry.match(/styles\/ping-ui\.css/g)).toHaveLength(1);
  });

  it('normalises hsl, hwb, oklch, oklab, lab, lch, color() and named colours before the hue test', () => {
    for (const v of [
      'hsl(250 80% 50%)',
      'hsl(250deg, 80%, 50%)',
      'hwb(260 10% 20%)',
      'oklch(0.5 0.2 285)',
      'oklab(0.5 0.1 -0.2)',
      'lab(40 40 -60)',
      'lch(40 60 300)',
      'color(srgb 0.4 0.2 0.9)',
      'plum',
      'navy',
      'linear-gradient(90deg, color-mix(in srgb, #4f46e5 60%, white), red)',
    ]) expect(violetLiterals(v), v).not.toEqual([]);
    for (const v of ['hsl(209 77% 31%)', 'hsl(250 20% 8%)', 'oklch(0.55 0.22 27)', 'lch(50 60 30)', 'red', 'var(--th-text)', 'url(violet.png)']) {
      expect(violetLiterals(v), v).toEqual([]);
    }
    expect(colourFunctionToRgb('hsl(250 80% 50%)')).toEqual([60, 25, 230]);
  });

  it('resolves var() chains through every definition and flags a vertical token in the chain', () => {
    const tokens = parseCss(':root { --a: var(--b); --b: #4f46e5; } .x { --c: var(--app-primary-red, red); }').reduce((m, r) => {
      for (const [k, v] of r.decls) m.set(k, new Set([...(m.get(k) || []), v]));
      return m;
    }, new Map());
    expect(expandVars('var(--a)', tokens).values).toEqual(['#4f46e5']);
    expect(expandVars('var(--c)', tokens).vertical).toBe(true);
    expect(expandVars('var(--nope, 9px)', tokens).values).toEqual(['9px']);
  });

  it('reads sizes in px, rem, em, pt, %, keywords, clamp/min/max/calc against the 10px floor', () => {
    expect([lengthToPx('9px'), lengthToPx('0.5rem'), lengthToPx('6pt'), lengthToPx('xx-small')]).toEqual([9, 8, 8, 9]);
    expect(lengthToPx('10px')).toBe(10);
    expect(lengthToPx('0.625rem')).toBe(10);
    expect(lengthToPx('62.5%')).toBe(10);
    expect(lengthToPx('clamp(8px, 2vw, 14px)')).toBe(8);
    expect(lengthToPx('calc(0.5rem + 1px)')).toBe(9);
    // Round 2: viewport units are judged at 375/768/1280/1920 px (2vw is 7.5px on a phone) instead of passing as unknown.
    expect(lengthToPx('2vw')).toBe(7.5);
    expect(lengthToPx('1lh')).toBeNull();
  });

  it('parses CSS nesting, @media and url() values with semicolons', () => {
    const rules = parseCss('.a { color: red; .b { color: blue } & .c { color: green } @media (x) { color: plum } background: url(data:image/png;base64,AAA); }');
    const sel = rules.map((r) => r.selector);
    expect(sel).toEqual(expect.arrayContaining(['.a', '.a .b', '.a .c']));
    expect(rules.filter((r) => r.selector === '.a').flatMap((r) => r.decls.map((d) => d[0]))).toEqual(expect.arrayContaining(['color', 'background']));
    expect(rules.flatMap((r) => r.decls).find((d) => d[0] === 'background')[1]).toBe('url(data:image/png;base64,AAA)');
  });

  it('treats a class the JSX puts on a button as a button selector, whatever it is called', () => {
    const jsx = '<button type="button" className="psa-go">Go</button><a className="btn psa-link" href="/x">x</a><div className="psa-card" />';
    expect([...buttonClasses(jsx)].sort()).toEqual(['btn', 'psa-go', 'psa-link']);
    const r = check({ jsx: saas.jsx + jsx, css: cssWith('.psa-go { background: hsl(250 80% 50%); } .psa-card { background: hsl(250 80% 50%); }') });
    expect(drifted(r)).toEqual(['P9 no violet/indigo or vertical colour on buttons']);
  });

  it('follows the font shorthand and a var() size', () => {
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-tiny { font: italic 700 9px/1.2 sans-serif; }') }))).toEqual(['H2 10px font floor']);
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-ok { font: 700 10px/1.2 sans-serif; }') }))).toEqual([]);
    expect(tokens.get('--btn-accent')).toBeTruthy();
    expect(drifted(check({ jsx: saas.jsx, css: cssWith('.psa-tiny { font-size: var(--font-size-3xs); }') }))).toEqual([]);
  });

  it('round 2: converts every color() space, white maps to white, and calc()/relative syntax resolve', () => {
    const d65 = [0.95045592705, 1, 1.08905775076];
    const d50 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
    for (const sp of ['srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020']) expect(colorSpaceToRgb(sp, [1, 1, 1]), sp).toEqual([255, 255, 255]);
    expect(colorSpaceToRgb('xyz-d65', d65)).toEqual([255, 255, 255]);
    expect(colorSpaceToRgb('xyz-d50', d50)).toEqual([255, 255, 255]);
    expect(colorSpaceToRgb('nope', [1, 1, 1])).toBeNull();
    // #4f46e5 expressed in xyz-d65 and in linear sRGB comes back as itself.
    expect(colourFunctionToRgb('color(xyz-d65 0.1955 0.117 0.7535)')).toEqual([79, 70, 229]);
    expect(colourFunctionToRgb('color(srgb-linear 0.0782 0.0612 0.7835)')?.map((v) => Math.round(v / 2))).toEqual([40, 35, 115]);
    expect(colourFunctionToRgb('hsl(calc(200 + 50) 80% 50%)')).toEqual([60, 25, 230]);
    for (const fn of ['rgb', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch']) {
      const names = { rgb: 'r g b', hsl: 'h s l', hwb: 'h w b', lab: 'l a b', lch: 'l c h', oklab: 'l a b', oklch: 'l c h' }[fn];
      const back = colourFunctionToRgb(`${fn}(from #4f46e5 ${names})`);
      expect(back?.every((v, i) => Math.abs(v - [79, 70, 229][i]) <= 1), `${fn} relative round trip ${back}`).toBe(true);
    }
    expect(colourFunctionToRgb('hsl(from red calc(h + 250) s l)')).toEqual([43, 0, 255]);
  });

  it('round 2: scanColours reports violet and unknown separately and never fails open', () => {
    expect(scanColours('color-mix(in srgb, #ff0066, #0066ff)').violet).not.toEqual([]);
    expect(scanColours('color-mix(in srgb, #d20e0f 40%, transparent)')).toEqual({ violet: [], unknown: [] });
    expect(scanColours('light-dark(#111, #fff)')).toEqual({ violet: [], unknown: [] });
    expect(scanColours('1px solid currentColor').unknown).toEqual([]);
    expect(scanColours('linear-gradient(90deg, #d20e0f 55%, #aa0005)')).toEqual({ violet: [], unknown: [] });
    expect(scanColours('var(--x)').unknown).toEqual(['var(--x)']);
    expect(scanColours('attr(data-c type(<color>))').unknown).toHaveLength(1);
    expect(scanColours('AccentColor').unknown).toEqual(['AccentColor']);
    expect(scanColours('VisitedText').violet).toEqual(['VisitedText']);
    expect(scanColours('hsl(calc(var(--h) + 1) 50% 50%)').unknown).toHaveLength(1);
    expect(scanColours('color(future-space 1 2 3)').unknown).toHaveLength(1);
    expect(scanColours('url(#4f46e5) "violet"')).toEqual({ violet: [], unknown: [] });
  });

  it('round 2: class names resolve through variables, ternaries, template literals, clsx objects and maps', () => {
    const scope = new Map([
      ['goCls', ["'psa-go'"]],
      ['map', ["{ a: 'psa-map-a', b: 'psa-map-b' }"]],
    ]);
    const toks = (attrs) => [...classTokens(attrs, scope)];
    expect(toks(' className={goCls}')).toEqual(['psa-go']);
    expect(toks(' className={ok ? goCls : "x y"}').sort()).toEqual(['psa-go', 'x', 'y']);
    expect(toks(' className={map[k]}').sort()).toEqual(['psa-map-a', 'psa-map-b']);
    expect(toks(' className={clsx("a", { b: on, "c-d": on })}').sort()).toEqual(['a', 'b', 'c-d']);
    const tpl = classTokens(' className={`psa-${unknown}`}', scope);
    expect([...tpl]).toEqual([]);
    expect(tpl.patterns.some((re) => re.test('psa-anything'))).toBe(true);
    expect(buttonClasses('function Btn(p) { return <button className={p.className} />; }\n<Btn className="x-go">Go</Btn>').has('x-go')).toBe(true);
    expect(buttonClasses('const cls = "x-go";\n<button className={cls}>Go</button>').has('x-go')).toBe(true);
    expect(buttonClasses('<button className={`x-${what}`}>Go</button>').has('x-anything')).toBe(true);
  });

  it('round 2: parseCss descends into any-case at-rules and @keyframes, reads @property and escapes, and numbers lines', () => {
    const rules = parseCss('@MEDIA (x) { .a { color: red; } }\n@KEYFRAMES k { to { font-size: 8px } }\n@property --btn-accent { syntax: "<color>"; inherits: true; initial-value: teal }\n.b {\n  b\\61 ckground: blue;\n}');
    expect(rules.map((r) => r.selector)).toEqual(['.a', '@keyframes k to', '@property --btn-accent', '.b']);
    expect(rules.find((r) => r.keyframes === 'k')).toBeTruthy();
    expect(rules.find((r) => r.selector.startsWith('@property')).decls[0].slice(0, 2)).toEqual(['--btn-accent', 'teal']);
    const b = rules.find((r) => r.selector === '.b').decls[0];
    expect(b.slice(0, 2)).toEqual(['background', 'blue']);
    expect(b[2]).toEqual({ line: 5, endLine: 5 });
  });

  it('round 2: expandVars reports undefined custom properties and honours fallbacks', () => {
    const tokens = new Map([['--a', new Set(['#fff'])]]);
    expect(expandVars('var(--a)', tokens).undef).toEqual([]);
    expect(expandVars('var(--nope)', tokens).undef).toEqual(['--nope']);
    expect(expandVars('var(--nope, 1px)', tokens).undef).toEqual([]);
    expect(expandVars('var(--app-primary-red)', tokens).undef).toEqual([]);
    expect(expandVars('var(--loop)', new Map([['--loop', new Set(['var(--loop)'])]])).undef).toEqual(['--loop']);
  });

  it('round 2: sizes are judged at 375/768/1280/1920 px with interval arithmetic', () => {
    expect(lengthToPx('1vmin')).toBe(3.75);
    expect(lengthToPx('calc(1rem + 0.5vw)')).toBeGreaterThanOrEqual(10);
    expect(lengthToPx('0')).toBe(0);
    expect(lengthToPx('max(4px, 1vw)')).toBe(4);
    expect(lengthToPx('max(var(--x), 12px)')).toBe(12);
    expect(lengthToPx('max(var(--x), 4px)')).toBeNull();
    expect(lengthToPx('1cqw')).toBeNull();
    expect(lengthToPx('calc(1px * 2 + 3px)')).toBe(5);
  });

  it('round 2: escape comments need a reason of 8+ characters', () => {
    expect(scanEscapes('/* ui-pattern: allow vertical shell sets this */')).toEqual({ ok: [{ line: 1, reason: 'vertical shell sets this' }], bad: [] });
    expect(scanEscapes('\n/* ui-pattern: allow */').bad).toEqual([{ line: 2, reason: '' }]);
    expect(scanEscapes('/* ui-pattern: allow ok */').bad).toHaveLength(1);
  });
});

describe('ui pattern check: the route loader follows wrappers to the real page', () => {
  const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
  /** A throwaway src/ tree: App.js, routes/ wrappers and a few pages. */
  const tree = (files) => {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ui-loader-'));
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), text);
    }
    return root;
  };
  const WRAPPERS = `import lazyWithRetry from "../utils/lazyWithRetry";
import AppShell from "./AppShell";
import { InspectorFieldProvider } from "../context/InspectorFieldContext";
import GatewayInspector from "../components/GatewayInspector";
const AlphaPage = lazyWithRetry(() => import("../pages/AlphaPage"));
const BetaPage = lazyWithRetry(() => import("../pages/BetaPage"));
export function AlphaPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <AlphaPage />
    </AppShell>
  );
}
export function BetaPageRoute({ user, logout }) {
  return <AlphaOuterRoute user={user} />;
}
export function AlphaOuterRoute({ user }) {
  return <AppShell><BetaPage /></AppShell>;
}
export function GatewayRoute({ user, logout }) {
  return (
    <InspectorFieldProvider>
      <AppShell user={user} logout={logout}>
        <GatewayInspector />
      </AppShell>
    </InspectorFieldProvider>
  );
}
`;
  const APP = `import lazyWithRetry from "./utils/lazyWithRetry";
import { AlphaPageRoute, BetaPageRoute, GatewayRoute } from "./routes/PublicRoutes";
import RequireAdminLogin from "./routes/RequireAdminLogin";
import SignInRequired from "./routes/SignInRequired";
const Direct = lazyWithRetry(() => import("./pages/DirectPage"));
const r = (
  <Routes>
    <Route path="/alpha" element={<AlphaPageRoute user={user} logout={logout} />} />
    <Route path="/beta" element={<BetaPageRoute user={user} logout={logout} />} />
    <Route path="/gateway" element={<GatewayRoute user={user} logout={logout} />} />
    <Route path="/gated" element={loading ? null : user ? (<AlphaPageRoute user={user} />) : (<SignInRequired />)} />
    <Route path="/admin-only" element={<RequireAdminLogin user={user}><BetaPageRoute user={user} /></RequireAdminLogin>} />
    <Route path="/only-gate" element={<SignInRequired />} />
    <Route path="/direct" element={<AppShell><Direct /></AppShell>} />
  </Routes>
);
`;
  const FILES = {
    'src/App.js': APP,
    'src/routes/PublicRoutes.js': WRAPPERS,
    'src/routes/SignInRequired.js': 'export default function SignInRequired() { return null; }\n',
    'src/routes/RequireAdminLogin.js': 'export default function RequireAdminLogin() { return null; }\n',
    'src/pages/AlphaPage.jsx': 'export default function AlphaPage() { return null; }\n',
    'src/pages/BetaPage.jsx': 'export default function BetaPage() { return null; }\n',
    'src/pages/DirectPage.jsx': 'export default function DirectPage() { return null; }\n',
    'src/components/GatewayInspector.jsx': 'export default function GatewayInspector() { return null; }\n',
  };

  it('a named routes/ wrapper resolves to the page it renders', () => {
    const root = tree(FILES);
    const r = loadRoutes(root);
    expect(rel(root, r['/alpha'])).toBe('src/pages/AlphaPage.jsx');
    expect(rel(root, r['/gateway'])).toBe('src/components/GatewayInspector.jsx');
  });

  it('follows a wrapper that renders another wrapper of the same module', () => {
    const r = loadRoutes(tree(FILES));
    expect(path.basename(r['/beta'])).toBe('BetaPage.jsx');
  });

  it('a page behind SignInRequired or RequireAdminLogin resolves to the real page, not the gate', () => {
    const r = loadRoutes(tree(FILES));
    expect(path.basename(r['/gated'])).toBe('AlphaPage.jsx');
    expect(path.basename(r['/admin-only'])).toBe('BetaPage.jsx');
  });

  it('keeps the old result when nothing better resolves, and for direct components', () => {
    const r = loadRoutes(tree(FILES));
    expect(path.basename(r['/only-gate'])).toBe('SignInRequired.js');
    expect(path.basename(r['/direct'])).toBe('DirectPage.jsx');
  });

  it('a wrapper whose page cannot be found is skipped, not guessed', () => {
    const root = tree({ ...FILES, 'src/routes/PublicRoutes.js': WRAPPERS.replace('<AlphaPage />', '<Missing />') });
    const r = loadRoutes(root);
    expect(r['/alpha']).toBeUndefined();
  });

  it('the real App.js resolves the /ai-products destinations that used to be missing', () => {
    const r = loadRoutes();
    const want = {
      '/intent-binding-learning': 'pages/IntentBindingLearningPage',
      '/a2a-protocol-learning': 'pages/A2AProtocolLearningPage',
      '/privilege-mcp-learning': 'pages/PrivilegeMcpLearningPage',
      '/agent-gateway-inspector': 'components/AgentGatewayInspectorClean',
      '/llm-gateway': 'pages/LlmGatewayCombinedPage',
      '/llm-test': 'pages/LlmGatewayCombinedPage',
      '/use-cases/live': 'pages/LiveUseCaseWorkbenchPage',
      '/intent-inspector': 'pages/IntentInspectorPage',
    };
    for (const [route, page] of Object.entries(want)) expect(r[route], route).toContain(`src/${page}.`);
    // chrome and guards are never the page
    expect(r['/academy/:lessonId']).not.toMatch(/TopNav/);
    expect(r['/davinci-widget']).not.toMatch(/PingOneProviderGuard/);
  });

  it('the real App.js resolves / and /welcome to the landing page, /dashboard to the user dashboard, /admin to Dashboard', () => {
    const r = loadRoutes();
    expect(r['/']).toContain(path.join('src', 'components', 'LandingPage.'));
    expect(r['/welcome']).toContain(path.join('src', 'components', 'LandingPage.'));
    expect(r['/dashboard']).toContain(path.join('src', 'components', 'UserDashboardPing2026.'));
    expect(r['/admin']).toContain(path.join('src', 'components', 'Dashboard.'));
    expect(r['/demo/:shellSlug']).toContain(path.join('src', 'pages', 'FootprintLiveShellPage.'));
    // chrome is never the page, for any route
    for (const [route, file] of Object.entries(r)) expect(path.basename(file), route).not.toMatch(/^(?:TopNav|AppShell|ErrorBoundary)\./);
  });

  it('chrome next to the page is skipped, and the first entry that resolves to a page wins a shared path', () => {
    const root = tree({
      'src/App.js': `import lazyWithRetry from "./utils/lazyWithRetry";
import TopNav from "./components/TopNav";
import ErrorBoundary from "./components/ErrorBoundary";
import Landing from "./components/Landing";
import Dashboard from "./components/Dashboard";
import { DashContent } from "./routes/CustomerRoutes";
import RequireAdminLogin from "./routes/RequireAdminLogin";
const r = (
  <Routes>
    <Route path="/" element={<><TopNav /><main><Landing /></main></>} />
    <Route path="/dash" element={<><TopNav /><main><DashContent /></main></>} />
    <Route path="/boundary" element={<><TopNav /><ErrorBoundary><Landing /></ErrorBoundary></>} />
    <Route path="/nav-only" element={<><TopNav /></>} />
    <Route path="*" element={<><TopNav /><Routes>
      <Route path="/" element={user ? <Dashboard /> : <Landing />} />
      <Route path="/admin" element={<RequireAdminLogin><Dashboard /></RequireAdminLogin>} />
    </Routes></>} />
  </Routes>
);
`,
      'src/routes/CustomerRoutes.js': `const UserDash = lazyWithRetry(() => import("../components/UserDash"));
export function DashContent({ user }) { return <UserDash user={user} />; }
`,
      'src/routes/RequireAdminLogin.js': 'export default function RequireAdminLogin() { return null; }\n',
      ...Object.fromEntries(['TopNav', 'ErrorBoundary', 'Landing', 'Dashboard', 'UserDash'].map((n) => [`src/components/${n}.js`, `export default function ${n}() { return null; }\n`])),
    });
    const r = loadRoutes(root);
    expect(rel(root, r['/'])).toBe('src/components/Landing.js');
    expect(rel(root, r['/dash'])).toBe('src/components/UserDash.js');
    expect(rel(root, r['/boundary'])).toBe('src/components/Landing.js');
    expect(rel(root, r['/admin'])).toBe('src/components/Dashboard.js');
    expect(r['/nav-only'], 'TopNav alone is chrome, not a page').toBeUndefined();
  });

  it('the newly resolvable routes are advisory, never enforced by accident', () => {
    const { pages } = runAll();
    // '/dashboard' was resolved to Dashboard.js and TopNav.js before the loader skipped chrome and took the first entry
    // per path. It is converted now (and enforced, see the allowlist), as are '/' and '/welcome'; the routes below are
    // not, so they may not be on the allowlist by accident.
    for (const route of ['/agent-gateway-inspector', '/llm-gateway', '/llm-test']) {
      const page = pages.find((p) => p.routes.includes(route));
      expect(page, route).toBeTruthy();
      expect(page.enforced, route).toBe(false);
    }
  });
});
