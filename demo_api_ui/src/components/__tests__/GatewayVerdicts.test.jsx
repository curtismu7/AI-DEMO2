import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GatewayVerdicts, { normalizeVerdict, pickSearchTool, frameworkLabel } from '../GatewayVerdicts';

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

function mockFetch({ toolsStatus = 200, tools = [{ name: 'search_index' }], hits = [AIGUARD_DOC], invokeStatus = 200 } = {}) {
  return vi.fn((url, opts) => {
    if (String(url).includes('/tools')) {
      return Promise.resolve({
        ok: toolsStatus === 200,
        status: toolsStatus,
        json: async () => ({ tools }),
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

  // The door has no client_credentials grant, so the panel cannot populate
  // itself. Saying so is the difference between "sign in" and "looks broken".
  it('explains the sign-in requirement on 401 instead of showing an error', async () => {
    render(<GatewayVerdicts fetchImpl={mockFetch({ toolsStatus: 401 })} />);
    fireEvent.click(screen.getByRole('button', { name: /load findings/i }));

    await waitFor(() => expect(screen.getByTestId('gwv-needs-auth')).toBeInTheDocument());
    expect(screen.getByTestId('gwv-needs-auth').textContent).toMatch(/sign-in/i);
    expect(screen.queryByTestId('gwv-error')).not.toBeInTheDocument();
  });

  it('reports plainly when the door exposes no search tool', async () => {
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
});
