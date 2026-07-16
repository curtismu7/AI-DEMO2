/**
 * OKF MCP Tool — Unit Tests
 *
 * Run: npx jest server/services/__tests__/okfMcpTool.test.js
 */

const path = require('path');
const okfLoader = require('../../services/okfLoaderService');
const { toolDefinition, handler } = require('../../services/okfMcpTool');

// ---------------------------------------------------------------------------
// Setup: initialize loader with the real bundles
// ---------------------------------------------------------------------------

const BUNDLE_DIR = path.resolve(__dirname, '../../../graphify-out');

beforeAll(() => {
  okfLoader.initialize(BUNDLE_DIR);
});

afterAll(() => {
  okfLoader.reset();
});

// ===========================================================================
// toolDefinition
// ===========================================================================

describe('toolDefinition', () => {
  test('has required MCP tool fields', () => {
    expect(toolDefinition.name).toBe('get_okf_assertions');
    expect(toolDefinition.description).toBeTruthy();
    expect(toolDefinition.inputSchema).toBeDefined();
    expect(toolDefinition.inputSchema.type).toBe('object');
    expect(toolDefinition.inputSchema.required).toContain('domain');
  });

  test('declares all expected input parameters', () => {
    const props = toolDefinition.inputSchema.properties;
    expect(props.domain).toBeDefined();
    expect(props.tags).toBeDefined();
    expect(props.id).toBeDefined();
    expect(props.format).toBeDefined();
    expect(props.format.enum).toEqual(['structured', 'prompt', 'summary']);
  });
});

// ===========================================================================
// handler — domain: "list"
// ===========================================================================

describe('handler — list domains', () => {
  test('returns all available domains', async () => {
    const result = await handler({ domain: 'list' });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);

    const data = JSON.parse(result.content[0].text);
    expect(data.availableDomains).toBeDefined();
    expect(data.availableDomains.length).toBeGreaterThanOrEqual(2);

    const slugs = data.availableDomains.map(d => d.domain);
    expect(slugs).toContain('banking-domain');
    expect(slugs).toContain('repo-topology');
  });

  test('includes metadata for each domain', async () => {
    const result = await handler({ domain: 'list' });
    const data = JSON.parse(result.content[0].text);

    const repoTopo = data.availableDomains.find(d => d.domain === 'repo-topology');
    expect(repoTopo.title).toBeTruthy();
    expect(repoTopo.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(repoTopo.assertionCount).toBeGreaterThanOrEqual(15);
  });

  test('includes tag examples', async () => {
    const result = await handler({ domain: 'list' });
    const data = JSON.parse(result.content[0].text);

    expect(data.tagExamples).toBeDefined();
    expect(data.tagExamples['repo-topology']).toContain('feature-flags');
    expect(data.tagExamples['banking-domain']).toContain('fraud');
  });
});

// ===========================================================================
// handler — structured format (default)
// ===========================================================================

