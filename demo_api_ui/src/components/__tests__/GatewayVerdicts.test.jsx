import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GatewayVerdicts, { normalizeVerdict, pickSearchTool, extractSearchHits, frameworkLabel, authGate } from '../GatewayVerdicts';

// The shape opensearch-mcp-server actually returns from SearchIndexTool: the
// _search response as a text block inside MCP tool content, prefixed with a
// human sentence. Measured live 2026-09-11.
function contentTextInvoke(hits) {
  const osResponse = { took: 2, timed_out: false, hits: { total: { value: hits.length }, hits } };
  return { result: { content: [{ type: 'text', text: `Search results from gateway-events (JSON format):\n${JSON.stringify(osResponse)}` }] } };
}

const AIGUARD_DOC = {
  _source: {
    msg: 'AIGuard',
    Category: 'pii',
    Direction: 'response',
    Event: 'llm_response_sanitized',
    time: '2026-09-08T10:18:37Z',
    // A live credential. It must never reach component state.
    VirtualKeyID: 'sk-orion-SHOULD-NEVER-RENDER',
    ComplianceMappings: [
      { Framework: 'mitre_atlas', Identifier: 'AML.T0057', Source: 'pii-email', MappingType: 'finding' },
      { Framework: 'nist_ai_rmf', Identifier: 'MEASURE-2.5', Source: 'pii-email', MappingType: 'finding' },
      { Framework: 'owasp_llm', Identifier: 'LLM02', Source: 'pii-email', MappingType: 'finding' },
    ],
  },
};

function mockFetch({ toolsStatus = 200, tools = [{ name: 'search_index' }], hits = [AIGUARD_DOC], invokeStatus = 200, toolsBody = null } = {}) {
  return vi.fn((url, opts) => {
    if (String(url).includes('/tools')) {
      return Promise.resolve({
        ok: toolsStatus === 200,
        status: toolsStatus,
        json: async () => (toolsBody || { tools }),
      });
    }
    return Promise.resolve({
      ok: invokeStatus === 200,
      status: invokeStatus,
      json: async () => ({ result: { hits: { hits } } }),
      _body: opts && opts.body,
    });
  });
}

describe('normalizeVerdict', () => {
  // VirtualKeyID is an sk-orion- credential. Dropping it at normalisation
  // rather than at render means it cannot reach state at all.
  it('never carries the virtual key through', () => {
    const v = normalizeVerdict(AIGUARD_DOC);
    expect(JSON.stringify(v)).not.toContain('sk-orion');
    expect(v).not.toHaveProperty('VirtualKeyID');
  });

  it('keeps the compliance identifiers, which are the point of the panel', () => {
    const v = normalizeVerdict(AIGUARD_DOC);
    expect(v.mappings.map((m) => m.identifier)).toEqual(['AML.T0057', 'MEASURE-2.5', 'LLM02']);
    expect(v.mappings.map((m) => m.label)).toEqual(['MITRE ATLAS', 'NIST AI RMF', 'OWASP LLM']);
  });

  it('survives a document with no mappings', () => {
    const v = normalizeVerdict({ _source: { Category: 'jailbreak' } });
    expect(v.mappings).toEqual([]);
    expect(v.category).toBe('jailbreak');
  });
});

describe('frameworkLabel', () => {
  it('falls back to the raw name for an unknown framework', () => {
    expect(frameworkLabel('some_new_framework')).toBe('some_new_framework');
  });
});

describe('pickSearchTool', () => {
  it('finds a search tool without a hardcoded name', () => {
    expect(pickSearchTool([{ name: 'ListIndices' }, { name: 'SearchIndexTool' }])).toBe('SearchIndexTool');
  });

  it('falls back to a query tool', () => {
    expect(pickSearchTool([{ name: 'run_query' }])).toBe('run_query');
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(pickSearchTool([{ name: 'ListIndices' }])).toBeNull();
  });

  // Once every tool is granted the door exposes several /search/ tools with
  // different args; only SearchIndexTool takes query_dsl and returns hits.
  it('prefers SearchIndexTool over other /search/ tools regardless of order', () => {
    expect(pickSearchTool([
      { name: 'MsearchTool' }, { name: 'GenericOpenSearchApiTool' }, { name: 'SearchIndexTool' },
    ])).toBe('SearchIndexTool');
  });
});

