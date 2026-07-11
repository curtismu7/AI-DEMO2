'use strict';

const path = require('node:path');
const { validateIntent } = require('../../services/llmResponseContract');

describe('validateIntent', () => {
  it('accepts the three renderable kinds with required fields', () => {
    expect(validateIntent({ kind: 'banking', banking: { action: 'accounts', params: {} } })).toBe(true);
    expect(validateIntent({ kind: 'education', education: { panel: 'token-exchange', tab: 'what' } })).toBe(true);
    expect(validateIntent({ kind: 'education', ciba: true, tab: 'what' })).toBe(true);
    expect(validateIntent({ kind: 'vertical', vertical: 'healthcare', action: 'view_records', params: {} })).toBe(true);
  });

  it('rejects structurally broken variants of valid kinds', () => {
    expect(validateIntent({ kind: 'banking' })).toBe(false);                       // no banking object
    expect(validateIntent({ kind: 'banking', banking: { action: '' } })).toBe(false);
    expect(validateIntent({ kind: 'banking', banking: { params: {} } })).toBe(false); // no action
    expect(validateIntent({ kind: 'vertical', action: 'view_records' })).toBe(false); // no vertical
    expect(validateIntent({ kind: 'vertical', vertical: 'retail' })).toBe(false);     // no action
    expect(validateIntent({ kind: 'education' })).toBe(false);                        // no education/ciba
  });

  it('rejects none, unknown kinds, and non-objects', () => {
    expect(validateIntent({ kind: 'none', message: 'hint' })).toBe(false);
    expect(validateIntent({ kind: 'hallucinated_kind', data: {} })).toBe(false);
    expect(validateIntent(null)).toBe(false);
    expect(validateIntent(['kind'])).toBe(false);
    expect(validateIntent('{"kind":"banking"}')).toBe(false);
  });

  it('accepts every non-none example shape taught in HELIX_AGENT_DIRECTIVES.json', () => {
    const directives = require(path.join(__dirname, '../../../docs/HELIX_AGENT_DIRECTIVES.json'));
    const corpus = [directives.base, ...Object.values(directives.themes)].join('\n');
    const examples = corpus.match(/\{"kind":[^\n]*\}/g) || [];
    expect(examples.length).toBeGreaterThan(10); // the directives teach many shapes
    let checked = 0;
    for (const line of examples) {
      let obj;
      try { obj = JSON.parse(line); } catch (_) { continue; } // skip non-JSON template lines
      if (obj.kind === 'none') continue;
      expect({ line, valid: validateIntent(obj) }).toEqual({ line, valid: true });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
