#!/usr/bin/env node
/**
 * Static check of a routed page against the Ping UI Standard (AI-DEMO-Standalone/shared/
 * STANDALONE-UI-PATTERNS.md, re-created for this app in docs/ping-ui-primitives.md). Mirrors
 * AI-DEMO-Standalone/scripts/check-ui-patterns.sh.
 *
 * Two rule sets:
 *
 *   1. SHARED (always enforced, regardless of the allowlist): src/styles/ping-ui.css, EVERY file under
 *      src/components/pingUi/ (recursive; .js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts and .css are scanned, .md/.txt
 *      are inert, any other file or a symlink FAILS the run because the scanner cannot read it), and the shared
 *      children that converted pages mount (components/privilege/PrivilegeLiveCheck.jsx/.css), listed in
 *      SHARED_FILES. One edit there reaches every converted page, so it is scanned once, on its own.
 *
 *   2. PAGE, per routed page (the page's JSX, the stylesheets it imports following @import, CSS-modules
 *      `composes ... from` and import()/require(), and any <style> block or styled/css tagged template in it):
 *        P2   the simulation banner comes first: before the title band and before any section/card/button
 *        P9   exactly one primary button per view (a PrivilegeLiveCheck without buttonClassName is one)
 *        P2   the banner has text (an empty <SimBanner> is no banner), and the banner and every button sit INSIDE the
 *             <PingPage> root: a page with no <PingPage> fails, and so does a banner or button beside it in the
 *             same `return` (JSX built into a variable, or in a child component, is not judged: the parent mounts it)
 *        P9   a primary button inside a .map()/.flatMap()/.forEach()/Array.from() callback repeats per item, so it
 *             is more than one primary (unless its class is conditional, e.g. the selected tab)
 *        P7   every status chip has text (never a bare dot; {""}, {" "}, {null}, &nbsp;, a variable that is only ever
 *             blank, and an icon/glyph/dot-named variable are not text)
 *        H3   no inline colour literal and no style={{ color/background/border/fontSize... }} on themeable
 *             props (camelCase, kebab-case and quoted keys, style={identifier} resolved in the file, style="..."
 *             strings, computed keys, el.style.x = ... assignments, inline --btn-accent* and --font-size-* overrides)
 *        H3   also: el.setAttribute('style', ...) and a button whose style={{ ...spread }} cannot be read
 *        P9   no violet/indigo/purple colour, and no vertical colour token, on a button rule in CSS, and no
 *             violet/indigo utility class (bg-indigo-600, text-violet-500, bg-[#6d28d9]) on a button in JSX
 *        P9   a button colour that cannot be resolved (calc() that does not reduce, an unknown or undefined
 *             var(), attr()/env(), an OS-tinted system colour, an unsupported colour syntax) FAILS: unknown is
 *             drift, not a pass. Only recognised safe keywords (transparent, currentColor, inherit, initial,
 *             unset, revert, none) and tokens that resolve to a non-violet colour pass.
 *        P9   --btn-accent* may not be redefined to violet/indigo, a vertical token or an unresolvable value in
 *             ANY scanned stylesheet (page, imported, shared, @property initial-value, inline style)
 *        H2   no font size below 10px (font-size and the font shorthand; px rem em pt pc in cm mm q % ex ch,
 *             vw vh vmin vmax and their s/l/d variants judged at 375, 768, 1280 and 1920 px viewports, keywords,
 *             unitless 0, clamp/min/max/calc by interval arithmetic, var() chains); a size that cannot be
 *             resolved FAILS the same way; --font-size-* tokens obey the same floor in every scanned stylesheet
 *
 * What counts as a button rule: a selector that names a <button>, [type=button|submit|reset], [role=button],
 * any name containing "button"/"btn", any class the scanned JSX puts on a button (a <button>, a *Button/*Btn
 * component, a component defined in the same file that renders a button, role="button", <input type=submit>,
 * as="button", React.createElement('button'), an element with a btn-style class, buttonClassName), with the
 * className resolved through template literals, ternaries, clsx/cn/classNames calls, object maps and
 * variables assigned in the file; and, when the page contains a button at all, ANY selector whose subject has no
 * class to rule it out: #id, [attr], pseudo-class-only, :is()/:where() alternatives, structural selectors,
 * `*` and element selectors for button/summary. @keyframes used by a button rule count as button rules.
 *
 * What counts as violet/indigo: any colour whose hue is 235-300 deg with HSL saturation above 20% and chroma
 * >= 0.12 (so near-black and near-white ink is not flagged; Ping blue #12538d is hue 209): hex, rgb, hsl, hwb,
 * lab, lch, oklab, oklch, color() in srgb, srgb-linear, display-p3, a98-rgb, prophoto-rgb, rec2020, xyz,
 * xyz-d50, xyz-d65, named and system colours, calc() inside the colour functions, relative-colour syntax,
 * light-dark() (both branches) and color-mix() (both inputs and the mixed result, in srgb and oklab), reached
 * through any var() chain (all definitions of a custom property in the scanned CSS, src/index.css and
 * src/styles/ are considered).
 *
 * Escape hatch (CSS only, unknown values only): a comment `/* ui-pattern: allow <reason of 8+ characters> *\/`
 * on the declaration's line or the line above lets an UNRESOLVABLE colour or size through. It never excuses a
 * colour that resolves to violet or a vertical token, or a size that resolves under 10px. Every escape is listed in
 * the report (a "ui-pattern escapes" INFO row, printed under its page); one without a reason is itself drift.
 *
 * Advisory by default: it reports every routed page and exits 0 for them. It ENFORCES (exit 1) for the
 * routes listed in scripts/ui-pattern-converted.txt, for a listed route that no longer resolves, and
 * ALWAYS for the shared set. Convert a page, then add its route to that file in the same PR.
 *
 * It is a static heuristic, not a renderer. It still cannot see: a banner or button rendered by a child
 * component outside the scanned shared set (the unscanned children an enforced page imports are listed as
 * INFO, and their own stylesheets are not read); a button whose class only comes from an imported component,
 * a prop (className={props.x}) or a spread; a colour or size set at runtime (the vertical's inline
 * --app-primary-red, a skin, the CDN theme, el.style from a helper, setProperty on a variable, a style element
 * or stylesheet built or loaded from JS, <link> stylesheets); `inherit`/`currentColor` take the parent's
 * value, which is not known (accepted as safe keywords); colours inside url()/data URIs and strings;
 * transforms, zoom and filters that shrink or recolour text; em/% sizes are taken against a 16px parent and
 * rem against 16px unless a scanned stylesheet sets the html/:root size; container-query (cq*), lh/cap/ic units
 * and trigonometric calc() functions are reported as unknown; global rules in src/index.css and the other
 * src/styles files beyond their custom properties are not scanned (only ping-ui.css is). scss/less sources
 * fail the page rather than passing unseen. A clean run means "none of these patterns found", not "the page
 * is right"; the browser check in light, dark and 375px still applies.
 *
 *   node scripts/check-ui-patterns.mjs                 report all routed pages, enforce allowlist + shared
 *   node scripts/check-ui-patterns.mjs --strict        enforce every page
 *   node scripts/check-ui-patterns.mjs --route /x      details for one route
 *   node scripts/check-ui-patterns.mjs --verbose       details for every page
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UI_ROOT = path.resolve(HERE, '..');
export const ALLOWLIST = path.join(HERE, 'ui-pattern-converted.txt');

/** Scanned once, as their own rule set, whatever the allowlist says (paths relative to the UI root). */
export const SHARED_FILES = [
  'src/styles/ping-ui.css',
  'src/components/privilege/PrivilegeLiveCheck.jsx',
  'src/components/privilege/PrivilegeLiveCheck.css',
];
/** Every file under these directories (recursively) is shared too; a file the scanner cannot read fails the run. */
export const SHARED_DIRS = ['src/components/pingUi'];
/** Global custom-property sources, used to resolve var() chains. */
const TOKEN_FILES = ['src/index.css'];
const TOKEN_DIRS = ['src/styles'];

const SCRIPT_EXT = /\.(?:[cm]?[jt]sx?)$/i;
const CSS_EXT = /\.css$/i;
const INERT_EXT = /\.(?:md|txt)$/i;
const UNREADABLE_STYLE = /\.(?:scss|sass|less|styl|stylus|pcss|postcss)$/i;

const ESC_RULE = 'ui-pattern escapes';

// ---------- source helpers ----------

/** Remove JS/JSX comments (block and line) without touching `//` inside URLs or strings. `/* ui-pattern: ...` comments are kept. */
export function stripJsComments(src) {
  return src
    .replace(/\/\*(?!\s*ui-pattern:)[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\\w])\/\/[^\n]*/g, (m, pre) => pre);
}

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Index just after the quote that closes the string/template starting at `i`. */
function skipQuoted(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') j += 2;
    else if (c === q) return j + 1;
    else if (q === '`' && c === '$' && src[j + 1] === '{') j = closeBracket(src, j + 1);
    else j += 1;
  }
  return src.length;
}

/** Index just after the bracket that closes the one opening at `i` (strings and templates are skipped). */
function closeBracket(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; ) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipQuoted(src, j);
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return src.length;
}

