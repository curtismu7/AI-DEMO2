'use strict';

/**
 * Layered validation for Agent Gateway JSON files.
 *
 *   1. Syntax   — JSON.parse; on failure derive line/col for a Monaco marker.
 *   2. Schema   — per file `type`, lenient zod schemas that catch the common
 *                 "invalid parameter" mistakes without over-constraining the
 *                 large hand-authored IG/topology structures.
 *   3. Cross-check (routes/config only) — every ${env['VAR']} placeholder has a
 *                 matching key in ping-gateway/.env.example. Non-blocking WARN,
 *                 ported from ping-gateway/scripts/validate-config.sh.
 *
 * Returns { ok, parsed, errors }. `ok` is false when any error-level item
 * exists; warnings never block a save. Each error:
 *   { level: 'error'|'warn', path, message, line?, col? }
 */

const fs = require('fs');
const { z } = require('zod');
const { ENV_EXAMPLE_PATH } = require('./fileRegistry');

// ---------------------------------------------------------------------------
// 1. Syntax — parse and, on failure, locate the offending line/column.
// ---------------------------------------------------------------------------
function parseWithLocation(raw) {
  try {
    return { parsed: JSON.parse(raw), error: null };
  } catch (err) {
    // V8 SyntaxError messages include "... in JSON at position N" (and often
    // "(line L column C)"). Prefer the explicit line/column when present,
    // else derive it from the byte position.
    let line, col;
    const lc = /line (\d+) column (\d+)/i.exec(err.message);
    if (lc) {
      line = Number(lc[1]);
      col = Number(lc[2]);
    } else {
      const posMatch = /position (\d+)/i.exec(err.message);
      if (posMatch) {
        const pos = Number(posMatch[1]);
        const before = raw.slice(0, pos);
        line = before.split('\n').length;
        col = pos - before.lastIndexOf('\n');
      }
    }
    return {
      parsed: null,
      error: { level: 'error', path: '(root)', message: `Invalid JSON: ${err.message}`, line, col },
    };
  }
}

// ---------------------------------------------------------------------------
// 2. Schema — per type. Kept lenient (.passthrough / .catchall) so unknown
//    IG heap/filter keys are allowed; we only assert the shape that, if wrong,
//    breaks the gateway.
// ---------------------------------------------------------------------------
// zod v4: use `error` (not `required_error`) for custom messages, and the
// two-arg z.record(keyType, valueType). Objects stay lenient via .passthrough()
// so unknown IG heap/filter keys are allowed.
const anyObject = z.record(z.string(), z.any());

const heapNode = z.object({
  name: z.string(),
  type: z.string(),
  config: anyObject.optional(),
}).passthrough();

const handlerSchema = z.union([z.string(), anyObject], {
  error: '"handler" must be a heap reference (string) or an inline handler object',
});

const igRouteSchema = z.object({
  name: z.string({ error: 'route "name" (string) is required' }),
  condition: z.string({ error: 'route "condition" (string) is required' }),
  heap: z.array(heapNode).optional(),
  handler: handlerSchema,
}).passthrough();

const igConfigSchema = z.object({
  heap: z.array(heapNode, { error: 'config "heap" must be an array of heap objects' }),
  handler: handlerSchema,
}).passthrough();

const igAdminSchema = z.object({
  mode: z.string().optional(),
  streamingEnabled: z.boolean().optional(),
}).passthrough();

const resourceSchema = z.object({
  uri: z.string({ error: 'resource "uri" (string) is required' }),
  scopes: z.array(z.string(), { error: 'resource "scopes" must be an array of strings' }),
  mirroredScopes: z.array(z.string(), { error: 'resource "mirroredScopes" must be an array of strings' }).optional(),
}).passthrough();

const scopeTopologySchema = z.object({
  resources: z.record(z.string(), resourceSchema, {
    error: 'scope-topology must have a "resources" object',
  }),
}).passthrough();

const SCHEMA_BY_TYPE = {
  'ig-route': igRouteSchema,
  'ig-config': igConfigSchema,
  'ig-admin': igAdminSchema,
  'scope-topology': scopeTopologySchema,
};

function schemaErrors(type, parsed) {
  const schema = SCHEMA_BY_TYPE[type];
  if (!schema) return [];
  const result = schema.safeParse(parsed);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    level: 'error',
    path: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

// ---------------------------------------------------------------------------
// 3. Placeholder cross-check — routes/config reference ${env['VAR']}; warn on
//    any VAR missing from .env.example. Non-blocking.
// ---------------------------------------------------------------------------
function placeholderWarnings(raw) {
  const warnings = [];
  let defined = null;
  try {
    const envText = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    defined = new Set(
      envText.split('\n')
        .map((l) => /^([A-Z0-9_]+)=/.exec(l))
        .filter(Boolean)
        .map((m) => m[1])
    );
  } catch {
    return warnings; // no .env.example to compare against → skip silently
  }

  const referenced = new Set();
  const re = /\$\{env\['([^']+)'\]\}/g;
  let m;
  while ((m = re.exec(raw)) !== null) referenced.add(m[1]);

  for (const varName of referenced) {
    if (!defined.has(varName)) {
      warnings.push({
        level: 'warn',
        path: varName,
        message: `Placeholder \${env['${varName}']} has no matching key in .env.example`,
      });
    }
  }
  return warnings;
}

/**
 * Validate raw text for a given file type.
 * @returns {{ ok: boolean, parsed: any|null, errors: Array }}
 */
function validate(type, raw) {
  const { parsed, error } = parseWithLocation(raw);
  if (error) return { ok: false, parsed: null, errors: [error] };

  const errors = schemaErrors(type, parsed);
  const warnings = (type === 'ig-route' || type === 'ig-config')
    ? placeholderWarnings(raw)
    : [];

  const all = [...errors, ...warnings];
  const ok = !all.some((e) => e.level === 'error');
  return { ok, parsed, errors: all };
}

module.exports = { validate };