describe('handler — structured format', () => {
  test('returns all assertions for a valid domain', async () => {
    const result = await handler({ domain: 'repo-topology' });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);

    expect(data.domain).toBe('repo-topology');
    expect(data.version).toBe('0.1.0');
    expect(data.assertions.length).toBeGreaterThanOrEqual(15);
    expect(data.filtered).toBe(false);
  });

  test('filters by tags', async () => {
    const result = await handler({
      domain: 'repo-topology',
      tags: ['feature-flags'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.filtered).toBe(true);
    expect(data.filterTags).toEqual(['feature-flags']);
    expect(data.returnedAssertions).toBeLessThan(data.totalAssertions);

    // All returned assertions should have the feature-flags tag
    data.assertions.forEach(a => {
      expect(a.tags).toContain('feature-flags');
    });
  });

  test('returns error for unknown domain', async () => {
    const result = await handler({ domain: 'nonexistent' });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toMatch(/not found/);
    expect(data.error).toContain('repo-topology');
  });

  test('includes usage instructions', async () => {
    const result = await handler({ domain: 'banking-domain' });
    const data = JSON.parse(result.content[0].text);

    expect(data.usage).toContain('ground truth');
    expect(data.usage).toContain('[K1]');
  });
});

// ===========================================================================
// handler — single assertion by ID
// ===========================================================================

describe('handler — single assertion', () => {
  test('returns specific assertion by ID', async () => {
    const result = await handler({ domain: 'repo-topology', id: 'K2' });

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);

    expect(data.domain).toBe('repo-topology');
    expect(data.assertion).toBeDefined();
    expect(data.assertion.id).toBe('K2');
    expect(data.assertion.claim).toContain('FLAG_REGISTRY');
    expect(data.citationFormat).toContain('[K2]');
  });

  test('returns error for nonexistent ID', async () => {
    const result = await handler({ domain: 'repo-topology', id: 'K99' });

    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('K99');
    expect(data.error).toContain('not found');
  });

  test('returns first assertion K1', async () => {
    const result = await handler({ domain: 'banking-domain', id: 'K1' });

    const data = JSON.parse(result.content[0].text);
    expect(data.assertion.id).toBe('K1');
    expect(data.assertion.claim).toMatch(/available balance/i);
  });
});

// ===========================================================================
// handler — prompt format
// ===========================================================================

describe('handler — prompt format', () => {
  test('returns formatted knowledge block', async () => {
    const result = await handler({
      domain: 'banking-domain',
      format: 'prompt',
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    expect(text).toContain('<knowledge domain="banking-domain"');
    expect(text).toContain('</knowledge>');
    expect(text).toContain('[K1]');
    expect(text).toContain('INSTRUCTIONS:');
  });

  test('respects tag filter in prompt format', async () => {
    const result = await handler({
      domain: 'banking-domain',
      tags: ['fraud'],
      format: 'prompt',
    });

    const text = result.content[0].text;
    expect(text).toContain('[K4]');
    expect(text).toContain('[K5]');
    // K1 (balance) should NOT be present
    expect(text).not.toContain('[K1]');
  });
});

// ===========================================================================
// handler — summary format
// ===========================================================================

describe('handler — summary format', () => {
  test('returns one-line-per-assertion summary', async () => {
    const result = await handler({
      domain: 'repo-topology',
      format: 'summary',
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;

    expect(text).toContain('# Repository Topology');
    expect(text).toContain('[K1]');
    expect(text).toContain('[K15]');
    expect(text).toContain('Use format:"structured"');
  });

  test('truncates long claims in summary', async () => {
    const result = await handler({
      domain: 'repo-topology',
      format: 'summary',
    });

    const text = result.content[0].text;
    const lines = text.split('\n').filter(l => l.startsWith('[K'));

    // Some lines should be truncated (claims > 120 chars)
    const hasTruncated = lines.some(l => l.endsWith('...'));
    expect(hasTruncated).toBe(true);
  });
});

// ===========================================================================
// handler — edge cases
// ===========================================================================

describe('handler — edge cases', () => {
  test('handles empty tags array gracefully', async () => {
    const result = await handler({
      domain: 'banking-domain',
      tags: [],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.assertions.length).toBe(12); // All assertions returned
  });

  test('handles tags that match nothing', async () => {
    const result = await handler({
      domain: 'banking-domain',
      tags: ['nonexistent-tag'],
    });

    const data = JSON.parse(result.content[0].text);
    expect(data.returnedAssertions).toBe(0);
    expect(data.assertions).toEqual([]);
  });

  test('format parameter defaults to structured', async () => {
    const result = await handler({ domain: 'banking-domain' });
    const data = JSON.parse(result.content[0].text);

    // Structured format has these fields
    expect(data.domain).toBeDefined();
    expect(data.assertions).toBeDefined();
    expect(data.version).toBeDefined();
  });
});
