'use strict';
/**
 * Brave's news envelope, rendered for the transcript.
 *
 * What shipped first put the raw Brave API JSON on the demo screen — every
 * field, including base64 thumbnails and meta_url internals. These tests pin
 * the two properties that matter: it reads as prose, and an UNRECOGNISED shape
 * falls back to the raw string instead of inventing an empty result (a search
 * that found nothing and a payload we failed to parse must not look alike).
 */
const { __test } = require('../services/demoAgentLangGraphService');

const format = __test.formatBraveResults;

const ENVELOPE = {
  type: 'news',
  query: { original: 'PingOne DaVinci' },
  results: [
    {
      type: 'news_result',
      title: 'Ping Identity launches <strong>PingOne</strong> DaVinci',
      url: 'https://www.darkreading.com/endpoint-security/ping-identity-launches-pingone-davinci',
      description: 'No-code identity <strong>orchestration</strong> service.',
      age: 'May 14, 2026',
      meta_url: { hostname: 'darkreading.com' },
      thumbnail: { src: 'data:image/jpeg;base64,AAAAAAAAAAAAAAAAAAAA' },
    },
  ],
};

describe('formatBraveResults', () => {
  test('renders a readable entry, not the raw envelope', () => {
    const out = format(JSON.stringify(ENVELOPE));
    expect(out).toContain('News results for “PingOne DaVinci”');
    expect(out).toContain('Ping Identity launches PingOne DaVinci');
    expect(out).toContain('darkreading.com · May 14, 2026');
    expect(out).toContain('(https://www.darkreading.com/endpoint-security/ping-identity-launches-pingone-davinci)');
  });

  test('strips Brave\'s <strong> match markup rather than showing tags', () => {
    const out = format(JSON.stringify(ENVELOPE));
    expect(out).not.toMatch(/<strong>|<\/strong>/);
  });

  test('never leaks the base64 thumbnail into the transcript', () => {
    // This is most of the byte weight of the wall of JSON that shipped first.
    const out = format(JSON.stringify(ENVELOPE));
    expect(out).not.toContain('base64');
  });

  test('an empty result set says so instead of rendering nothing', () => {
    const out = format(JSON.stringify({ query: { original: 'zzzz' }, results: [] }));
    expect(out).toContain('No results came back');
  });

  test('caps the list and says how many were held back', () => {
    const many = {
      query: { original: 'ping' },
      results: Array.from({ length: 11 }, (_, i) => ({
        title: `Result ${i}`,
        url: `https://example.com/${i}`,
        description: 'x',
      })),
    };
    const out = format(JSON.stringify(many));
    expect(out).toContain('Result 7');
    expect(out).not.toContain('Result 8');
    expect(out).toContain('3 more result(s) not shown');
  });

  test.each([
    ['not json at all', 'unparseable'],
    [JSON.stringify({ error: 'nope' }), 'no results array'],
    [JSON.stringify([1, 2, 3]), 'wrong top-level shape'],
  ])('returns null for %s so the caller keeps the raw string (%s)', (raw) => {
    expect(format(raw)).toBeNull();
  });
});
