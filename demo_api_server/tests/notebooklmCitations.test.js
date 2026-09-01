'use strict';

/**
 * Citations from NotebookLM carry no page URL — only `cited_text` and a
 * source_id that is the whole uploaded bundle. The bundle written by
 * ping-docs-notebook.sh carries a `# source: <url>` header above every page,
 * so the URL is recovered by locating the excerpt and walking back.
 *
 * NotebookLM collapses whitespace in cited_text, so exact matching finds
 * nothing; normalisation to lowercase alphanumerics is what makes it work.
 */

const {
  buildIndex,
  resolveCitation,
  resolveAgainst,
} = require('../services/notebooklmCitations');

const BUNDLE = [
  '',
  '---',
  '# source: https://docs.pingidentity.com/privilege/getting-started/key-concepts.md',
  '',
  'The agentless model is ideal for organizations seeking a fast rollout.',
  'Users access resources using the PingOne Privilege CLI (PCLI) shell utility.',
  '',
  '---',
  '# source: https://docs.pingidentity.com/privilege/agent-privilege/mcp-gateway.md',
  '',
  'The MCP gateway brokers tool calls and enforces policy on every request.',
  '',
].join('\n');

describe('notebooklmCitations', () => {
  const index = buildIndex(BUNDLE);

  it('resolves an excerpt whose whitespace NotebookLM collapsed', () => {
    const cited = 'Usersaccess resources using thePingOne Privilege CLI(PCLI)shell utility.';
    expect(resolveCitation(cited, index)).toBe(
      'https://docs.pingidentity.com/privilege/getting-started/key-concepts.md',
    );
  });

  it('attributes the excerpt to the page it starts in', () => {
    const cited = 'The MCP gateway brokers tool calls and enforces policy on every request.';
    expect(resolveCitation(cited, index)).toBe(
      'https://docs.pingidentity.com/privilege/agent-privilege/mcp-gateway.md',
    );
  });

  it('returns null when the excerpt is not in the bundle', () => {
    expect(resolveCitation('nothing like this appears anywhere in the bundle at all', index)).toBeNull();
  });

  it('returns null rather than guessing when the excerpt is too short to be unique', () => {
    expect(resolveCitation('the', index)).toBeNull();
  });

  it('returns null when the probe matches more than one place', () => {
    const dupe = buildIndex(
      [
        '# source: https://docs.pingidentity.com/a.md',
        'Repeated boilerplate sentence that appears verbatim in two different pages here.',
        '# source: https://docs.pingidentity.com/b.md',
        'Repeated boilerplate sentence that appears verbatim in two different pages here.',
      ].join('\n'),
    );
    const cited = 'Repeated boilerplate sentence that appears verbatim in two different pages here.';
    expect(resolveCitation(cited, dupe)).toBeNull();
  });

  it('searches across multiple bundle indexes', () => {
    const other = buildIndex(
      ['# source: https://docs.pingidentity.com/other.md', 'Completely different content lives in this second bundle file.'].join('\n'),
    );
    const cited = 'Completely different content lives in this second bundle file.';
    expect(resolveAgainst(cited, [index, other])).toBe('https://docs.pingidentity.com/other.md');
  });

  it('returns null when two different bundles both match the excerpt', () => {
    const shared = 'Identical boilerplate paragraph that was copied into two separate bundle files verbatim.';
    const one = buildIndex(['# source: https://docs.pingidentity.com/one.md', shared].join('\n'));
    const two = buildIndex(['# source: https://docs.pingidentity.com/two.md', shared].join('\n'));
    expect(resolveAgainst(shared, [one, two])).toBeNull();
  });
});
