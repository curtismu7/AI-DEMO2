const { REQUIRED_METHODS, validatePlugin } = require('../../services/verticalManifest/pluginContract');

describe('plugin contract', () => {
  const goodPlugin = {
    getManifest: () => ({ id: 'x' }),
    getTools: () => [{ name: 't', description: 'd', inputSchema: { type: 'object' }, scopes: ['read'], authz: {} }],
    getHeuristics: () => [{ re: /foo/, action: 't' }],
    getSystemPrompt: () => 'prompt',
    getDataStore: () => ({}),
    executeTool: async () => ({ result: {}, render: null }),
    getAuthz: () => ({ t: {} }),
  };

  it('lists every required method', () => {
    expect(REQUIRED_METHODS).toEqual([
      'getManifest', 'getTools', 'getHeuristics', 'getSystemPrompt',
      'getDataStore', 'executeTool', 'getAuthz',
    ]);
  });

  it('accepts a fully-formed plugin', () => {
    expect(validatePlugin('x', goodPlugin)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a plugin missing a method', () => {
    const bad = { ...goodPlugin };
    delete bad.executeTool;
    const res = validatePlugin('x', bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/executeTool/);
  });

  it('rejects a heuristic action not present in getTools', () => {
    const bad = { ...goodPlugin, getHeuristics: () => [{ re: /foo/, action: 'not_a_tool' }] };
    const res = validatePlugin('x', bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/not_a_tool/);
  });
});

const path = require('path');
const fs = require('fs');
const os = require('os');
const { createPlugins } = require('../../services/verticalManifest/plugins');

describe('createPlugins discovery', () => {
  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'verticals-'));
    const wp = path.join(root, 'withplugin');
    fs.mkdirSync(wp, { recursive: true });
    fs.writeFileSync(path.join(wp, 'index.js'), `
      module.exports = {
        getManifest: () => ({ id: 'withplugin' }),
        getTools: () => [{ name: 'do_it', description: 'd', inputSchema: { type: 'object' }, scopes: ['read'], authz: {} }],
        getHeuristics: () => [{ re: /do it/, action: 'do_it' }],
        getSystemPrompt: () => 'wp prompt',
        getDataStore: () => ({}),
        executeTool: async () => ({ result: { ok: true }, render: null }),
        getAuthz: () => ({ do_it: {} }),
      };
    `);
    fs.mkdirSync(path.join(root, 'noplugin'), { recursive: true });
  });

  it('returns a validated plugin for a vertical that has index.js', () => {
    const plugins = createPlugins(root);
    const p = plugins.get('withplugin');
    expect(p).not.toBeNull();
    expect(p.getSystemPrompt()).toBe('wp prompt');
  });

  it('returns null for a vertical with no index.js', () => {
    const plugins = createPlugins(root);
    expect(plugins.get('noplugin')).toBeNull();
  });

  it('has(id) reflects plugin presence', () => {
    const plugins = createPlugins(root);
    expect(plugins.has('withplugin')).toBe(true);
    expect(plugins.has('noplugin')).toBe(false);
  });

  it('throws a descriptive error when an index.js violates the contract', () => {
    const bad = path.join(root, 'badplugin');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'index.js'), `module.exports = { getManifest: () => ({}) };`);
    const plugins = createPlugins(root);
    expect(() => plugins.get('badplugin')).toThrow(/badplugin.*missing required method/);
  });
});

describe('contract: getSystemPrompt must return a non-empty string', () => {
  const good = {
    getManifest: () => ({}), getTools: () => [{ name: 't' }], getHeuristics: () => [{ re: /t/, action: 't' }],
    getSystemPrompt: () => 'a prompt', getDataStore: () => ({}), executeTool: async () => ({}), getAuthz: () => ({}),
  };
  it('rejects an empty system prompt', () => {
    const bad = { ...good, getSystemPrompt: () => '' };
    const res = validatePlugin('x', bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/getSystemPrompt/);
  });
  it('accepts a non-empty system prompt', () => {
    expect(validatePlugin('x', good).ok).toBe(true);
  });
});
