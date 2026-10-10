import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_KINDS, HOSTILE_MCP_CATALOG } from './hostileMcpCatalog';

const here = dirname(fileURLToPath(import.meta.url));
// src/config → ../../.. = repo root (demo_api_ui → AI-DEMO2)
const repoRoot = resolve(here, '../../..');

// The names standalone/hostile-mcp-server actually serves, extracted from
// poisons.mjs (metadata poisons) and index.mjs (dynamic + action tools).
// Deliberately text-parsed rather than imported: the standalone package has
// its own node_modules and module graph, and the UI bundle must not reach
// into it.
function namesFromPoisons() {
  const src = readFileSync(
    resolve(repoRoot, 'standalone/hostile-mcp-server/poisons.mjs'),
    'utf8',
  );
  const meta = [...src.matchAll(/id: '([a-z_]+)',[\s\S]*?tool: \{\s*name: '([a-z_]+)'/g)].map(
    (m) => m[2],
  );
  const resources = [...src.matchAll(/uri: '(mcp:\/\/[^']+)'/g)].map((m) => m[1]);
  const prompts = [...src.matchAll(/prompt: \{\s*name: '([a-z_]+)'/g)].map((m) => m[1]);
  return { meta, resources, prompts };
}

function namesFromIndex() {
  const src = readFileSync(
    resolve(repoRoot, 'standalone/hostile-mcp-server/index.mjs'),
    'utf8',
  );
  const action = [...src.matchAll(/name: '(create_transfer|delete_all_records|grant_admin)'/g)].map(
    (m) => m[1],
  );
  const dynamic = [...src.matchAll(/name: '(get_stock_price|read_ticket)'/g)].map((m) => m[1]);
  return { action: [...new Set(action)], dynamic: [...new Set(dynamic)] };
}

describe('hostileMcpCatalog parity with standalone/hostile-mcp-server', () => {
  it('covers every poisoned metadata tool in poisons.mjs', () => {
    const { meta } = namesFromPoisons();
    expect(meta.length).toBeGreaterThanOrEqual(6);
    for (const name of meta) {
      expect(
        HOSTILE_MCP_CATALOG.find((c) => c.tool === name && c.kind === 'metadata'),
        `metadata poison ${name} missing from the catalog`,
      ).toBeTruthy();
    }
  });

  it('covers the poisoned resource and prompt in poisons.mjs', () => {
    const { resources, prompts } = namesFromPoisons();
    for (const uri of resources) {
      expect(HOSTILE_MCP_CATALOG.find((c) => c.tool === uri)).toBeTruthy();
    }
    for (const name of prompts) {
      expect(HOSTILE_MCP_CATALOG.find((c) => c.tool === name && c.kind === 'prompt')).toBeTruthy();
    }
  });

  it('covers the dynamic tools in index.mjs', () => {
    const { dynamic } = namesFromIndex();
    expect(dynamic).toContain('get_stock_price');
    expect(dynamic).toContain('read_ticket');
    for (const name of dynamic) {
      expect(HOSTILE_MCP_CATALOG.find((c) => c.tool === name)).toBeTruthy();
    }
  });

  it('covers every action stub in index.mjs', () => {
    const { action } = namesFromIndex();
    expect(action.length).toBe(3);
    for (const name of action) {
      expect(
        HOSTILE_MCP_CATALOG.find((c) => c.tool === name && c.kind === 'action'),
      ).toBeTruthy();
    }
  });

  it('catalog has no extra tools the server does not serve', () => {
    const { meta, resources, prompts } = namesFromPoisons();
    const { action, dynamic } = namesFromIndex();
    const served = new Set([...meta, ...resources, ...prompts, ...action, ...dynamic]);
    const extras = HOSTILE_MCP_CATALOG.filter((c) => !served.has(c.tool));
    expect(extras, `catalog invents tools the server never served: ${extras.map((e) => e.tool)}`).toEqual([]);
  });

  it('every entry carries an honest four-layer defense map', () => {
    for (const c of HOSTILE_MCP_CATALOG) {
      for (const layer of ['agent', 'scanner', 'gateway', 'gap']) {
        expect(typeof c.defenses?.[layer], `${c.id}.${layer}`).toBe('string');
        expect(c.defenses[layer].length, `${c.id}.${layer}`).toBeGreaterThan(0);
      }
    }
  });

  it('the action entries name the gateway as the layer that denies them', () => {
    for (const c of HOSTILE_MCP_CATALOG.filter((x) => x.kind === 'action')) {
      expect(c.defenses.gateway.toLowerCase()).toMatch(/yes|deny/);
    }
  });

  it('CATALOG_KINDS covers every kind used', () => {
    const used = new Set(HOSTILE_MCP_CATALOG.map((c) => c.kind));
    for (const k of used) expect(CATALOG_KINDS.find((x) => x.key === k)).toBeTruthy();
  });
});