/** Read one JSX tag starting at `i` (src[i] === '<'): returns { name, attrs, end, selfClosing }. */
function readTag(src, i) {
  const nm = /^<([A-Za-z][\w.]*)/.exec(src.slice(i, i + 80));
  if (!nm) return null;
  let j = i + nm[0].length;
  let depth = 0;
  let quote = null;
  for (; j < src.length; j += 1) {
    const c = src[j];
    if (quote) {
      if (c === quote && src[j - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'" || (c === '`' && depth > 0)) quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) break;
  }
  const attrs = src.slice(i + nm[0].length, j);
  const selfClosing = /\/\s*$/.test(attrs);
  return { name: nm[1], attrs, end: j + 1, selfClosing };
}

/** Inner source of a non-self-closing element that opened with `tag` (matching same-name nesting). */
function readInner(src, tag) {
  let depth = 1;
  const re = new RegExp(`<(/?)${tag.name.replace('.', '\\.')}(?=[\\s>/])`, 'g');
  re.lastIndex = tag.end;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) depth -= 1;
    else {
      const t = readTag(src, m.index);
      if (t && !t.selfClosing) depth += 1;
    }
    if (depth === 0) return src.slice(tag.end, m.index);
  }
  return src.slice(tag.end);
}

function eachTag(src, fn) {
  for (let i = src.indexOf('<'); i !== -1; i = src.indexOf('<', i + 1)) {
    const t = readTag(src, i);
    if (t) fn(t, i);
  }
}

// ---------- className resolution ----------

/** End of the expression that starts at `i`: `;`, a closing bracket, or a newline that does not continue it. */
function readExprEnd(src, i, stopAtComma = false) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipQuoted(src, j);
      continue;
    }
    if (c === '{' || c === '(' || c === '[') {
      j = closeBracket(src, j);
      continue;
    }
    if (c === ';' || c === '}' || c === ')' || c === ']' || (stopAtComma && c === ',')) break;
    if (c === '\n') {
      const prev = src.slice(i, j).trimEnd().slice(-1);
      const next = (/^\s*(\S)/.exec(src.slice(j + 1, j + 200)) || [])[1] || '';
      const continues = (prev && '?:+-*/&|.,=<>'.includes(prev)) || (next && '?:+*/&|.'.includes(next));
      if (!continues) break;
    }
    j += 1;
  }
  return j;
}

/** name -> [source of every value assigned to it]: const/let/var, function bodies, later reassignments. */
function collectScope(src) {
  const defs = new Map();
  const add = (n, e) => {
    if (!defs.has(n)) defs.set(n, []);
    defs.get(n).push(e);
  };
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    const s = m.index + m[0].length;
    add(m[1], src.slice(s, readExprEnd(src, s)));
  }
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const open = src.indexOf('{', closeBracket(src, m.index + m[0].length - 1));
    if (open !== -1) add(m[1], src.slice(open, closeBracket(src, open)));
  }
  // import styles from './x.module.css': styles.go is the class "go" in that stylesheet.
  defs.modules = new Set([...src.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+\.css["']/g)].map((m) => m[1]));
  for (const n of [...defs.keys()]) {
    const re = new RegExp(`(?:^|[;{}\\n])\\s*${n.replace(/\$/g, '\\$')}\\s*=(?![=>])\\s*`, 'g');
    for (const m of src.matchAll(re)) {
      const s = m.index + m[0].length;
      add(n, src.slice(s, readExprEnd(src, s)));
    }
  }
  return defs;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOLE = '\u0000';

function addClassString(acc, text) {
  for (const tok of text.split(/\s+/)) {
    if (!tok) continue;
    if (tok.includes(HOLE)) {
      if (tok.replace(/\u0000/g, '')) acc.patterns.push(new RegExp(`^${tok.split(HOLE).map(escapeRe).join('.*')}$`));
    } else acc.exact.add(tok);
  }
}

function templateClasses(body, scope, acc, seen, depth) {
  let combos = [''];
  let i = 0;
  while (i < body.length) {
    const h = body.indexOf('${', i);
    const stat = h === -1 ? body.slice(i) : body.slice(i, h);
    combos = combos.map((c) => c + stat);
    if (h === -1) break;
    const end = closeBracket(body, h + 1);
    const sub = { exact: new Set(), patterns: [] };
    classesFromExpr(body.slice(h + 2, end - 1), scope, sub, new Set(seen), depth + 1);
    const vals = [...sub.exact];
    combos = (vals.length ? combos.flatMap((c) => [...vals, ''].map((v) => c + v)) : combos.map((c) => c + HOLE)).slice(0, 60);
    i = end;
  }
  for (const c of combos) addClassString(acc, c);
}

/**
 * Collect the class names an expression can produce: string and template literals, unquoted keys of a
 * clsx-style object, and the values of variables, maps and functions assigned in the same file.
 * Whatever comes from props, imports or CSS-modules maps is not visible.
 */
/** 'psa-' + 'go' and 'psa-' + kind become `psa-go` / `psa-${kind}` so the pieces are read as one name. */
function foldConcat(expr) {
  let out = expr;
  for (let i = 0; i < 6; i += 1) {
    const next = out
      .replace(/(["'])([^"'\\\n]*)\1\s*\+\s*(["'])([^"'\\\n]*)\3/g, (_, q, a2, q2, b2) => `'${a2}${b2}'`)
      .replace(/(["'])([^"'\\\n]*)\1\s*\+\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?![\w$.(])/g, (_, q, a2, id) => `\`${a2}\${${id}}\``)
      .replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\+\s*(["'])([^"'\\\n]*)\2/g, (_, id, q, b2) => `\`\${${id}}${b2}\``);
    if (next === out) break;
    out = next;
  }
  return out;
}

function classesFromExpr(rawExpr, scope, acc, seen, depth = 0) {
  if (depth > 6) return;
  const expr = foldConcat(rawExpr);
  const n = expr.length;
  const objects = [];
  let i = 0;
  while (i < n) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      const e = skipQuoted(expr, i);
      addClassString(acc, expr.slice(i + 1, e - 1));
      i = e;
    } else if (c === '`') {
      const e = skipQuoted(expr, i);
      templateClasses(expr.slice(i + 1, e - 1), scope, acc, seen, depth);
      i = e;
    } else if (c === '{') {
      objects.push(expr.slice(0, i).trim() !== '');
      i += 1;
    } else if (c === '}') {
      objects.pop();
      i += 1;
    } else if (/[A-Za-z_$]/.test(c) && !/[\w$.]/.test(expr[i - 1] || ' ')) {
      let j = i;
      while (j < n && /[\w$]/.test(expr[j])) j += 1;
      const name = expr.slice(i, j);
      let k = j;
      for (;;) {
        const rest = expr.slice(k);
        const mm = /^\??\.([A-Za-z_$][\w$]*)/.exec(rest);
        if (mm) {
          if (k === j && scope.modules && scope.modules.has(name)) addClassString(acc, mm[1]);
          k += mm[0].length;
        } else if (rest[0] === '[') {
          const end = closeBracket(expr, k);
          const lit = /^\[\s*["']([^"']+)["']\s*\]$/.exec(expr.slice(k, end));
          if (lit && k === j && scope.modules && scope.modules.has(name)) addClassString(acc, lit[1]);
          k = end;
        } else break;
      }
      const after = expr.slice(k).trimStart();
      if (objects[objects.length - 1] && after[0] === ':' && k === j) addClassString(acc, name);
      else if (scope.has(name) && !seen.has(name)) {
        seen.add(name);
        for (const rhs of scope.get(name)) classesFromExpr(rhs, scope, acc, seen, depth + 1);
      }
      i = k;
    } else i += 1;
  }
}

const NO_SCOPE = new Map();

/**
 * Tokens of every class / className / *ClassName attribute value in a tag's attrs. Expressions are resolved
 * through `scope` (see collectScope). The returned array also carries `.patterns` (RegExp[]) for names that
 * are only partly known, e.g. `psa-${kind}`.
 */
export function classTokens(attrs, scope = NO_SCOPE, onlyButtonAttrs = false) {
  const acc = { exact: new Set(), patterns: [] };
  const re = /(?:^|\s)(?:class|className|[A-Za-z]*Class(?:Name|es)?)\s*=\s*/g;
  let m;
  while ((m = re.exec(attrs))) {
    if (onlyButtonAttrs && !BTN_NAME.test(m[0])) continue;
    const i = m.index + m[0].length;
    if (attrs[i] === '"' || attrs[i] === "'") {
      const e = attrs.indexOf(attrs[i], i + 1);
      addClassString(acc, attrs.slice(i + 1, e === -1 ? undefined : e));
    } else if (attrs[i] === '{') {
      classesFromExpr(attrs.slice(i + 1, closeBracket(attrs, i) - 1), scope, acc, new Set());
    }
  }
  const out = [...acc.exact];
  out.patterns = acc.patterns;
  return out;
}

/** A Set of class names that also answers `has()` for partly-known names. */
class ClassSet extends Set {
  constructor(items) {
    super(items);
    this.patterns = [];
  }

  has(name) {
    return super.has(name) || this.patterns.some((re) => re.test(name));
  }
}

function mergeClassSets(...sets) {
  const out = new ClassSet();
  for (const s of sets) {
    if (!s) continue;
    for (const k of s) out.add(k);
    if (s.patterns) out.patterns.push(...s.patterns);
  }
  return out;
}

const BTN_NAME = /btn|button/i;
const BTN_TAG = /^(?:Button|Btn)$|Button$|Btn$|^PrivilegeLiveCheck$/;
const BUTTON_MARKUP =
  /<button\b|\brole\s*=\s*["']button["']|<input\b[^>]*\btype\s*=\s*["'](?:button|submit|reset)["']|createElement\(\s*["']button["']|\bstyled\.button\b|\bstyled\(\s*["']button["']|\bas\s*=\s*["']button["']/;

/** Components defined in this file whose body renders a button (or another such component). */
function localButtonComponents(src) {
  const marks = [...src.matchAll(/(?:\bfunction\s+([A-Z][\w$]*)\s*\(|\b(?:const|let|var)\s+([A-Z][\w$]*)\s*=)/g)];
  const chunks = marks.map((m, k) => ({ name: m[1] || m[2], body: src.slice(m.index, k + 1 < marks.length ? marks[k + 1].index : src.length) }));
  const names = new Set();
  for (let round = 0; round < 3; round += 1) {
    for (const { name, body } of chunks) {
      if (names.has(name)) continue;
      if (BUTTON_MARKUP.test(body) || [...names].some((x) => new RegExp(`<${x}(?=[\\s>/])`).test(body))) names.add(name);
    }
  }
  return names;
}

function tagIsButton(t, comps) {
  return (
    t.name === 'button' ||
    BTN_TAG.test(t.name) ||
    comps.has(t.name) ||
    /\brole\s*=\s*["']button["']/.test(t.attrs) ||
    /\b(?:as|component|is|tag)\s*=\s*["']button["']/.test(t.attrs) ||
    (t.name === 'input' && /\btype\s*=\s*["'](button|submit|reset)["']/.test(t.attrs))
  );
}

/** Everything the page checks need to know about one JSX source, computed once. */
function analyse(src) {
  const scope = collectScope(src);
  const comps = localButtonComponents(src);
  const classes = new ClassSet();
  let hasButton = false;
  const take = (toks) => {
    toks.forEach((k) => classes.add(k));
    classes.patterns.push(...(toks.patterns || []));
  };
  eachTag(src, (t) => {
    const isBtn = tagIsButton(t, comps);
    if (isBtn) hasButton = true;
    const tokens = classTokens(t.attrs, scope);
    if (tokens.length || tokens.patterns.length) {
      if (isBtn || tokens.some((k) => BTN_NAME.test(k))) take(tokens);
    }
    // btnClass="x", buttonClassName={y}: the attribute name says the value is a button class, whatever the tag.
    take(classTokens(t.attrs, scope, true));
  });
  // React.createElement('button', { className: ... }) and jsx('button', { ... })
  for (const m of src.matchAll(/\b(?:createElement|jsxs?|h)\(\s*["']button["']\s*,\s*\{/g)) {
    hasButton = true;
    const open = m.index + m[0].length - 1;
    const body = src.slice(open, closeBracket(src, open));
    const cm = /\b(?:className|class)\s*:\s*/.exec(body);
    if (cm) {
      const acc = { exact: new Set(), patterns: [] };
      const s = cm.index + cm[0].length;
      classesFromExpr(body.slice(s, readExprEnd(body, s, true)), scope, acc, new Set());
      const toks = [...acc.exact];
      toks.patterns = acc.patterns;
      take(toks);
    }
  }
  if (BUTTON_MARKUP.test(src)) hasButton = true;
  return { scope, comps, classes, hasButton };
}

/**
 * Classes that the JSX puts on something that behaves as a button: a <button>, a *Button/*Btn component, a
 * component defined in the same file that renders a button, role="button", <input type=button|submit|reset>,
 * as="button", any element carrying a btn/button-named class, and PrivilegeLiveCheck's buttonClassName.
 */
export function buttonClasses(jsx) {
  return analyse(stripJsComments(jsx)).classes;
}

// ---------- CSS embedded in JS ----------

/** Replace `${...}` holes in a template body with an unresolvable var(), so they fail closed. */
function unTemplate(body) {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const h = body.indexOf('${', i);
    if (h === -1) return out + body.slice(i);
    out += `${body.slice(i, h)}var(--__js)`;
    i = closeBracket(body, h + 1);
  }
  return out;
}

/** CSS found inside a script: <style> elements and styled/css/createGlobalStyle/keyframes tagged templates. */
function embeddedCss(src, info) {
  const blocks = [];
  const btn = [];
  let n = 0;
  for (const m of src.matchAll(/<style\b/g)) {
    const tag = readTag(src, m.index);
    if (!tag) continue;
    let css = null;
    const dang = /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*(?=[`"'])/.exec(tag.attrs);
    if (dang) {
      const q = dang.index + dang[0].length;
      css = unTemplate(tag.attrs.slice(q + 1, skipQuoted(tag.attrs, q) - 1));
    } else if (!tag.selfClosing) {
      const inner = readInner(src, tag).trim();
      let lit = inner;
      const id = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(inner);
      if (id && info.scope.has(id[1])) lit = `{${info.scope.get(id[1])[0]}}`;
      if (lit.startsWith('{')) {
        const q = lit.search(/[`"']/);
        css = q === -1 ? null : unTemplate(lit.slice(q + 1, skipQuoted(lit, q) - 1));
      } else css = lit;
    }
    if (css && css.trim()) blocks.push({ file: `<style> block ${(n += 1)}`, css });
  }
  const re = /\b(styled\.([a-z][a-z0-9]*)|styled\(([^()]*)\)(?:\.attrs\([^)]*\))?|createGlobalStyle|keyframes|injectGlobal|css)\s*`/g;
  for (const m of src.matchAll(re)) {
    const q = m.index + m[0].length - 1;
    const body = unTemplate(src.slice(q + 1, skipQuoted(src, q) - 1));
    n += 1;
    const cls = `__js-${n}`;
    const head = m[1];
    if (head === 'createGlobalStyle' || head === 'injectGlobal') blocks.push({ file: `${head} ${n}`, css: body });
    else if (head === 'keyframes') blocks.push({ file: `keyframes ${n}`, css: `@keyframes ${cls} { ${body} }` });
    else {
      blocks.push({ file: `${head.replace(/\(.*/, '(…)')} ${n}`, css: `.${cls} { ${body} }` });
      const comp = (m[3] || '').trim();
      const isBtn = head === 'css' ? info.hasButton : m[2] === 'button' || BTN_TAG.test(comp.replace(/["']/g, '')) || info.comps.has(comp);
      if (isBtn) btn.push(cls);
    }
  }
  return { blocks, btn };
}

// ---------- colour ----------

// CSS named colours, name:rrggbb.
const NAMED_HEX =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,' +
  'bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,' +
  'burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,' +
  'cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,' +
  'darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,' +
  'darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
  'darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,' +
  'dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,' +
  'fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,' +
  'green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,' +
  'indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,' +
  'lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,' +
  'lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,' +
  'lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,' +
  'maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,' +
  'mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,' +
  'mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,' +
  'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,' +
  'orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,' +
  'palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,' +
  'powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,' +
  'saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,' +
  'silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,' +
  'turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,' +
  'yellowgreen:9acd32';
const NAMED = Object.fromEntries(
  NAMED_HEX.split(',').map((p) => {
    const [n, h] = p.split(':');
    return [n, [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16))];
  }),
);
// Named hues that are violet by name whatever the arithmetic says.
const VIOLET_NAMES = new Set(['indigo', 'violet', 'purple', 'magenta', 'fuchsia', 'rebeccapurple', 'blueviolet', 'darkviolet', 'mediumpurple', 'slateblue']);
// System colours with a fixed value in the CSS Color 4 default palette; the OS-tinted ones are unknown.
const SYSTEM_COLOURS = {
  canvas: [255, 255, 255], canvastext: [0, 0, 0], linktext: [0, 0, 238], visitedtext: [85, 26, 139], activetext: [255, 0, 0],
  buttonface: [239, 239, 239], buttontext: [0, 0, 0], buttonborder: [118, 118, 118], field: [255, 255, 255], fieldtext: [0, 0, 0],
  graytext: [128, 128, 128], mark: [255, 255, 0], marktext: [0, 0, 0], window: [255, 255, 255], windowtext: [0, 0, 0], windowframe: [0, 0, 0],
  menu: [255, 255, 255], menutext: [0, 0, 0], scrollbar: [200, 200, 200], threedface: [239, 239, 239], buttonhighlight: [255, 255, 255],
  buttonshadow: [118, 118, 118], captiontext: [0, 0, 0], infotext: [0, 0, 0], infobackground: [255, 255, 225],
};
const OS_TINTED = new Set(['accentcolor', 'accentcolortext', 'highlight', 'highlighttext', 'selecteditem', 'selecteditemtext', '-webkit-focus-ring-color', '-webkit-link', '-webkit-activelink']);
const SAFE_KEYWORDS = new Set(['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'none']);
const COLOUR_FNS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark', 'contrast-color']);
const UNKNOWN_FNS = new Set(['var', 'attr', 'env', 'paint', 'element', 'if', 'toggle', 'random', 'inherit']);

function hexToRgb(h) {
  let x = h.replace('#', '');
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
  if (x.length !== 6 && x.length !== 8) return null;
  return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16));
}

/** Violet / indigo / purple: hue 235-300 deg, HSL saturation > 20%, chroma >= 0.12. Ping blue #12538d is hue 209. */
export function isVioletIndigo(rgb) {
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.12) return false;
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return s > 0.2 && h >= 235 && h <= 300;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sgn = (v) => (v < 0 ? -1 : 1);
const encode = (c) => {
  const v = clamp01(c);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
const toByte = (lin) => lin.map((c) => Math.round(encode(c) * 255));
const mulM = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

// Matrices from CSS Color 4 (linear light -> XYZ).
const M_SRGB = [[0.41239079926595934, 0.357584339383878, 0.1804807884018343], [0.21263900587151027, 0.715168678767756, 0.07219231536073371], [0.01933081871559182, 0.11919477979462598, 0.9505321522496607]];
const M_XYZ_SRGB = [[3.2409699419045226, -1.537383177570094, -0.4986107602930034], [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559], [0.05563007969699366, -0.20397695888897652, 1.0569715142428786]];
const M_P3 = [[0.4865709486482162, 0.26566769316909306, 0.1982172852343625], [0.2289745640697488, 0.6917385218365064, 0.079286914093745], [0.0, 0.04511338185890264, 1.043944368900976]];
const M_A98 = [[0.5766690429101305, 0.1855582379065463, 0.1882286462349947], [0.29734497525053605, 0.6273635662554661, 0.0752914584939979], [0.02703136138641234, 0.07068885253582723, 0.9913375368376388]];
const M_REC2020 = [[0.6369580483012914, 0.14461690358620832, 0.1688809751641721], [0.2627002120112671, 0.6779980715188708, 0.05930171646986196], [0.0, 0.028072693049087428, 1.060985057710791]];
const M_PROPHOTO = [[0.7977604896723027, 0.13518583717574031, 0.0313493495815248], [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902], [0.0, 0.0, 0.8251046025104601]];
const M_D50_D65 = [[0.9554734527042182, -0.023098536874261423, 0.0632593086610217], [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008], [0.012314001688319899, -0.020507696433477912, 1.3303659366080753]];
const M_D65_D50 = inv3(M_D50_D65);
const srgbDec = (v) => {
  const a = Math.abs(v);
  return sgn(v) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
};
const a98Dec = (v) => sgn(v) * Math.abs(v) ** (563 / 256);
const proDec = (v) => {
  const a = Math.abs(v);
  return sgn(v) * (a <= 16 / 512 ? a / 16 : a ** 1.8);
};
const recDec = (v) => {
  const a = Math.abs(v);
  return sgn(v) * (a < 0.018053968510807 * 4.5 ? a / 4.5 : ((a + 0.09929682680944) / 1.09929682680944) ** (1 / 0.45));
};
const SPACES = {
  'srgb-linear': { dec: (v) => v, m: M_SRGB },
  'display-p3': { dec: srgbDec, m: M_P3 },
  'a98-rgb': { dec: a98Dec, m: M_A98 },
  'prophoto-rgb': { dec: proDec, m: M_PROPHOTO, d50: true },
  rec2020: { dec: recDec, m: M_REC2020 },
};

/** color(<space> a b c) to sRGB bytes, or null for a space this script does not know. */
export function colorSpaceToRgb(space, c) {
  if (space === 'srgb') return c.map((v) => Math.round(clamp01(v) * 255));
  let xyz;
  if (space === 'xyz' || space === 'xyz-d65') xyz = c;
  else if (space === 'xyz-d50') xyz = mulM(M_D50_D65, c);
  else if (SPACES[space]) {
    xyz = mulM(SPACES[space].m, c.map(SPACES[space].dec));
    if (SPACES[space].d50) xyz = mulM(M_D50_D65, xyz);
  } else return null;
  return toByte(mulM(M_XYZ_SRGB, xyz));
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(clamp01(v) * 255));
}

function rgbToHsl([r8, g8, b8]) {
  const [r, g, b] = [r8, g8, b8].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s * 100, l * 100];
}

function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toByte([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map((v) => srgbDec(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const D50_WHITE = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

function labToRgb(L, a, b) {
  const eps = 216 / 24389;
  const kap = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const X = (fx ** 3 > eps ? fx ** 3 : (116 * fx - 16) / kap) * D50_WHITE[0];
  const Y = L > kap * eps ? fy ** 3 : L / kap;
  const Z = (fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / kap) * D50_WHITE[2];
  return toByte(mulM(M_XYZ_SRGB, mulM(M_D50_D65, [X, Y, Z])));
}

function rgbToLab(rgb) {
  const xyz50 = mulM(M_D65_D50, mulM(M_SRGB, rgb.map((v) => srgbDec(v / 255))));
  const f = xyz50.map((v, i) => {
    const t = v / D50_WHITE[i];
    return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

const polar = (c, h) => [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
const toPolar = ([L, a, b]) => [L, Math.hypot(a, b), (((Math.atan2(b, a) * 180) / Math.PI) % 360 + 360) % 360];

// ----- calc() over intervals -----

const UNK = [-Infinity, Infinity];
const pt = (x) => [x, x];
const isPt = (a) => Number.isFinite(a[0]) && Math.abs(a[0] - a[1]) < 1e-9;
const addI = (a, b) => [a[0] + b[0], a[1] + b[1]];
const subI = (a, b) => [a[0] - b[1], a[1] - b[0]];
const mulI = (a, b) => {
  const c = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]].map((x) => (Number.isNaN(x) ? 0 : x));
  return [Math.min(...c), Math.max(...c)];
};
const divI = (a, b) => (isPt(b) && b[0] !== 0 ? mulI(a, pt(1 / b[0])) : UNK);
const minI = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
const maxI = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])];

function applyFn(name, args) {
  const one = (f) => (args.length === 1 && isPt(args[0]) ? pt(f(args[0][0])) : UNK);
  const two = (f) => (args.length === 2 && isPt(args[0]) && isPt(args[1]) ? pt(f(args[0][0], args[1][0])) : UNK);
  switch (name) {
    case 'calc': return args[0] || UNK;
    case 'min': return args.length ? args.reduce(minI) : UNK;
    case 'max': return args.length ? args.reduce(maxI) : UNK;
    case 'clamp': return args.length === 3 ? maxI(args[0], minI(args[1], args[2])) : UNK;
    case 'abs': {
      const [lo, hi] = args[0] || UNK;
      return lo >= 0 ? [lo, hi] : hi <= 0 ? [-hi, -lo] : [0, Math.max(-lo, hi)];
    }
    case 'sqrt': return one(Math.sqrt);
    case 'pow': return two((a, b) => a ** b);
    case 'hypot': return args.length && args.every(isPt) ? pt(Math.hypot(...args.map((a) => a[0]))) : UNK;
    case 'mod': return two((a, b) => ((a % b) + b) % b);
    case 'rem': return two((a, b) => a % b);
    case 'round': return args.length === 2 && isPt(args[0]) && isPt(args[1]) ? pt(Math.round(args[0][0] / args[1][0]) * args[1][0]) : UNK;
    default: return UNK;
  }
}

/**
 * Evaluate a CSS math expression to an interval [lo, hi]. `env.unit(u)` gives the multiplier of a unit (null =
 * unknown), `env.ident(name)` a value or null. Returns null when the expression cannot be parsed.
 */
function calcInterval(expr, env) {
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)([a-z%]*)|([a-z_][\w-]*)|([-+*/(),]))/giy;
  let pos = 0;
  let m;
  while (pos < expr.length && (m = re.exec(expr))) {
    toks.push(m[1] !== undefined ? { n: parseFloat(m[1]), u: m[2].toLowerCase() } : m[3] ? { id: m[3].toLowerCase() } : { op: m[4] });
    pos = re.lastIndex;
  }
  if (expr.slice(pos).trim()) return null;
  let p = 0;
  const fail = () => {
    throw new Error('calc');
  };
  const sum = () => {
    let v = prod();
    while (toks[p] && (toks[p].op === '+' || toks[p].op === '-')) v = toks[p++].op === '+' ? addI(v, prod()) : subI(v, prod());
    return v;
  };
  const prod = () => {
    let v = atom();
    while (toks[p] && (toks[p].op === '*' || toks[p].op === '/')) v = toks[p++].op === '*' ? mulI(v, atom()) : divI(v, atom());
    return v;
  };
  const atom = () => {
    const t = toks[p++];
    if (!t) fail();
    if (t.n !== undefined) {
      const s = env.unit(t.u);
      return s === null ? UNK : mulI(pt(t.n), pt(s));
    }
    if (t.id) {
      if (toks[p] && toks[p].op === '(') {
        p += 1;
        const args = [];
        if (!(toks[p] && toks[p].op === ')')) {
          do args.push(sum());
          while (toks[p] && toks[p].op === ',' && (p += 1));
        }
        if (!(toks[p] && toks[p].op === ')')) fail();
        p += 1;
        return applyFn(t.id, args);
      }
      const v = env.ident(t.id);
      return v === null || v === undefined ? UNK : Array.isArray(v) ? v : pt(v);
    }
    if (t.op === '(') {
      const v = sum();
      if (!(toks[p] && toks[p].op === ')')) fail();
      p += 1;
      return v;
    }
    if (t.op === '-') return mulI(atom(), pt(-1));
    if (t.op === '+') return atom();
    return fail();
  };
  try {
    const v = sum();
    return p === toks.length ? v : null;
  } catch {
    return null;
  }
}

const ANGLE_UNITS = { '': 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

/** One colour channel: number, percentage (100% = `full`), `none`, calc()/min()/..., or a relative-colour keyword. Number or null. */
function channel(tok, full, vars) {
  const t = String(tok ?? 'none').trim().toLowerCase();
  if (t === 'none') return 0;
  const iv = calcInterval(t, {
    unit: (u) => (u === '%' ? full / 100 : u in ANGLE_UNITS ? ANGLE_UNITS[u] : null),
    ident: (n) => (n === 'pi' ? Math.PI : n === 'e' ? Math.E : n === 'infinity' ? Infinity : vars && n in vars ? vars[n] : null),
  });
  return iv && isPt(iv) ? iv[0] : null;
}

/** Top-level pieces of a function argument list: split on whitespace and commas, `/` is its own piece. */
function topTokens(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  for (const ch of text.trim()) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && (/\s/.test(ch) || ch === ',')) flush();
    else if (depth === 0 && ch === '/') {
      flush();
      out.push('/');
    } else cur += ch;
  }
  flush();
  return out;
}

const REL = {
  rgb: { names: ['r', 'g', 'b'], full: [255, 255, 255], from: (rgb) => rgb },
  hsl: { names: ['h', 's', 'l'], full: [360, 100, 100], from: rgbToHsl },
  hwb: {
    names: ['h', 'w', 'b'],
    full: [360, 100, 100],
    from: (rgb) => [rgbToHsl(rgb)[0], (Math.min(...rgb) / 255) * 100, (1 - Math.max(...rgb) / 255) * 100],
  },
  lab: { names: ['l', 'a', 'b'], full: [100, 125, 125], from: rgbToLab },
  lch: { names: ['l', 'c', 'h'], full: [100, 150, 360], from: (rgb) => toPolar(rgbToLab(rgb)) },
  oklab: { names: ['l', 'a', 'b'], full: [1, 0.4, 0.4], from: rgbToOklab },
  oklch: { names: ['l', 'c', 'h'], full: [1, 0.4, 360], from: (rgb) => toPolar(rgbToOklab(rgb)) },
  srgb: { names: ['r', 'g', 'b'], full: [1, 1, 1], from: (rgb) => rgb.map((v) => v / 255) },
  'srgb-linear': { names: ['r', 'g', 'b'], full: [1, 1, 1], from: (rgb) => rgb.map((v) => srgbDec(v / 255)) },
};
const COLOR_FN_FULL = [1, 1, 1];

const SAFE = { safe: true };
const UNKNOWN = { unknown: true };

function mixRgb(a, b, wa) {
  return [0, 1, 2].map((i) => Math.round(a[i] * wa + b[i] * (1 - wa)));
}

function evalMix(inner, depth) {
  const parts = [];
  let d = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') d += 1;
    if (ch === ')') d -= 1;
    if (ch === ',' && d === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  if (parts.length !== 3 || !/^\s*in\s/i.test(parts[0])) return UNKNOWN;
  const items = parts.slice(1).map((p) => {
    const toks = topTokens(p);
    let pct = null;
    if (toks.length > 1 && /%$/.test(toks[toks.length - 1])) pct = parseFloat(toks.pop());
    else if (toks.length > 1 && /%$/.test(toks[0])) pct = parseFloat(toks.shift());
    return { pct, val: evalColourValue(toks.join(' '), depth + 1) };
  });
  if (items.some((x) => !x.val || x.val.unknown)) return UNKNOWN;
  let [p1, p2] = items.map((x) => x.pct);
  if (p1 === null && p2 === null) [p1, p2] = [50, 50];
  else if (p1 === null) p1 = 100 - p2;
  else if (p2 === null) p2 = 100 - p1;
  const w = p1 + p2 > 0 ? p1 / (p1 + p2) : 0.5;
  const [a, b] = items.map((x) => x.val);
  if (a.safe || b.safe) return a.safe && b.safe ? SAFE : { samples: (a.safe ? b : a).samples };
  const A = a.samples[0];
  const B = b.samples[0];
  const lab = rgbToOklab(A).map((v, i) => v * w + rgbToOklab(B)[i] * (1 - w));
  return { samples: [...a.samples, ...b.samples, mixRgb(A, B, w), oklabToRgb(...lab)] };
}

/** Evaluate a colour function (inner = text between the parentheses) to { samples: [rgb...] } | SAFE | UNKNOWN. */
function evalColourFn(name, inner, depth) {
  if (name === 'color-mix') return evalMix(inner, depth);
  if (name === 'contrast-color') return SAFE;
  if (name === 'light-dark') {
    const args = topTokens(inner);
    if (args.length !== 2) return UNKNOWN;
    const vals = args.map((x) => evalColourValue(x, depth + 1));
    if (vals.some((x) => !x || x.unknown)) return UNKNOWN;
    const samples = vals.flatMap((x) => x.samples || []);
    return samples.length ? { samples } : SAFE;
  }
  const fn = name === 'rgba' ? 'rgb' : name === 'hsla' ? 'hsl' : name;
  let t = topTokens(inner);
  let vars = null;
  let relOrigin = null;
  if (t[0] && t[0].toLowerCase() === 'from') {
    relOrigin = evalColourValue(t[1] || '', depth + 1);
    if (!relOrigin || !relOrigin.samples) return UNKNOWN;
    t = t.slice(2);
  }
  let space = fn;
  if (fn === 'color') space = (t.shift() || '').toLowerCase();
  const slash = t.indexOf('/');
  const chans = (slash === -1 ? t : t.slice(0, slash)).slice(0, 3);
  if (chans.length < 3) return UNKNOWN;
  const spec = fn === 'color' ? (REL[space] && /srgb/.test(space) ? REL[space] : null) : REL[fn];
  const full = fn === 'color' ? COLOR_FN_FULL : (spec || REL.rgb).full;
  if (relOrigin) {
    if (!spec) return UNKNOWN;
    const src = spec.from(relOrigin.samples[0]);
    vars = Object.fromEntries(spec.names.map((n, i) => [n, src[i]]));
    vars.alpha = 1;
  }
  const v = chans.map((c, i) => channel(c, full[i], vars));
  if (v.some((x) => x === null || !Number.isFinite(x))) return UNKNOWN;
  let rgb = null;
  if (fn === 'rgb') rgb = v.map((x) => Math.round(Math.min(255, Math.max(0, x))));
  else if (fn === 'hsl') rgb = hslToRgb(((v[0] % 360) + 360) % 360, clamp01(v[1] / 100), clamp01(v[2] / 100));
  else if (fn === 'hwb') {
    const w = clamp01(v[1] / 100);
    const b = clamp01(v[2] / 100);
    if (w + b >= 1) {
      const g = Math.round((w / (w + b)) * 255);
      rgb = [g, g, g];
    } else rgb = hslToRgb(((v[0] % 360) + 360) % 360, 1, 0.5).map((x) => Math.round((x / 255) * (1 - w - b) * 255 + w * 255));
  } else if (fn === 'oklab') rgb = oklabToRgb(v[0], v[1], v[2]);
  else if (fn === 'oklch') rgb = oklabToRgb(v[0], ...polar(v[1], v[2]));
  else if (fn === 'lab') rgb = labToRgb(v[0], v[1], v[2]);
  else if (fn === 'lch') rgb = labToRgb(v[0], ...polar(v[1], v[2]));
  else if (fn === 'color') rgb = colorSpaceToRgb(space, v);
  return rgb && rgb.every(Number.isFinite) ? { samples: [rgb] } : UNKNOWN;
}

/** A single colour expression to { samples } | SAFE | UNKNOWN, or null when it is not a colour at all. */
function evalColourValue(text, depth = 0) {
  const t = text.trim();
  if (!t || depth > 8) return null;
  if (t[0] === '#') {
    const rgb = hexToRgb(t);
    return rgb ? { samples: [rgb] } : SAFE;
  }
  const fn = /^([A-Za-z-]+)\(/.exec(t);
  if (fn) {
    if (closeBracket(t, fn[0].length - 1) !== t.length) return UNKNOWN;
    const name = fn[1].toLowerCase();
    if (COLOUR_FNS.has(name)) return evalColourFn(name, t.slice(fn[0].length, -1), depth);
    return UNKNOWN_FNS.has(name) ? UNKNOWN : null;
  }
  const id = t.toLowerCase();
  if (SAFE_KEYWORDS.has(id)) return SAFE;
  if (VIOLET_NAMES.has(id)) return { samples: [[128, 0, 128]] };
  if (NAMED[id]) return { samples: [NAMED[id]] };
  if (OS_TINTED.has(id)) return UNKNOWN;
  if (SYSTEM_COLOURS[id]) return { samples: [SYSTEM_COLOURS[id]] };
  return null;
}

/** Parse one colour function (`hsl(250 80% 50%)`, `oklch(...)`, ...) to [r,g,b] 0-255, or null. */
export function colourFunctionToRgb(fn) {
  const r = evalColourValue(fn);
  return r && r.samples ? r.samples[0] : null;
}

/** Index just after the `)` that closes the `(` at `open`, or -1. */
function closeParen(text, open) {
  let d = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') d += 1;
    else if (text[i] === ')') {
      d -= 1;
      if (d === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Colours in an already var-free CSS value: { violet: string[], unknown: string[] }. A colour function that
 * cannot be evaluated, an unresolved var(), attr()/env()/paint() and an OS-tinted system colour are unknown.
 * Gradients and other functions are entered; url() and strings are skipped.
 */
export function scanColours(value) {
  const violet = [];
  const unknown = [];
  const text = value.replace(/url\([^)]*\)|"[^"]*"|'[^']*'/gi, ' ');
  const judge = (src) => {
    const r = evalColourValue(src);
    if (!r) return;
    if (r.unknown) unknown.push(src);
    else if (r.samples && r.samples.some(isVioletIndigo)) violet.push(src);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#') {
      const m = /^#[0-9a-fA-F]+/.exec(text.slice(i));
      if (m) {
        judge(m[0]);
        i += m[0].length;
      } else i += 1;
    } else if (/[A-Za-z_-]/.test(c) && !/[\w-]/.test(text[i - 1] || ' ')) {
      const m = /^-{0,2}[A-Za-z_][\w-]*/.exec(text.slice(i));
      if (!m) {
        i += 1;
        continue;
      }
      const end = i + m[0].length;
      if (text[end] === '(') {
        const name = m[0].toLowerCase();
        const close = closeParen(text, end);
        if (COLOUR_FNS.has(name) || UNKNOWN_FNS.has(name)) {
          judge(close === -1 ? text.slice(i) : text.slice(i, close));
          i = close === -1 ? text.length : close;
        } else i = end + 1;
      } else {
        judge(m[0]);
        i = end;
      }
    } else i += 1;
  }
  return { violet: [...new Set(violet)], unknown: [...new Set(unknown)] };
}

/** Violet/indigo colour literals in an already var-free CSS value. */
export function violetLiterals(value) {
  return scanColours(value).violet;
}

/** Any colour literal at all (hex or colour function), for the inline-style rule. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color|color-mix|light-dark)\(/;

// ---------- CSS parsing ----------

/** Split on a separator at paren/bracket/quote depth 0. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

const SKIP_AT = /^@(?:font-face|page|counter-style|font-palette-values|position-try|font-feature-values|view-transition)\b/i;
const KEYFRAMES_AT = /^@(?:-\w+-)?keyframes\s+/i;
const cssUnescape = (s) => s.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_, hex, ch) => (hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : ch));

/**
 * Flatten a stylesheet to [{ selector, decls: [[prop, value, { line, endLine }]], keyframes? }], descending
 * into every at-rule block that is not a font-face-like one (@media/@supports/@layer/@container/@scope in any
 * case, unknown at-rules), into @keyframes (selector `@keyframes name frame`), and into CSS nesting (`&` is
 * replaced by the parent selector, otherwise it is prefixed). @property becomes a definition of its custom
 * property from `initial-value`. Property names are un-escaped and lower-cased (custom properties keep their
 * case). `!important` is dropped.
 */
export function parseCss(css) {
  const src = stripCssComments(css);
  const newlines = [];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') newlines.push(i);
  const lineAt = (off) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < off) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  const rules = [];
  const walk = (text, sel, base, kf) => {
    const decls = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    const pushDecl = (stmt, from, to) => {
      const s = stmt.trim();
      if (!s || s.startsWith('@')) return;
      const c = s.indexOf(':');
      if (c === -1) return;
      const lead = stmt.length - stmt.trimStart().length;
      // IE hack prefixes (*color, _color) and vendor prefixes (-webkit-box-shadow) are the same property for this check.
      const raw = cssUnescape(s.slice(0, c).trim()).replace(/^[*_]+(?=[A-Za-z])/, '').replace(/^-(?:webkit|moz|ms|o)-(?=(?:box-shadow|background|border|color|text-shadow|outline|font-size|font)\b)/i, '');
      const prop = raw.startsWith('--') ? raw : raw.toLowerCase();
      let value = s.slice(c + 1).replace(/\s*!\s*important\s*$/i, '').trim();
      if (value.includes('\\') && !/["']/.test(value)) value = cssUnescape(value);
      decls.push([prop, value, { line: lineAt(base + from + lead), endLine: lineAt(base + to) }]);
    };
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote && text[i - 1] !== '\\') quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth === 0) {
        pushDecl(text.slice(start, i), start, i);
        start = i + 1;
      } else if (ch === '{' && depth === 0) {
        let d = 1;
        let k = i + 1;
        for (; k < text.length && d > 0; k += 1) {
          if (text[k] === '{') d += 1;
          else if (text[k] === '}') d -= 1;
        }
        const prelude = text.slice(start, i).trim();
        const body = text.slice(i + 1, d > 0 ? k : k - 1); // an unclosed block still applies in browsers
        if (prelude.startsWith('@')) {
          if (KEYFRAMES_AT.test(prelude)) walk(body, null, base + i + 1, prelude.replace(KEYFRAMES_AT, '').trim());
          else if (/^@property\b/i.test(prelude)) walk(body, `@property ${prelude.slice(9).trim()}`, base + i + 1, kf);
          else if (!SKIP_AT.test(prelude)) walk(body, sel, base + i + 1, kf);
        } else if (kf && !sel) {
          walk(body, `@keyframes ${kf} ${prelude.replace(/\s+/g, ' ')}`, base + i + 1, kf);
        } else {
          const parts = splitTop(prelude.replace(/\s+/g, ' '), ',').map((p) => p.trim()).filter(Boolean);
          const nested = parts
            .map((p) => (sel ? (p.includes('&') ? p.replace(/&/g, sel.includes(',') ? `:is(${sel})` : sel) : `${sel} ${p}`) : p))
            .join(', ');
          walk(body, nested, base + i + 1, kf);
        }
        start = k;
        i = k - 1;
      }
    }
    pushDecl(text.slice(start), start, text.length);
    if (sel && decls.length) {
      if (sel.startsWith('@property ')) {
        const name = sel.slice(10).trim();
        const init = decls.filter((d) => d[0] === 'initial-value').map((d) => [name, d[1], d[2]]);
        if (init.length) rules.push({ selector: sel, decls: init });
      } else rules.push(kf ? { selector: sel, decls, keyframes: kf } : { selector: sel, decls });
    }
  };
  walk(src, null, 0, null);
  return rules;
}

/** `/* ui-pattern: allow <reason> *\/` comments of a stylesheet: { ok: [{ line, reason }], bad: [{ line }] }. */
export function scanEscapes(css) {
  const ok = [];
  const bad = [];
  for (const m of css.matchAll(/\/\*\s*ui-pattern:\s*allow\b([\s\S]*?)\*\//gi)) {
    const reason = m[1].replace(/^[\s:–—-]+/, '').trim();
    const line = css.slice(0, m.index + m[0].length).split('\n').length;
    if (reason.length >= 8 && /[a-z]{3}/i.test(reason)) ok.push({ line, reason });
    else bad.push({ line, reason });
  }
  return { ok, bad };
}

const isAllowed = (esc, meta) => esc.ok.some((e) => e.line >= meta.line - 1 && e.line <= meta.endLine);

/** Add the custom-property definitions of a rule list to a Map name -> Set of values (every selector, theme and skin). */
function addTokens(map, rules) {
  for (const rule of rules) {
    for (const [prop, value] of rule.decls) {
      if (!prop.startsWith('--')) continue;
      if (!map.has(prop)) map.set(prop, new Set());
      map.get(prop).add(value);
    }
  }
  return map;
}

const copyTokens = (tokens) => {
  const out = new Map([...tokens].map(([k, v]) => [k, new Set(v)]));
  if (tokens.remPx !== undefined) out.remPx = tokens.remPx;
  return out;
};

/**
 * What 1rem is: 16px unless a scanned stylesheet sets the root font size (html / :root), as the 62.5% trick
 * does. null = the root size cannot be resolved, so rem sizes are unknown.
 */
function rootRemPx(rules, tokens, prior = 16) {
  let rem = prior;
  for (const rule of rules) {
    if (!splitTop(rule.selector, ',').some((p) => /^(?:html|:root|html:root)$/i.test(p.trim()))) continue;
    for (const [prop, value] of rule.decls) {
      if (prop !== 'font-size' && prop !== 'font') continue;
      for (const v of expandVars(value, tokens, [], { vertical: false, undef: [], mark: '__undef__' }).values) {
        const tok = prop === 'font' ? fontShorthandSize(v) : v.trim();
        if (!tok) continue;
        const verdict = sizeVerdict(tok, 16);
        if (verdict.kind === 'unknown' || (verdict.lo === null && verdict.kind !== 'safe')) return null;
        if (verdict.lo !== null) rem = rem === null ? null : Math.min(rem, verdict.lo);
      }
    }
  }
  return rem;
}

const VERTICAL_NAME = /^--(app-primary-red[\w-]*|theme-accent[\w-]*|brand-[\w-]+)$/;

/**
 * Expand every var() in `value` through all known definitions (and fallbacks). Returns
 * { values: string[], vertical: boolean, undef: string[] } (`flags.mark` replaces an undefined var() in the values): vertical says a vertical colour token is in a
 * chain, undef lists the (non-vertical) custom properties that have no definition and no fallback.
 */
export function expandVars(value, tokens, trail = [], flags = { vertical: false, undef: [] }) {
  const at = value.indexOf('var(');
  const done = (values) => ({ values, vertical: flags.vertical, undef: flags.undef });
  if (at === -1) return done([value]);
  const end = closeParen(value, at + 3);
  if (end === -1) return done([value]);
  const parts = splitTop(value.slice(at + 4, end - 1), ',');
  const name = parts[0].trim();
  const fallback = parts.length > 1 ? parts.slice(1).join(',').trim() : null;
  if (VERTICAL_NAME.test(name)) flags.vertical = true;
  const cands = trail.includes(name) ? [] : [...(tokens.get(name) || [])];
  if (fallback !== null) cands.push(fallback);
  if (!cands.length) {
    cands.push(flags.mark || '');
    if (!VERTICAL_NAME.test(name)) flags.undef.push(name);
  }
  const out = [];
  for (const cand of cands) {
    for (const v of expandVars(cand, tokens, [...trail, name], flags).values.slice(0, 12)) {
      out.push(...expandVars(value.slice(0, at) + v + value.slice(end), tokens, trail, flags).values.slice(0, 12));
    }
  }
  return { values: [...new Set(out)].slice(0, 40), vertical: flags.vertical, undef: [...new Set(flags.undef)] };
}

// ---------- font size ----------

const SIZE_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48, smaller: 13.3333, larger: 19.2 };
const UNIT_PX = { px: 1, rem: 16, em: 16, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, '%': 0.16, ex: 8, ch: 8, '': 1 };
/** Viewports a size is judged at: the phone width the standard names, a tablet, a laptop and a wide desktop. */
const VIEWPORTS = [[375, 667], [768, 1024], [1280, 800], [1920, 1080]];

function fontEnv([w, h], rem = 16) {
  return {
    unit: (u) => {
      if (u === 'rem') return rem;
      if (u in UNIT_PX) return UNIT_PX[u];
      const v = /^(?:[sld]?)(vw|vh|vi|vb|vmin|vmax)$/.exec(u);
      if (!v) return null;
      const dim = { vw: w, vi: w, vh: h, vb: h, vmin: Math.min(w, h), vmax: Math.max(w, h) }[v[1]];
      return dim / 100;
    },
    ident: (n) => (n === 'pi' ? Math.PI : n === 'e' ? Math.E : null),
  };
}

/** { kind: 'small' | 'safe' | 'unknown', lo } for one font-size token. lo = smallest px over the judged viewports, or null. */
function sizeVerdict(raw, rem = 16) {
  const t = raw.trim().toLowerCase();
  if (!t) return { kind: 'unknown', lo: null };
  if (/^(inherit|initial|unset|revert|revert-layer)$/.test(t)) return { kind: 'safe', lo: null };
  if (t in SIZE_KEYWORDS) return { kind: SIZE_KEYWORDS[t] < 10 ? 'small' : 'safe', lo: SIZE_KEYWORDS[t] };
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t)) return Number(t) === 0 ? { kind: 'small', lo: 0 } : { kind: 'safe', lo: null };
  let small = false;
  let safe = true;
  let lo = Infinity;
  for (const vp of VIEWPORTS) {
    const iv = calcInterval(t, fontEnv(vp, rem));
    if (!iv) return { kind: 'unknown', lo: null };
    if (iv[1] < 10 - 1e-9) small = true;
    if (!(iv[0] >= 10 - 1e-9)) safe = false;
    lo = Math.min(lo, iv[0]);
  }
  return { kind: small ? 'small' : safe ? 'safe' : 'unknown', lo: Number.isFinite(lo) ? Math.max(lo, 0) : null };
}

/** Smallest px a CSS font size can take over the judged viewports, or null if it cannot be known. */
export function lengthToPx(raw) {
  const v = sizeVerdict(raw);
  return v.kind === 'unknown' ? null : v.lo;
}

const SIZE_UNIT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z%]+$/i;
const isSizeToken = (t) => SIZE_UNIT.test(t) || t.toLowerCase() in SIZE_KEYWORDS || /^(?:calc|clamp|min|max)\(/i.test(t) || /^[+-]?0+(?:\.0*)?$/.test(t);

/** The size token inside a `font` shorthand (`italic 700 9px/1.2 sans-serif` -> `9px`), or null. */
function fontShorthandSize(value) {
  if (/^(inherit|initial|unset|revert|revert-layer|caption|icon|menu|message-box|small-caption|status-bar)$/i.test(value.trim())) return null;
  for (const t of splitTop(value.trim(), ' ').filter(Boolean)) {
    const size = splitTop(t, '/')[0];
    if (isSizeToken(size)) return size;
  }
  return null;
}

/** { small: string[], unknown: string[] } for a `font-size` or `font` declaration, after var() expansion. */
function fontProblems(prop, value, tokens) {
  const rem = tokens.remPx === undefined ? 16 : tokens.remPx;
  const out = { small: [], unknown: [] };
  if (prop !== 'font-size' && prop !== 'font') return out;
  // An undefined var() becomes an unknown operand, so max(var(--x), 12px) can still be proven safe.
  const { values, undef } = expandVars(value, tokens, [], { vertical: false, undef: [], mark: '__undef__' });
  if (undef.length && prop === 'font') out.unknown.push(...undef.map((n) => `var(${n})`));
  for (const v of values) {
    const tok = prop === 'font' ? fontShorthandSize(v) : v.trim();
    if (!tok) continue;
    const verdict = sizeVerdict(tok, rem);
    if (verdict.kind === 'small') out.small.push(tok);
    else if (verdict.kind === 'unknown') out.unknown.push(undef.length && prop === 'font-size' ? `var(${undef[0]})` : tok);
  }
  out.small = [...new Set(out.small)];
  out.unknown = [...new Set(out.unknown)];
  return out;
}

/** { violet: string[], vertical: boolean, unknown: string[] } for a colour-bearing declaration value. */
function colourProblems(value, tokens) {
  const { values, vertical, undef } = expandVars(value, tokens);
  const violet = [...new Set(values.flatMap((v) => scanColours(v).violet))];
  const unknown = [...new Set(values.flatMap((v) => scanColours(v).unknown))];
  if (undef.length) unknown.push(...undef.map((n) => `var(${n})`));
  return { violet, vertical, unknown };
}

// ---------- rules ----------

const ok = (rule, detail = '') => ({ rule, status: 'PASS', detail });
const drift = (rule, detail) => ({ rule, status: 'DRIFT', detail });
const info = (rule, detail) => ({ rule, status: 'INFO', detail });

const COLOUR_PROPS =
  /^(--[\w-]+|color|background|background-color|background-image|border(-(top|right|bottom|left|block|inline))?(-(start|end))?(-color)?|border-image|border-image-source|outline(-color)?|fill|stroke|stop-color|flood-color|lighting-color|box-shadow|text-shadow|text-decoration(-color)?|text-emphasis(-color)?|column-rule(-color)?|scrollbar-color|accent-color|caret-color|filter|backdrop-filter|-webkit-text-fill-color|-webkit-text-stroke(-color)?|-webkit-tap-highlight-color)$/;
const FIXED_BTN_TOKEN = /^--btn-accent/;
const FIXED_SIZE_TOKEN = /^--font-size-/;
const NAME_IS_BUTTON = /\bbutton\b|btn|[-_.]button|\[(type|role)\s*[~|^$*]?=\s*["']?(button|submit|reset)/i;

/** The last compound selector of a complex selector (the element the rule styles). */
function subjectOf(part) {
  let depth = 0;
  let cur = '';
  let last = '';
  for (const ch of part.trim()) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~')) {
      if (cur) last = cur;
      cur = '';
    } else cur += ch;
  }
  return cur || last;
}

/** Could this compound selector style a button, given nothing rules it out (no class, or a button class)? */
function compoundMayBeButton(compound, ctx) {
  if (/::file-selector-button/i.test(compound)) return true;
  let rest = compound.replace(/::[\w-]+(\([^)]*\))?/g, '').replace(/:(?:before|after|first-line|first-letter)\b/gi, '');
  const alts = [];
  for (let at = rest.search(/:(?:is|where|matches|-webkit-any|-moz-any)\(/i); at !== -1; at = rest.search(/:(?:is|where|matches|-webkit-any|-moz-any)\(/i)) {
    const open = rest.indexOf('(', at);
    const end = closeParen(rest, open);
    alts.push(...splitTop(rest.slice(open + 1, end - 1), ','));
    rest = rest.slice(0, at) + (end === -1 ? '' : rest.slice(end));
  }
  for (let at = rest.search(/:(?:not|has)\(/i); at !== -1; at = rest.search(/:(?:not|has)\(/i)) {
    const end = closeParen(rest, rest.indexOf('(', at));
    rest = rest.slice(0, at) + (end === -1 ? '' : rest.slice(end));
  }
  rest = rest.trim();
  if (alts.length) return alts.some((a) => partTargetsButton(/[\s>+~]/.test(a.trim()) ? a : rest + a.trim(), ctx));
  const classes = [...rest.matchAll(/\.((?:[\w-]|\\.)+)/g)].map((m) => m[1].replace(/\\/g, ''));
  if (classes.length) return classes.some((k) => ctx.btnClasses.has(k));
  const tag = (/^(?:\*|[A-Za-z][\w-]*)/.exec(rest) || [''])[0].toLowerCase();
  if (tag && tag !== '*' && tag !== 'button' && tag !== 'summary') return false;
  if (/^:(?:root|host|scope)\b/i.test(rest)) return false;
  return tag === '*' || tag === 'button' || tag === 'summary' || /[#[:]/.test(rest);
}

function partTargetsButton(part, ctx) {
  if (NAME_IS_BUTTON.test(part)) return true;
  for (const m of part.matchAll(/\.((?:[\w-]|\\.)+)/g)) if (ctx.btnClasses.has(m[1].replace(/\\/g, ''))) return true;
  return ctx.hasButton && compoundMayBeButton(subjectOf(part), ctx);
}

/** Does any selector in the list target a button (by element, name, a class the JSX puts on one, or by not excluding one)? */
function targetsButton(selector, ctx) {
  return splitTop(selector, ',').some((part) => partTargetsButton(part, ctx));
}

function checkBanner(jsx, scope = NO_SCOPE) {
  const banner = /<SimBanner\b|role=["']note["']|className=["'][^"']*[\w-]*banner\b/.exec(jsx);
  if (!banner) return drift('P2 banner first', 'no simulation banner (SimBanner or role="note" .pu-banner) found');
  // A banner with nothing to read is no banner: <SimBanner></SimBanner>, <SimBanner />, {""}, an empty variable.
  const bannerTag = readTag(jsx, banner[0] === '<SimBanner' ? banner.index : jsx.lastIndexOf('<', banner.index));
  if (bannerTag && !(childrenPropHasText(bannerTag.attrs, scope) || (!bannerTag.selfClosing && hasVisibleText(readInner(jsx, bannerTag), scope)))) {
    return drift('P2 banner first', `the banner (<${bannerTag.name}>) has no text`);
  }
  const before = jsx.slice(0, banner.index);
  const title = /<PageHeader\b|<h1\b/.exec(before);
  if (title) return drift('P2 banner first', `the title band (${title[0]}) comes before the banner`);
  const body = /<(section|Section|Card|table|button|main|form|PageFrame)\b|className=["'][^"']*\b[\w-]*(card|frame|panel)\b/.exec(before);
  if (body) return drift('P2 banner first', `${body[0].trim()} comes before the banner`);
  return ok('P2 banner first');
}

/** The source of a tag's class / className / *ClassName attribute values (quoted text or {expression}). */
function classAttrText(attrs) {
  let out = '';
  const re = /(?:^|\s)(?:class|className|[A-Za-z]*Class(?:Name|es)?)\s*=\s*/g;
  for (let m = re.exec(attrs); m; m = re.exec(attrs)) {
    const i = m.index + m[0].length;
    if (attrs[i] === '"' || attrs[i] === "'") out += attrs.slice(i, attrs.indexOf(attrs[i], i + 1) + 1);
    else if (attrs[i] === '{') out += attrs.slice(i, closeBracket(attrs, i));
  }
  return out;
}

/** [start, end) of every .map()/.flatMap()/.forEach()/Array.from() call: JSX written inside one renders once per item. */
function loopRanges(src) {
  return [...src.matchAll(/(?:\.\s*(?:map|flatMap|forEach)|\bArray\.from)\s*\(/g)].map((m) => [m.index, closeBracket(src, m.index + m[0].length - 1)]);
}

function checkPrimary(jsx, info2) {
  let primaries = 0;
  let anyButton = false;
  const loops = loopRanges(jsx);
  const looped = [];
  eachTag(jsx, (t, at) => {
    const isBtn = tagIsButton(t, info2.comps);
    if (isBtn) anyButton = true;
    const tokens = classTokens(t.attrs, info2.scope);
    const classPrimary = tokens.some((k) => k === 'primary' || /(btn|button)[\w-]*primary$/i.test(k));
    const propPrimary = isBtn && /\bvariant\s*=\s*["']primary["']|\sprimary(?=[\s/=>]|$)/.test(` ${t.attrs}`);
    if (t.name === 'PrivilegeLiveCheck') {
      // Its default trigger is "btn btn-primary": a page that does not override it has a hidden primary.
      if (!/\bbuttonClassName\s*=/.test(t.attrs)) primaries += 1;
      else if (classPrimary) primaries += 1;
      return;
    }
    if (classPrimary || propPrimary) {
      primaries += 1;
      // A primary inside a loop repeats per item (more than one at runtime) unless its class is conditional (the selected tab).
      if (!/\?|&&|\|\|/.test(classAttrText(t.attrs)) && loops.some(([a, b]) => at > a && at < b)) {
        primaries += 1;
        looped.push(jsx.slice(0, at).split('\n').length);
      }
    }
  });
  if (looped.length) return drift('P9 one primary button', `a primary button is rendered inside a loop (line ${looped[0]}), so it repeats once per item (exactly one per view)`);
  if (primaries === 1) return ok('P9 one primary button');
  if (primaries > 1) return drift('P9 one primary button', `${primaries} primary buttons (exactly one per view)`);
  if (anyButton) return drift('P9 one primary button', 'has buttons but none is the primary');
  return info('P9 one primary button', 'no buttons on this page');
}

/** [start, end) of the inner source of every <PingPage> element. */
function pingPageRanges(src) {
  const out = [];
  eachTag(src, (t) => {
    if (t.name === 'PingPage' && !t.selfClosing) out.push([t.end, t.end + readInner(src, t).length]);
  });
  return out;
}

/**
 * P2: the banner and every button sit inside the <PingPage> root. A page with no <PingPage> at all fails. In a
 * page that has one, a banner or button is outside it when it sits in the same `return` as a <PingPage> but
 * beside it, not inside. JSX built into a variable before the return, or in a child component, is not
 * judged: the parent mounts it inside the root, and this check cannot follow where.
 */
function checkRoot(src, info2) {
  const R = 'P2 content inside PingPage';
  const ranges = pingPageRanges(src);
  if (!ranges.length) return /\bpu-page\b/.test(src) ? ok(R) : drift(R, 'no <PingPage> root (the banner and buttons must sit inside it)');
  // The element a `return` hands back, found by tag nesting (not by brackets: JSX text may hold a lone apostrophe).
  const returns = [...src.matchAll(/\breturn\s*\(?\s*(?=<)/g)]
    .map((m) => {
      const t = readTag(src, m.index + m[0].length);
      return t && !t.selfClosing ? [m.index, t.end + readInner(src, t).length] : null;
    })
    .filter(Boolean);
  const inside = (i) => ranges.some(([a, b]) => i >= a && i < b);
  const bad = [];
  eachTag(src, (t, at) => {
    const what = t.name === 'SimBanner' ? 'the banner' : tagIsButton(t, info2.comps) ? `<${t.name}>` : null;
    if (!what || inside(at)) return;
    const ret = returns.find(([a, b]) => at > a && at < b && ranges.some(([x]) => x > a && x < b));
    if (ret) bad.push(`${what} (line ${src.slice(0, at).split('\n').length})`);
  });
  return bad.length ? drift(R, `${bad.slice(0, 3).join('; ')} sits beside <PingPage>, not inside it`) : ok(R);
}

const BLANKS = /[\s​-‍⁠﻿]/g;
const NBSP_ENTITY = /&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj);|&#(?:160|8203|x[aA]0|x200[bB]);/g;
const BLANK_STRING = /^(["'`])(?:\s|\\u00a0|\\u200b|\\xa0|\\[nrt]|&nbsp;)*\1$/;

/** Is a JSX expression `{...}` blank: "", " ", null, undefined, false, [] or a + of blank strings? */
function blankExpression(expr, scope = NO_SCOPE) {
  const e = expr.trim();
  if (/^(null|undefined|false|true|void 0)?$/.test(e) || /^\[\s*\]$/.test(e)) return true;
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    // A variable whose every assignment in the file is blank, or one named for an icon/glyph/dot (no words in it).
    const defs = scope.get(e);
    if (defs && defs.length && defs.every((d) => blankExpression(d.trim().replace(/;$/, ''), NO_SCOPE))) return true;
    return /^(?:\w*[Ii]con|\w*[Gg]lyph|\w*Dot|dot)$/.test(e);
  }
  return e.split('+').every((p) => BLANK_STRING.test(p.trim()));
}

/** Does the inner source of a chip contain visible text? */
function hasVisibleText(inner, scope = NO_SCOPE) {
  let t = inner
    .replace(/<[A-Za-z][^>]*aria-hidden[^>]*\/>/g, '')
    .replace(/<([A-Za-z][\w.]*)[^>]*aria-hidden[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]*>/g, '');
  // Resolve {...} from the inside out: a blank expression vanishes, anything else counts as text.
  for (let guard = 0; guard < 20 && /\{[^{}]*\}/.test(t); guard += 1) {
    t = t.replace(/\{([^{}]*)\}/g, (_, e) => (blankExpression(e, scope) ? '' : '\u0001'));
  }
  return t.replace(NBSP_ENTITY, '').replace(BLANKS, '').length > 0;
}

/** A chip can also carry its text as a children={...} / children="..." prop. */
function childrenPropHasText(attrs, scope = NO_SCOPE) {
  const m = /\bchildren\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})/.exec(attrs);
  if (!m) return false;
  if (m[3] !== undefined) return !blankExpression(m[3], scope);
  return (m[1] ?? m[2]).replace(NBSP_ENTITY, '').replace(BLANKS, '').length > 0;
}

function checkChips(jsx, scope = NO_SCOPE) {
  const bad = [];
  eachTag(jsx, (t, at) => {
    const tokens = classTokens(t.attrs, scope);
    const chipClass = tokens.some((k) => !k.includes('__') && /(^|-)(chip|pill)(--[\w-]+)?$/.test(k));
    if (!(t.name === 'StatusChip' || chipClass)) return;
    const line = jsx.slice(0, at).split('\n').length;
    const text = childrenPropHasText(t.attrs, scope) || (!t.selfClosing && hasVisibleText(readInner(jsx, t), scope));
    if (!text) bad.push(`line ${line}: <${t.name}> has no text`);
  });
  if (bad.length) return drift('P7 chips carry text', bad.slice(0, 3).join('; '));
  return ok('P7 chips carry text');
}

const THEMEABLE_PROP =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|font-size|font|fill|stroke|outline(-color)?|box-shadow|text-shadow|accent-color|caret-color|text-decoration-color)$/;
const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Problems in the source of a style object literal (the text between its braces), or null. */
function styleObjectProblem(obj, scope = NO_SCOPE, onButton = false, depth = 0) {
  if (/(?:^|[{,])\s*\[/.test(obj)) return 'computed style key (cannot be checked)';
  if (onButton) {
    // style={{ ...tint }} on a button: the colour comes from a value this check cannot read.
    for (const m of obj.matchAll(/(?:^|[,{])\s*\.\.\.\s*([^,]+)/g)) {
      const expr = m[1].trim();
      const defs = /^[A-Za-z_$][\w$]*$/.test(expr) && depth < 3 ? scope.get(expr) : null;
      if (!defs || !defs.length || !defs.every((d) => d.trim().startsWith('{'))) return `button style spreads ${short(expr)}, which the check cannot read`;
      for (const d of defs) {
        const inner = styleObjectProblem(d.trim().slice(1, -1), scope, true, depth + 1);
        if (inner) return inner;
      }
    }
  }
  for (const m of obj.matchAll(/(?:^|[,{])\s*(['"`]?)(-{0,2}[\w-]+)\1\s*:/g)) {
    const raw = m[2];
    const name = raw.startsWith('--') ? raw : kebab(raw);
    if (THEMEABLE_PROP.test(name)) return `inline style sets ${raw}`;
    if (FIXED_BTN_TOKEN.test(name) || FIXED_SIZE_TOKEN.test(name)) return `inline style overrides the fixed token ${raw}`;
  }
  if (COLOUR_LITERAL.test(obj)) return 'colour literal in inline style';
  return null;
}

function checkInlineColour(jsx, scope = NO_SCOPE, comps = new Set()) {
  const bad = [];
  eachTag(jsx, (t, at) => {
    const line = jsx.slice(0, at).split('\n').length;
    const sm = /\bstyle\s*=\s*/.exec(t.attrs);
    if (sm) {
      const i = sm.index + sm[0].length;
      let problem = null;
      if (t.attrs[i] === '"' || t.attrs[i] === "'") {
        const e = t.attrs.indexOf(t.attrs[i], i + 1);
        const text = t.attrs.slice(i + 1, e === -1 ? undefined : e);
        const decl = /(?:^|;)\s*(-{0,2}[\w-]+)\s*:/g;
        for (let d = decl.exec(text); d && !problem; d = decl.exec(text)) {
          if (THEMEABLE_PROP.test(d[1].toLowerCase()) || FIXED_BTN_TOKEN.test(d[1]) || FIXED_SIZE_TOKEN.test(d[1])) problem = `inline style sets ${d[1]}`;
        }
        if (!problem && COLOUR_LITERAL.test(text)) problem = 'colour literal in inline style';
      } else if (t.attrs[i] === '{') {
        const inner = t.attrs.slice(i + 1, closeBracket(t.attrs, i) - 1).trim();
        const onButton = tagIsButton(t, comps);
        if (inner.startsWith('{')) problem = styleObjectProblem(inner.slice(1, -1), scope, onButton);
        else {
          const id = /^[A-Za-z_$][\w$]*$/.exec(inner);
          for (const rhs of id && scope.has(inner) ? scope.get(inner) : []) {
            if (rhs.trim().startsWith('{')) problem = problem || styleObjectProblem(rhs.trim().slice(1, -1), scope, onButton);
          }
        }
      }
      if (problem) bad.push(`line ${line}: ${problem}`);
    }
    const attr = /\b(fill|stroke|color|stopColor|floodColor)\s*=\s*["'](#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|oklab|oklch|lab|lch|color|color-mix|light-dark)\([^"']*\))["']/.exec(t.attrs);
    if (attr) bad.push(`line ${line}: ${attr[1]} attribute is a colour literal`);
  });
  for (const m of jsx.matchAll(/['"`]#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?['"`]/g)) {
    bad.push(`line ${jsx.slice(0, m.index).split('\n').length}: hex colour literal ${m[0]}`);
  }
  for (const m of jsx.matchAll(/\.setAttribute\s*\(\s*["'`]style["'`]/g)) {
    bad.push(`line ${jsx.slice(0, m.index).split('\n').length}: element.setAttribute('style') (inline style set from script)`);
  }
  for (const m of jsx.matchAll(/\.style\s*(?:\.\s*(color|background\w*|border\w*|fontSize|fill|stroke|outline\w*|boxShadow|textShadow|cssText)\s*=(?!=)|\.\s*(setProperty|cssText)\b|\[)/g)) {
    bad.push(`line ${jsx.slice(0, m.index).split('\n').length}: element.style assignment (${m[1] || m[2] || 'computed'})`);
  }
  const uniq = [...new Set(bad)];
  if (uniq.length) return drift('H3 no inline colour', uniq.slice(0, 3).join('; '));
  return ok('H3 no inline colour');
}

const short = (raw) => {
  const v = raw.replace(/\s+/g, ' ');
  return v.length > 70 ? `${v.slice(0, 67)}...` : v;
};
const uniqJoin = (list) => [...new Set(list)].slice(0, 3).join('; ');

/**
 * Button colour (P9), font floor (H2) and the fixed tokens over [{ file, css }], with custom properties from
 * `tokens` plus the files'. `ctx` = { btnClasses, hasButton }. `allTokens` also tests every definition in the
 * merged token map (the shared check, which owns the global stylesheet's tokens).
 */
function checkCss(cssFiles, tokens, ctx, { allTokens = false } = {}) {
  const parsed = cssFiles.map(({ file, css }) => ({ file, rules: parseCss(css), esc: scanEscapes(css) }));
  const all = copyTokens(tokens);
  for (const { rules } of parsed) addTokens(all, rules);
  all.remPx = rootRemPx(
    parsed.flatMap((p) => p.rules),
    all,
    tokens.remPx === undefined ? 16 : tokens.remPx,
  );
  // @keyframes that a button rule animates are button rules too.
  const kf = new Set();
  for (const { rules } of parsed) {
    for (const rule of rules) {
      if (rule.keyframes || rule.selector.startsWith('@') || !targetsButton(rule.selector, ctx)) continue;
      for (const [prop, value] of rule.decls) {
        if (prop !== 'animation' && prop !== 'animation-name') continue;
        for (const v of expandVars(value, all).values) for (const m of v.matchAll(/-?[A-Za-z_][\w-]*/g)) kf.add(m[0]);
      }
    }
  }
  const violet = [];
  const unkColour = [];
  const small = [];
  const unkSize = [];
  const badBtn = [];
  const badScale = [];
  for (const { file, rules, esc } of parsed) {
    for (const rule of rules) {
      const btn = rule.keyframes ? kf.has(rule.keyframes) : !rule.selector.startsWith('@') && targetsButton(rule.selector, ctx);
      for (const [prop, value, meta] of rule.decls) {
        const where = `${file}:${meta.line} ${rule.selector} { ${prop}: ${short(value)} }`;
        const allowed = isAllowed(esc, meta);
        if (!allTokens && FIXED_BTN_TOKEN.test(prop)) {
          const r = colourProblems(value, all);
          if (r.violet.length || r.vertical) badBtn.push(where);
          else if (r.unknown.length && !allowed) badBtn.push(`${where} (unresolvable)`);
        }
        if (!allTokens && FIXED_SIZE_TOKEN.test(prop)) {
          const r = fontProblems('font-size', value, all);
          if (r.small.length) badScale.push(where);
          else if (r.unknown.length && !allowed) badScale.push(`${where} (unresolvable)`);
        }
        if (btn && COLOUR_PROPS.test(prop)) {
          const r = colourProblems(value, all);
          if (r.violet.length) violet.push(`${where} (${r.violet[0]})`);
          if (r.vertical) violet.push(`${where} (reads a vertical colour token)`);
          if (r.unknown.length && !allowed) unkColour.push(`${where} (${r.unknown[0]})`);
        }
        const f = fontProblems(prop, value, all);
        if (f.small.length) small.push(`${where} (${f.small[0]})`);
        if (f.unknown.length && !allowed) unkSize.push(`${where} (${f.unknown[0]})`);
      }
    }
  }
  if (allTokens) {
    for (const [name, values] of all) {
      for (const v of values) {
        if (FIXED_BTN_TOKEN.test(name)) {
          const r = colourProblems(v, all);
          if (r.violet.length || r.vertical || r.unknown.length) badBtn.push(`${name}: ${short(v)}`);
        }
        if (FIXED_SIZE_TOKEN.test(name)) {
          const r = fontProblems('font-size', v, all);
          if (r.small.length || r.unknown.length) badScale.push(`${name}: ${short(v)}`);
        }
      }
    }
  }
  const row = (rule, list) => (list.length ? drift(rule, uniqJoin(list)) : ok(rule));
  const results = [
    row('P9 no violet/indigo or vertical colour on buttons', violet),
    row('P9 button colours resolvable', unkColour),
    row('H2 10px font floor', small),
    row('H2 font sizes resolvable', unkSize),
    row('P9 fixed button tokens (--btn-accent*) are not violet/indigo', badBtn),
    row('H2 type scale (--font-size-*) stays at 10px or above', badScale),
  ];
  const escapes = parsed.flatMap(({ file, esc }) => esc.ok.map((e) => `${file}:${e.line} ${e.reason}`));
  const noReason = parsed.flatMap(({ file, esc }) => esc.bad.map((e) => `${file}:${e.line}`));
  if (noReason.length) results.push(drift('ui-pattern escape needs a reason', `${uniqJoin(noReason)} (write /* ui-pattern: allow <reason of 8+ characters> */)`));
  if (escapes.length) results.push(info(ESC_RULE, escapes.join('; ')));
  return results;
}

/**
 * Check one page. `jsx` is its source; `css` is [{ file, css }] for the stylesheets it imports; `tokens`
 * is the global custom-property Map (loadGlobalTokens); `buttonClasses` adds classes known to sit on buttons;
 * `unreadable` lists stylesheet imports (scss, less...) the check cannot read.
 */
const VIOLET_UTILITY = /(?:^|[-:/])(?:indigo|violet|purple|fuchsia|magenta|rebeccapurple|blueviolet|darkviolet|mediumpurple|slateblue)(?:-\d{2,3}(?:\/\d+)?)?$/i;

/** Utility classes (bg-indigo-600, text-violet-500, bg-[#6d28d9]) that the JSX puts on a button. */
function violetButtonClasses(classes) {
  return [...classes].filter((k) => VIOLET_UTILITY.test(k) || (/\[[^\]]+\]/.test(k) && violetLiterals(k.slice(k.indexOf('[') + 1, k.lastIndexOf(']'))).length));
}

export function checkPage({ jsx, css = [], tokens = new Map(), buttonClasses: extra = [], unreadable = [] }) {
  const src = stripJsComments(jsx);
  const page = analyse(src);
  const embedded = embeddedCss(src, page);
  const ctx = { btnClasses: mergeClassSets(page.classes, extra instanceof Set ? extra : new ClassSet(extra), new ClassSet(embedded.btn)), hasButton: page.hasButton };
  const sheets = [...css, ...embedded.blocks];
  const results = [
    checkBanner(src, page.scope),
    checkRoot(src, page),
    checkPrimary(src, page),
    checkChips(src, page.scope),
    checkInlineColour(src, page.scope, page.comps),
    ...checkCss(sheets, tokens, ctx),
    unreadable.length ? drift('stylesheets readable', `${unreadable.join(', ')} cannot be read by this check (use plain CSS)`) : ok('stylesheets readable'),
  ];
  const utility = violetButtonClasses(page.classes);
  if (utility.length) {
    const i = results.findIndex((r) => r.rule === 'P9 no violet/indigo or vertical colour on buttons');
    const detail = `button class ${utility.slice(0, 3).join(', ')} is a violet/indigo utility`;
    results[i] = drift(results[i].rule, results[i].detail ? `${results[i].detail}; ${detail}` : detail);
  }
  return results;
}

// ---------- files, imports, tokens ----------

const EXTS = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js', '/index.tsx'];
function resolveFile(base, rel) {
  const p = path.resolve(base, rel);
  for (const e of EXTS) {
    const f = p + e;
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

/** Read a stylesheet and every stylesheet it pulls in with @import or `composes ... from` (transitively). */
export function readCssTree(file, root = UI_ROOT, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs) || !fs.existsSync(abs)) return [];
  seen.add(abs);
  const css = fs.readFileSync(abs, 'utf8');
  const out = [{ file: path.relative(root, abs), css }];
  const bare = stripCssComments(css);
  const refs = [
    ...[...bare.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?/gi)].map((m) => m[1]),
    ...[...bare.matchAll(/\bcomposes\s*:[^;{}]*?\bfrom\s+["']?([^"')\s;]+)["']?/gi)].map((m) => m[1]),
  ];
  for (const ref of refs) {
    if (/^(https?:|\/\/|data:|~|\/)/.test(ref) || !/\.css$/i.test(ref)) continue;
    out.push(...readCssTree(path.resolve(path.dirname(abs), ref), root, seen));
  }
  return out;
}

/** Stylesheets a JS/JSX/TS file imports (side-effect, default, import() or require()), with their @imports. */
function importedCss(file, jsx, root, seen = new Set(), unreadable = []) {
  const out = [];
  const re = /(?:\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?|\bimport\s*\(\s*|\brequire\s*\(\s*)["'](\.[^"']+)["']/g;
  for (const m of stripJsComments(jsx).matchAll(re)) {
    if (CSS_EXT.test(m[1])) out.push(...readCssTree(path.resolve(path.dirname(file), m[1]), root, seen));
    else if (UNREADABLE_STYLE.test(m[1])) unreadable.push(m[1]);
  }
  return out;
}

/** Default imports and `const X = lazyWithRetry(() => import("./..."))` bindings of a module: name -> relative specifier. */
function moduleComps(src) {
  const comps = {};
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*lazyWithRetry\(\s*\(\)\s*=>\s*import\(\s*["'](\.[^"']+)["']\s*\)\s*\)/g)) comps[m[1]] = m[2];
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+["'](\.[^"']+)["']/g)) comps[m[1]] = m[2];
  return comps;
}

/** Named imports, `import { A, B as C } from "./..."`: local name -> relative specifier. */
function namedImports(src) {
  const named = {};
  for (const m of src.matchAll(/import\s*(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig) named[alias || orig] = { spec: m[2], orig };
    }
  }
  return named;
}

/** Source of `export function Name` / `export const Name =` up to the next top-level export, or null. */
function exportedBody(src, name) {
  const head = new RegExp(`export\\s+(?:default\\s+)?(?:function\\s+${escapeRe(name)}\\b|const\\s+${escapeRe(name)}\\s*=)`).exec(src);
  if (!head) return null;
  const rest = src.slice(head.index + head[0].length);
  const next = rest.search(/\n(?:export|function|const|class)\s/);
  return next < 0 ? rest : rest.slice(0, next);
}

// Where a real page lives. A component imported from anywhere else (routes/ wrappers, context providers, hooks)
// is chrome around a page, never the page.
const PAGE_DIR = /^(?:pages|components)\//;
// Chrome and guards that wrap a page, in routes/ wrappers and in App.js route elements (nav bar, sign-in prompt,
// error boundary, provider-switch guard). They are never the page.
const WRAPPER_CHROME = /^(?:AppShell|TopNav|SignInPrompt|ConfirmModal|ErrorBoundary)$|(?:Guard|Provider)$/;

/**
 * The page file a wrapper component (a named export of a routes/ module, such as `IntentBindingLearningPageRoute`,
 * which is AppShell + the page) renders: the first tag in its body that is a default import, a lazy import or a
 * named import from pages/ or components/. Follows a wrapper that renders another wrapper of the same module.
 */
function wrapperPage(modFile, exportName, seen = new Set(), depth = 0) {
  const key = `${modFile}#${exportName}`;
  if (depth > 3 || seen.has(key) || !fs.existsSync(modFile)) return null;
  seen.add(key);
  const src = fs.readFileSync(modFile, 'utf8');
  const body = exportedBody(src, exportName);
  if (body == null) return null;
  const comps = moduleComps(src);
  const named = namedImports(src);
  const dir = path.dirname(modFile);
  for (const m of body.matchAll(/<([A-Z]\w*)/g)) {
    const n = m[1];
    if (WRAPPER_CHROME.test(n)) continue;
    const spec = comps[n] || named[n]?.spec;
    const f = spec && resolveFile(dir, spec);
    if (f && PAGE_DIR.test(path.relative(path.dirname(dir), f).split(path.sep).join('/'))) {
      return f;
    } else if (!spec && exportedBody(src, n)) {
      const inner = wrapperPage(modFile, n, seen, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * Map route path -> page file, read from the <Route path element> entries of App.js. A page behind a named
 * wrapper from src/routes/ (`<XPageRoute>` = AppShell + the page) resolves to the real page, also when the element
 * is `user ? <XPageRoute/> : <SignInRequired/>` or sits inside `<RequireAdminLogin>`. Chrome (TopNav, AppShell, ...)
 * never counts as the page, and when a path has several entries the first one that resolves wins.
 */
export function loadRoutes(root = UI_ROOT) {
  const appFile = path.join(root, 'src', 'App.js');
  const app = fs.readFileSync(appFile, 'utf8');
  const comps = moduleComps(app);
  const named = namedImports(app);
  const routes = {};
  // element={<Wrapper><Page /></Wrapper>}: the page is the first component that is not a routes/ wrapper.
  for (const m of app.matchAll(/path=["'](\/[^"']*)["']\s*element=\{(?=((?:(?!<Route\b)[\s\S]){0,300}))/g)) {
    const allNames = [...m[2].matchAll(/<([A-Z]\w*)/g)].map((x) => x[1]);
    const names = allNames.filter((n) => comps[n]);
    // Chrome (TopNav, ...) is never the page: `<TopNav/><main><Page/></main>` resolves to Page.
    const name = names.find((n) => !/\/routes\//.test(comps[n]) && !WRAPPER_CHROME.test(n));
    let file = name && resolveFile(path.dirname(appFile), comps[name]);
    if (!file) {
      // Only a routes/ file (SignInRequired, RequireAdminLogin, ...) or nothing resolved: follow a named wrapper to its page.
      for (const n of allNames) {
        const imp = named[n];
        const mod = imp && /\/routes\//.test(imp.spec) && resolveFile(path.dirname(appFile), imp.spec);
        const page = mod && wrapperPage(mod, imp.orig);
        if (page) {
          file = page;
          break;
        }
      }
    }
    const rest = names.find((n) => !WRAPPER_CHROME.test(n));
    if (!file && rest) file = resolveFile(path.dirname(appFile), comps[rest]);
    // Several <Route> entries can share a path (a public one at the top level, a nested user/admin switch inside
    // path="*"). The FIRST entry that resolves to a page wins: an entry that is only chrome or a gate resolves to
    // nothing and is skipped, so a later one can still supply the page.
    if (file && !(m[1] in routes)) routes[m[1]] = file;
  }
  return routes;
}

export function loadAllowlist(file = ALLOWLIST) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean);
}

/** Read a page file and the stylesheets it imports (following @import). */
export function readPage(file, root = UI_ROOT) {
  const jsx = fs.readFileSync(file, 'utf8');
  const unreadable = [];
  return { jsx, css: importedCss(file, jsx, root, new Set(), unreadable), unreadable };
}

/** Every file under `abs`, recursively, classified: { abs, kind: 'script' | 'css' | 'inert' | 'unknown' | 'symlink' }. */
function walkDir(abs, out = []) {
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(abs, ent.name);
    if (ent.name === '.DS_Store') continue;
    if (ent.isSymbolicLink()) out.push({ abs: p, kind: 'symlink' });
    else if (ent.isDirectory()) walkDir(p, out);
    else {
      const kind = SCRIPT_EXT.test(ent.name) ? 'script' : CSS_EXT.test(ent.name) ? 'css' : INERT_EXT.test(ent.name) ? 'inert' : 'unknown';
      out.push({ abs: p, kind });
    }
  }
  return out;
}

/** Custom properties from src/index.css and every .css under src/styles/ (recursive), for resolving var() chains. */
export function loadGlobalTokens(root = UI_ROOT) {
  const tokens = new Map();
  const files = [
    ...TOKEN_FILES.map((f) => path.join(root, f)),
    ...TOKEN_DIRS.flatMap((d) => walkDir(path.join(root, d)).filter((f) => f.kind === 'css').map((f) => f.abs)),
  ];
  const seen = new Set();
  const rules = [];
  for (const f of files) for (const { css } of readCssTree(f, root, seen)) rules.push(...parseCss(css));
  addTokens(tokens, rules);
  tokens.remPx = rootRemPx(rules, tokens);
  return tokens;
}

// ---------- the shared set ----------

const isScript = (f) => f.kind === 'script';

/** The shared files that exist, as [{ rel, abs, kind }], the listed ones that do not, and the ones the scanner cannot read. */
export function sharedFiles(root = UI_ROOT) {
  const present = [];
  const missing = [];
  const unreadable = [];
  const take = (abs, kind) => {
    const rel = path.relative(root, abs);
    if (present.some((p) => p.abs === abs) || unreadable.includes(rel)) return;
    if (kind === 'script' || kind === 'css') present.push({ rel, abs, kind });
    else if (kind !== 'inert') unreadable.push(rel);
  };
  for (const rel of SHARED_FILES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) take(abs, SCRIPT_EXT.test(rel) ? 'script' : CSS_EXT.test(rel) ? 'css' : 'unknown');
    else missing.push(rel);
  }
  for (const dir of SHARED_DIRS) {
    const found = walkDir(path.join(root, dir));
    if (!found.length) missing.push(`${dir}/ (no files)`);
    for (const f of found) take(f.abs, f.kind);
  }
  return { present, missing, unreadable };
}

/** Button classes the shared components put on a button (e.g. PrivilegeLiveCheck's plc__run). */
function sharedButtonClasses(files) {
  const set = new ClassSet();
  for (const f of files.filter(isScript)) {
    const found = buttonClasses(fs.readFileSync(f.abs, 'utf8'));
    for (const k of found) set.add(k);
    set.patterns.push(...found.patterns);
  }
  return set;
}

/**
 * Check the shared stylesheet and components once. `extraButtonClasses` adds the classes that enforced
 * pages put on their buttons, so a shared rule such as `.pu-go` is judged as a button rule.
 */
export function checkShared({ root = UI_ROOT, tokens = new Map(), extraButtonClasses = [] } = {}) {
  const { present, missing, unreadable } = sharedFiles(root);
  const results = missing.map((m) => drift('shared files present', `${m} is listed in SHARED_FILES/SHARED_DIRS but missing (renamed? update the script)`));
  if (unreadable.length) {
    results.push(drift('shared files understood', `${uniqJoin(unreadable)} cannot be scanned (only .js/.jsx/.ts/.tsx/.mjs/.cjs and .css are read; .md/.txt are inert; no symlinks)`));
  }
  const scripts = present.filter(isScript);
  const sources = scripts.map((f) => ({ rel: f.rel, src: stripJsComments(fs.readFileSync(f.abs, 'utf8')) }));
  const btn = mergeClassSets(sharedButtonClasses(present), extraButtonClasses instanceof Set ? extraButtonClasses : new ClassSet(extraButtonClasses));
  const seen = new Set();
  const css = [];
  for (const f of present.filter((p) => p.kind === 'css')) css.push(...readCssTree(f.abs, root, seen));
  for (const f of scripts) css.push(...importedCss(f.abs, fs.readFileSync(f.abs, 'utf8'), root, seen));
  for (const { rel, src } of sources) {
    const info2 = analyse(src);
    const emb = embeddedCss(src, info2);
    css.push(...emb.blocks.map((b) => ({ file: `${rel} ${b.file}`, css: b.css })));
    emb.btn.forEach((k) => btn.add(k));
  }
  const perFile = (fn) => {
    const rs = sources.map(({ rel, src }) => ({ rel, r: fn(src) }));
    const bad = rs.filter((x) => x.r.status === 'DRIFT');
    return bad.length ? drift(rs[0].r.rule, bad.map((x) => `${x.rel}: ${x.r.detail}`).join('; ')) : ok(rs[0].r.rule);
  };
  if (sources.length) results.push(perFile((s) => checkChips(s, collectScope(s))), perFile((s) => checkInlineColour(s, collectScope(s))));
  results.push(...checkCss(css, tokens, { btnClasses: btn, hasButton: true }, { allTokens: true }));
  const labelled = results.map((r) => ({ ...r, rule: `shared: ${r.rule}` }));
  return { files: present.map((p) => p.rel), results: labelled, failed: labelled.filter((r) => r.status === 'DRIFT') };
}

// ---------- running ----------

/** Relative component imports of a page that the shared set does not scan (the check cannot see inside them). */
function unscannedChildren(file, jsx, root, shared) {
  const out = [];
  for (const m of stripJsComments(jsx).matchAll(/import\s+[^'"]*?from\s+["'](\.[^"']+)["']/g)) {
    const f = resolveFile(path.dirname(file), m[1]);
    if (f && /\.[jt]sx$/.test(f) && !shared.includes(path.relative(root, f))) out.push(path.relative(root, f));
  }
  return out;
}

/** Run every routed page and the shared set. Returns { pages, missing, shared }. */
export function runAll({ root = UI_ROOT, allowlist = loadAllowlist(path.join(root, 'scripts', 'ui-pattern-converted.txt')), strict = false } = {}) {
  const routes = loadRoutes(root);
  const tokens = loadGlobalTokens(root);
  const sharedPresent = sharedFiles(root).present;
  const sharedBtn = sharedButtonClasses(sharedPresent);
  const sharedRel = sharedPresent.map((p) => p.rel);
  const byFile = new Map();
  for (const [route, file] of Object.entries(routes)) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(route);
  }
  const missing = allowlist.filter((r) => !routes[r]);
  const enforcedBtn = new ClassSet();
  const pages = [...byFile.entries()].map(([file, rs]) => {
    const page = readPage(file, root);
    const results = checkPage({ ...page, tokens, buttonClasses: sharedBtn });
    const enforced = strict || rs.some((r) => allowlist.includes(r));
    if (enforced) {
      const found = buttonClasses(page.jsx);
      for (const k of found) enforcedBtn.add(k);
      enforcedBtn.patterns.push(...found.patterns);
    }
    const failed = results.filter((r) => r.status === 'DRIFT');
    const unscanned = enforced ? unscannedChildren(file, page.jsx, root, sharedRel) : [];
    return { routes: rs, file: path.relative(root, file), results, enforced, failed, unscanned };
  });
  const shared = checkShared({ root, tokens, extraButtonClasses: enforcedBtn });
  return { pages, missing, shared };
}

const printRow = (r) => console.log(`    ${r.status.padEnd(5)} ${r.rule}${r.detail ? ` - ${r.detail}` : ''}`);

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const verbose = args.includes('--verbose');
  const routeArg = args.includes('--route') ? args[args.indexOf('--route') + 1] : null;
  const { pages, missing, shared } = runAll({ strict });
  let exit = 0;
  let escapes = 0;
  for (const m of missing) {
    console.error(`ALLOWLIST ${m}: no <Route> with this path in src/App.js (rename or remove it in scripts/ui-pattern-converted.txt)`);
    exit = 1;
  }
  console.log(`${shared.failed.length ? 'DRIFT' : 'PASS '}  [SHARED, always enforced] ${shared.files.join(', ')}`);
  for (const r of shared.results) if (verbose || routeArg || r.status === 'DRIFT' || r.rule.endsWith(ESC_RULE)) printRow(r);
  escapes += shared.results.filter((r) => r.rule.endsWith(ESC_RULE)).length;
  if (shared.failed.length) exit = 1;
  let clean = 0;
  for (const p of pages) {
    if (routeArg && !p.routes.includes(routeArg)) continue;
    const tag = p.enforced ? 'ENFORCED' : 'advisory';
    if (!p.failed.length) clean += 1;
    const detail = p.enforced || verbose || routeArg;
    console.log(
      `${p.failed.length ? 'DRIFT' : 'PASS '}  [${tag}] ${p.routes.join(', ')}  (${p.file})` +
        (detail || !p.failed.length ? '' : `: ${p.failed.map((r) => r.rule).join(', ')}`),
    );
    if (detail) {
      for (const r of p.results) printRow(r);
      if (p.unscanned.length) console.log(`    INFO  child components not scanned: ${p.unscanned.join(', ')}`);
    } else for (const r of p.results.filter((x) => x.rule === ESC_RULE)) printRow(r);
    escapes += p.results.filter((r) => r.rule === ESC_RULE).length;
    if (p.enforced && p.failed.length) exit = 1;
  }
  const enforcedPages = pages.filter((p) => p.enforced);
  console.log(
    `${pages.length} routed pages: ${clean} clean, ${pages.length - clean} with drift; ` +
      `${enforcedPages.length} enforced (${enforcedPages.filter((p) => p.failed.length).length} failing); ` +
      `shared set ${shared.failed.length ? 'FAILING' : 'clean'}; ${escapes} file(s) with ui-pattern escapes`,
  );
  if (exit) console.error('FAIL: an enforced page or the shared Ping UI set drifted from the Ping UI Standard (see DRIFT lines above).');
  process.exit(exit);
}

// Compare real paths: a symlinked cwd (macOS /var -> /private/var) must not turn the run into a silent no-op.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
