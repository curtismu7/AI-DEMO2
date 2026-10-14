'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkJevSync } = require('./check-learning-sync');

const content = (gallery, articles) => `
export const GALLERY = [
${gallery.map((id) => `  { id: '${id}', label: 'L', title: 'T', icon: 'doc' },`).join('\n')}
];

export const ARTICLES = {
${articles.map((id) => `  '${id}': {\n    scenario: 'x',\n    nested: { id: 'inner', label: 'not a demo' },\n  },`).join('\n')}
};
`;
const nav = (ids) => ids.map((id) => `{ label: "X", path: "/jev-demos/${id}", icon: "doc" },`).join('\n');
const doc = (ids) => `${ids.map((id) => `- **X** — https://h:4000/jev-demos/${id}`).join('\n')}\nIndex: https://h:4000/jev-demos\n`;
const ids = ['pr-review', 'doc-sort'];

test('all four surfaces agree: no problems (nested ids and the bare index URL are ignored)', () => {
  assert.deepStrictEqual(
    checkJevSync({ contentSrc: content(ids, ids), navSrc: nav(ids), docSrc: doc(ids) }), []);
});

test('a gallery demo missing from ARTICLES, the nav, and the URL doc is reported for each', () => {
  const problems = checkJevSync({
    contentSrc: content([...ids, 'trading'], ids), navSrc: nav(ids), docSrc: doc(ids),
  });
  assert.strictEqual(problems.length, 3);
  assert.ok(problems.some((p) => /trading.*ARTICLES/.test(p)));
  assert.ok(problems.some((p) => /trading.*AdminSideNav/.test(p)));
  assert.ok(problems.some((p) => /trading.*jev-demo-urls/.test(p)));
});

test('a nav link or doc URL for a demo that is not in the gallery is reported', () => {
  const problems = checkJevSync({
    contentSrc: content(ids, ids), navSrc: nav([...ids, 'ghost']), docSrc: doc([...ids, 'ghost']),
  });
  assert.strictEqual(problems.length, 2);
  assert.ok(problems.every((p) => /ghost.*not in GALLERY/.test(p)));
});