describe('extractSearchHits', () => {
  it('parses the MCP content-text shape opensearch-mcp-server actually returns', () => {
    const hits = extractSearchHits(contentTextInvoke([AIGUARD_DOC]));
    expect(hits).toHaveLength(1);
    expect(hits[0]._source.Category).toBe('pii');
  });

  it('still reads the structured shape if a server returns one', () => {
    expect(extractSearchHits({ result: { hits: { hits: [AIGUARD_DOC] } } })).toHaveLength(1);
  });

  it('returns [] for content with no JSON body', () => {
    expect(extractSearchHits({ result: { content: [{ type: 'text', text: 'no results' }] } })).toEqual([]);
  });
});

describe('authGate', () => {
  it('detects the 200 + privilege_login_required shape the inspector really sends', () => {
    expect(authGate({ status: 200 }, { privilege_login_required: true, loginUrl: '/x' }))
      .toEqual({ loginUrl: '/x' });
  });

  it('detects the pingone admin variant too', () => {
    expect(authGate({ status: 200 }, { pingone_admin_login_required: true })).toEqual({ loginUrl: null });
  });

  it('still catches a plain 401', () => {
    expect(authGate({ status: 401 }, {})).toEqual({ loginUrl: null });
  });

  it('does not gate a healthy tool list', () => {
    expect(authGate({ status: 200 }, { tools: [{ name: 'search' }] })).toBeNull();
  });
});

describe('GatewayVerdicts', () => {
  it('renders the compliance identifiers after loading', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch()} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-list')).toBeInTheDocument());
    expect(screen.getByText('AML.T0057')).toBeInTheDocument();
    expect(screen.getByText('MEASURE-2.5')).toBeInTheDocument();
    expect(screen.getByText('LLM02')).toBeInTheDocument();
  });

  it('never renders the virtual key', async () => {
    const { container } = render(<GatewayVerdicts fetchImpl={mockFetch()} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-list')).toBeInTheDocument());
    expect(container.innerHTML).not.toContain('sk-orion');
  });

  // MEASURED 2026-09-08 against built-in-privilege-opensearch: an unconnected
  // door answers HTTP 200 with tools: [] and privilege_login_required — NOT a
  // 401. A status-only check rendered "no search tool" for a door that was
  // merely not signed in. This is the shape the live system actually returns.
  it('treats the real unconnected-door shape (200 + flag) as needing sign-in', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch({
      toolsBody: {
        tools: [],
        privilege_login_required: true,
        loginUrl: '/api/mcp/inspector/privilege/login?profile=built-in-privilege-opensearch',
      },
    })} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-needs-auth')).toBeInTheDocument());
    expect(screen.queryByTestId('gwv-error')).not.toBeInTheDocument();
    // And it offers the door's own login, not prose directions.
    expect(screen.getByTestId('gwv-login-link').getAttribute('href'))
      .toContain('/api/mcp/inspector/privilege/login');
  });

  it('still treats a 401 as needing sign-in, for transports that use one', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch({ toolsStatus: 401 })} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-needs-auth')).toBeInTheDocument());
  });

  it('surfaces a genuine door error with its reason', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch({
      toolsBody: { tools: [], error: true, reason: 'upstream refused' },
    })} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-error')).toBeInTheDocument());
    expect(screen.getByTestId('gwv-error').textContent).toMatch(/upstream refused/);
  });

  it('reports plainly when a CONNECTED door exposes no search tool', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch({ tools: [{ name: 'ListIndices' }] })} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-error')).toBeInTheDocument());
    expect(screen.getByTestId('gwv-error').textContent).toMatch(/no search tool/i);
  });

  it('says so when there are no findings yet, rather than rendering nothing', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch({ hits: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-empty')).toBeInTheDocument());
  });

  // The two live bugs: the invoke must send `query_dsl` (not `query`), and the
  // result arrives as MCP content text (not result.hits). Both fixed together.
  it('sends query_dsl and renders findings from the content-text response', async () => {
    let invokeBodyStr = null;
    const fetchImpl = vi.fn((url, opts) => {
      if (String(url).includes('/tools')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ tools: [{ name: 'SearchIndexTool' }] }) });
      }
      invokeBodyStr = opts && opts.body;
      return Promise.resolve({ ok: true, status: 200, json: async () => contentTextInvoke([AIGUARD_DOC]) });
    });
    render(<GatewayVerdicts fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-list')).toBeInTheDocument());
    expect(screen.getByText('AML.T0057')).toBeInTheDocument();
    const sent = JSON.parse(invokeBodyStr);
    expect(sent.tool).toBe('SearchIndexTool');
    expect(sent.params).toHaveProperty('query_dsl');
    expect(sent.params).not.toHaveProperty('query');
    expect(sent.params.query_dsl.query).toEqual({ match: { msg: 'AIGuard' } });
  });
});
