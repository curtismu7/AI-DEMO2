'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USE_CASES_SRC = fs.readFileSync(path.join(__dirname, '../../config/useCases.js'), 'utf8');
const SOURCE_IDS = [...USE_CASES_SRC.matchAll(/^ {4}id: '([^']+)',/gm)].map((m) => m[1]);

function load(edition) {
  jest.resetModules();
  jest.doMock('../../config/edition', () => {
    const real = jest.requireActual('../../config/edition');
    return { ...real, loadEdition: () => edition };
  });
  return require('../../config/useCases');
}

afterEach(() => jest.dontMock('../../config/edition'));

describe('edition use-case filter', () => {
  test('no edition file: every use case present, in source order', () => {
    const { USE_CASES } = load({ dropUseCases: [] });
    expect(USE_CASES.map((u) => u.id)).toEqual(SOURCE_IDS);
    expect(USE_CASES.map((u) => u.id)).toContain('UC40');
  });

  test('dropUseCases removes only the listed id', () => {
    const { USE_CASES, getUseCase } = load({ dropUseCases: ['UC40'] });
    expect(USE_CASES.map((u) => u.id)).toEqual(SOURCE_IDS.filter((id) => id !== 'UC40'));
    expect(getUseCase('UC40')).toBeUndefined();
  });
});

describe('loadEdition', () => {
  const { loadEdition } = jest.requireActual('../../config/edition');
  const tmp = (body) => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ed-')), 'edition.json');
    if (body !== undefined) fs.writeFileSync(f, body);
    return f;
  };

  test('missing file means no drops', () => {
    expect(loadEdition(tmp())).toEqual({ dropUseCases: [] });
  });
  test('reads dropUseCases', () => {
    expect(loadEdition(tmp('{"dropUseCases":["UC40"]}')).dropUseCases).toEqual(['UC40']);
  });
  test('malformed JSON throws', () => {
    expect(() => loadEdition(tmp('{nope'))).toThrow(/edition\.json/);
  });
  test('wrong shape throws', () => {
    expect(() => loadEdition(tmp('{"dropUseCases":"UC40"}'))).toThrow(/dropUseCases/);
  });
  test('an edition file exists only in an exported edition (root .edition.json marks one)', () => {
    // The source repo must never ship config/edition.json (it would filter the
    // catalog there); an exported edition must (export-edition.js writes it
    // plus the root .edition.json marker). Tying the two keeps both invariants.
    const exported = fs.existsSync(path.join(__dirname, '../../../.edition.json'));
    expect(fs.existsSync(path.join(__dirname, '../../config/edition.json'))).toBe(exported);
  });
});
