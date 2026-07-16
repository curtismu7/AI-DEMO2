/**
 * OKF Knowledge Assertions — MCP tool for dev agents.
 *
 * Reads OKF bundles from graphify-out/ and returns assertions
 * for codebase-aware coding agents (Claude Code, Cursor, etc.).
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const getOkfAssertionsSchema = z.object({
  domain: z.string().describe(
    'Domain slug to query: "repo-topology" (codebase architecture) or "banking-domain" (banking policies). Use "list" to see all available domains.'
  ),
  tags: z.array(z.string()).optional().describe(
    'Optional tag filter (OR logic). Examples: ["feature-flags", "auth"], ["fraud", "policy"].'
  ),
  id: z.string().optional().describe(
    'Optional specific assertion ID (e.g., "K1", "K13").'
  ),
  format: z.enum(['structured', 'summary']).optional().describe(
    'Output format: "structured" (default) or "summary" (one-liner per assertion).'
  ),
});

// ---------------------------------------------------------------------------
// Bundle loader (lightweight, reads from disk each time — bundles are small)
// ---------------------------------------------------------------------------

interface Assertion {
  id: string;
  claim: string;
  source: string;
  confidence: number;
  citations?: { ref: string; uri?: string }[];
  tags?: string[];
}

interface OkfBundle {
  '@context': string;
  id: string;
  version: string;
  domain: string;
  title: string;
  description?: string;
  assertions: Assertion[];
}

function findBundleDir(): string {
  // Walk up from this file to find graphify-out/
  let dir = path.resolve(__dirname, '..', '..', '..', '..');
  const candidate = path.join(dir, 'graphify-out');
  if (fs.existsSync(candidate)) return candidate;
  // Fallback: try from CWD
  const cwdCandidate = path.join(process.cwd(), 'graphify-out');
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  return candidate; // return default even if missing (will error gracefully)
}

function loadBundles(): Map<string, OkfBundle> {
  const dir = findBundleDir();
  const bundles = new Map<string, OkfBundle>();

  if (!fs.existsSync(dir)) return bundles;

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.okf.json'));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const bundle = JSON.parse(raw) as OkfBundle;
      if (bundle.domain && bundle.assertions) {
        bundles.set(bundle.domain, bundle);
      }
    } catch { /* skip invalid */ }
  }

  return bundles;
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

export async function getOkfAssertions(params: z.infer<typeof getOkfAssertionsSchema>): Promise<string> {
  const bundles = loadBundles();
  const { domain, tags, id, format = 'structured' } = params;

  // List domains
  if (domain === 'list') {
    const domains = Array.from(bundles.entries()).map(([slug, b]) => ({
      domain: slug,
      title: b.title,
      version: b.version,
      assertionCount: b.assertions.length,
      tags: [...new Set(b.assertions.flatMap(a => a.tags || []))].slice(0, 8),
    }));
    return JSON.stringify({ availableDomains: domains }, null, 2);
  }

  // Validate domain
  const bundle = bundles.get(domain);
  if (!bundle) {
    const available = Array.from(bundles.keys()).join(', ');
    return JSON.stringify({ error: `Domain "${domain}" not found. Available: ${available}` });
  }

  // Single assertion by ID
  if (id) {
    const assertion = bundle.assertions.find(a => a.id === id);
    if (!assertion) {
      return JSON.stringify({ error: `Assertion "${id}" not found in "${domain}".` });
    }
    return JSON.stringify({ domain, assertion, cite: `Reference as [${id}]` }, null, 2);
  }

  // Filter by tags
  let assertions = bundle.assertions;
  if (tags && tags.length > 0) {
    assertions = assertions.filter(a => a.tags?.some(t => tags.includes(t)));
  }

  // Summary format
  if (format === 'summary') {
    const lines = [
      `# ${bundle.title} (v${bundle.version})`,
      `Domain: ${domain} | Assertions: ${assertions.length}`,
      '',
      ...assertions.map(a => `[${a.id}] ${a.claim.slice(0, 120)}${a.claim.length > 120 ? '...' : ''}`),
      '',
      'Use format:"structured" or id:"K1" for full assertion details.',
    ];
    return lines.join('\n');
  }

  // Structured format (default)
  return JSON.stringify({
    domain,
    version: bundle.version,
    title: bundle.title,
    totalAssertions: bundle.assertions.length,
    returnedAssertions: assertions.length,
    filtered: !!(tags && tags.length > 0),
    assertions,
    usage: 'These are deterministic facts. Cite as [K1], [K2], etc. Do not contradict them.',
  }, null, 2);
}
