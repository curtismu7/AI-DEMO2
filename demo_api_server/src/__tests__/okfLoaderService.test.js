/**
 * OKF Loader Service — Unit Tests
 *
 * Run: npx jest server/services/__tests__/okfLoaderService.test.js
 * Or:  node --test server/services/__tests__/okfLoaderService.test.js (Node 18+)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const okfLoader = require('../../services/okfLoaderService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'okf-test-'));
}

function writeBundle(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(content, null, 2));
}

function validBundle(overrides = {}) {
  return {
    '@context': 'https://okf.ping.dev/v0.1',
    id: 'urn:okf:test:test-domain:a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    version: '1.0.0',
    domain: 'test-domain',
    title: 'Test Bundle',
    assertions: [
      {
        id: 'K1',
        claim: 'This is a test assertion with sufficient length.',
        source: 'Test Source §1.1',
        confidence: 1.0,
        citations: [{ ref: 'test-doc §1.1' }],
        tags: ['test', 'alpha'],
      },
      {
        id: 'K2',
        claim: 'Second assertion covering a different topic entirely.',
        source: 'Test Source §2.1',
        confidence: 0.9,
        citations: [{ ref: 'test-doc §2.1' }],
        tags: ['test', 'beta'],
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('okfLoaderService', () => {
  afterEach(() => {
    okfLoader.reset();
  });

  // =========================================================================
  // initialize()
  // =========================================================================

  describe('initialize()', () => {
    test('loads valid bundle from directory', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test-domain.okf.json', validBundle());

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(okfLoader.isInitialized()).toBe(true);
    });

    test('handles non-existent directory gracefully', () => {
      const result = okfLoader.initialize('/does/not/exist');

      expect(result.loaded).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/not found/);
      expect(okfLoader.isInitialized()).toBe(true); // Still marks as initialized
    });

    test('handles empty directory gracefully', () => {
      const dir = createTmpDir();

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/No .okf.json files/);
    });

    test('skips non-.okf.json files', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test-domain.okf.json', validBundle());
      fs.writeFileSync(path.join(dir, 'readme.md'), '# Not a bundle');
      fs.writeFileSync(path.join(dir, 'data.json'), '{}');

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(1);
    });

    test('loads multiple bundles indexed by domain', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'alpha.okf.json', validBundle({ domain: 'alpha' }));
      writeBundle(dir, 'beta.okf.json', validBundle({
        domain: 'beta',
        id: 'urn:okf:test:beta:b1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }));

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(2);
      expect(okfLoader.listDomains().sort()).toEqual(['alpha', 'beta']);
    });

    test('rejects duplicate domains', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'first.okf.json', validBundle({ domain: 'same' }));
      writeBundle(dir, 'second.okf.json', validBundle({ domain: 'same' }));

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(1);
      expect(result.errors.some(e => e.includes('duplicate domain'))).toBe(true);
    });

    test('re-initialize clears previous state', () => {
      const dir1 = createTmpDir();
      writeBundle(dir1, 'a.okf.json', validBundle({ domain: 'domain-a' }));
      okfLoader.initialize(dir1);
      expect(okfLoader.listDomains()).toEqual(['domain-a']);

      const dir2 = createTmpDir();
      writeBundle(dir2, 'b.okf.json', validBundle({ domain: 'domain-b' }));
      okfLoader.initialize(dir2);
      expect(okfLoader.listDomains()).toEqual(['domain-b']);
    });
  });

  // =========================================================================
  // Validation
  // =========================================================================

  describe('validation', () => {
    test('rejects bundle with wrong @context', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'bad.okf.json', validBundle({ '@context': 'https://wrong.dev/v9' }));

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('@context'))).toBe(true);
    });

    test('rejects bundle with invalid id format', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'bad.okf.json', validBundle({ id: 'not-a-urn' }));

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('id must match'))).toBe(true);
    });

    test('rejects bundle with non-semver version', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'bad.okf.json', validBundle({ version: 'latest' }));

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('version must be semver'))).toBe(true);
    });

    test('rejects bundle with empty assertions array', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'bad.okf.json', validBundle({ assertions: [] }));

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('non-empty array'))).toBe(true);
    });

    test('rejects assertion with bad id pattern', () => {
      const dir = createTmpDir();
      const bundle = validBundle();
      bundle.assertions[0].id = 'BAD';

      writeBundle(dir, 'bad.okf.json', bundle);
      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('K1–K50') || e.includes('K<number>'))).toBe(true);
    });

    test('rejects assertion with confidence > 1', () => {
      const dir = createTmpDir();
      const bundle = validBundle();
      bundle.assertions[0].confidence = 1.5;

      writeBundle(dir, 'bad.okf.json', bundle);
      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('between 0 and 1'))).toBe(true);
    });

    test('rejects assertion with too-short claim', () => {
      const dir = createTmpDir();
      const bundle = validBundle();
      bundle.assertions[0].claim = 'Short';

      writeBundle(dir, 'bad.okf.json', bundle);
      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.some(e => e.includes('at least 10 chars'))).toBe(true);
    });

    test('handles malformed JSON gracefully', () => {
      const dir = createTmpDir();
      fs.writeFileSync(path.join(dir, 'corrupt.okf.json'), '{not json at all');

      const result = okfLoader.initialize(dir);

      expect(result.loaded).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // getAssertions()
  // =========================================================================

  describe('getAssertions()', () => {
    test('returns assertions for a loaded domain', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const assertions = okfLoader.getAssertions('test-domain');

      expect(assertions).toHaveLength(2);
      expect(assertions[0].id).toBe('K1');
      expect(assertions[1].id).toBe('K2');
    });

    test('returns empty array for unknown domain', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const assertions = okfLoader.getAssertions('nonexistent');

      expect(assertions).toEqual([]);
    });

    test('filters by tags', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const alphaOnly = okfLoader.getAssertions('test-domain', { tags: ['alpha'] });
      expect(alphaOnly).toHaveLength(1);
      expect(alphaOnly[0].id).toBe('K1');

      const betaOnly = okfLoader.getAssertions('test-domain', { tags: ['beta'] });
      expect(betaOnly).toHaveLength(1);
      expect(betaOnly[0].id).toBe('K2');

      const both = okfLoader.getAssertions('test-domain', { tags: ['alpha', 'beta'] });
      expect(both).toHaveLength(2);
    });

    test('auto-initializes with default dir if not yet initialized', () => {
      // Won't find anything in default dir (graphify-out/) during test,
      // but should not throw
      const assertions = okfLoader.getAssertions('banking-domain');
      expect(Array.isArray(assertions)).toBe(true);
      expect(okfLoader.isInitialized()).toBe(true);
    });
  });

  // =========================================================================
  // formatForPrompt()
  // =========================================================================

  describe('formatForPrompt()', () => {
    test('returns formatted knowledge block', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const prompt = okfLoader.formatForPrompt('test-domain');

      expect(prompt).toContain('<knowledge domain="test-domain" version="1.0.0">');
      expect(prompt).toContain('</knowledge>');
      expect(prompt).toContain('[K1]');
      expect(prompt).toContain('[K2]');
      expect(prompt).toContain('Source: Test Source §1.1');
      expect(prompt).toContain('INSTRUCTIONS:');
      expect(prompt).toContain('ground truth');
    });

    test('returns empty string for unknown domain', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const prompt = okfLoader.formatForPrompt('nonexistent');

      expect(prompt).toBe('');
    });

    test('respects tag filtering', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const prompt = okfLoader.formatForPrompt('test-domain', { tags: ['alpha'] });

      expect(prompt).toContain('[K1]');
      expect(prompt).not.toContain('[K2]');
    });
  });

  // =========================================================================
  // getBundleMeta()
  // =========================================================================

  describe('getBundleMeta()', () => {
    test('returns metadata without assertions', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      const meta = okfLoader.getBundleMeta('test-domain');

      expect(meta).toEqual({
        id: 'urn:okf:test:test-domain:a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        domain: 'test-domain',
        version: '1.0.0',
        title: 'Test Bundle',
        description: null,
        assertionCount: 2,
        created: null,
        updated: null,
        authors: [],
      });
    });

    test('returns null for unknown domain', () => {
      const dir = createTmpDir();
      okfLoader.initialize(dir);

      expect(okfLoader.getBundleMeta('nope')).toBeNull();
    });
  });

  // =========================================================================
  // listDomains()
  // =========================================================================

  describe('listDomains()', () => {
    test('returns all loaded domain slugs', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'a.okf.json', validBundle({ domain: 'alpha' }));
      writeBundle(dir, 'b.okf.json', validBundle({
        domain: 'beta',
        id: 'urn:okf:test:beta:b1b2c3d4-e5f6-7890-abcd-ef1234567890',
      }));
      okfLoader.initialize(dir);

      expect(okfLoader.listDomains().sort()).toEqual(['alpha', 'beta']);
    });
  });

  // =========================================================================
  // reset()
  // =========================================================================

  describe('reset()', () => {
    test('clears all state', () => {
      const dir = createTmpDir();
      writeBundle(dir, 'test.okf.json', validBundle());
      okfLoader.initialize(dir);

      expect(okfLoader.isInitialized()).toBe(true);
      expect(okfLoader.listDomains()).toHaveLength(1);

      okfLoader.reset();

      expect(okfLoader.isInitialized()).toBe(false);
      expect(okfLoader._bundleIndex.size).toBe(0);
    });
  });

  // =========================================================================
  // Integration: loads the real banking-domain bundle
  // =========================================================================

  describe('integration: banking-domain bundle', () => {
    const bundleDir = path.resolve(__dirname, '../../../graphify-out');

    beforeEach(() => {
      okfLoader.reset();
    });

    test('loads banking-domain.okf.json if present', () => {
      if (!fs.existsSync(path.join(bundleDir, 'banking-domain.okf.json'))) {
        return; // Skip if bundle not present (CI without graphify-out)
      }

      const result = okfLoader.initialize(bundleDir);

      expect(result.loaded).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
      expect(okfLoader.listDomains()).toContain('banking-domain');

      const assertions = okfLoader.getAssertions('banking-domain');
      expect(assertions.length).toBeGreaterThanOrEqual(8);

      // Spot-check K1 exists
      const k1 = assertions.find(a => a.id === 'K1');
      expect(k1).toBeDefined();
      expect(k1.claim).toMatch(/available balance/i);

      // Check prompt formatting
      const prompt = okfLoader.formatForPrompt('banking-domain');
      expect(prompt).toContain('<knowledge domain="banking-domain"');
      expect(prompt).toContain('[K1]');
    });
  });
});
