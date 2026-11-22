'use strict';

/**
 * Decision log: one timestamped line per authorization decision this server makes, written to stdout/stderr so a log
 * collector (or `kubectl logs`) can show what the resource server decided for a run.
 *
 * Spec: docs/superpowers/specs/2026-11-22-mcp-resource-server-decision-log.md
 *
 * Shapes are `[<ISO time>] <LEVEL>: <message>`, the shapes the family's run-observability panel reads for an MCP server:
 *   INFO  token audience validated ...   -> information (carries the ids, so a run can be matched by sub / client)
 *   WARN  token validation failed ... | token expired ... | audience mismatch ... | insufficient scope ... | tool call denied ... | unauthorized ...  -> refused
 *   INFO  Tool <name> called             -> served (exactly this message)
 * Never written: the token, claims other than sub / client_id / act chain / scope, tool arguments, results.
 * Every value is one line of safe characters; a JWT-shaped string is replaced; a failing sink never changes an MCP reply.
 */

import type { DecodedToken } from './server/tokenValidator';

type Level = 'INFO' | 'WARN' | 'ERROR';

const MAX_LINE = 400;
const JWT_LIKE = /eyJ[\w-]{4,}\.[\w-]{4,}\.?[\w-]*/g;

/** Default ON. Off for `false`, `0`, `off` or `no` (any case). */
export function decisionLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.MCP_RESOURCE_SERVER_DECISION_LOG ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(v);
}

const stdSink = (level: Level, line: string): void => {
  if (level === 'INFO') console.log(line);
  else if (level === 'WARN') console.warn(line);
  else console.error(line);
};
let sink: (level: Level, line: string) => void = stdSink;

/** Tests only: where lines go (null restores stdout/stderr). */
export function __setDecisionSinkForTests(fn: ((level: Level, line: string) => void) | null): void {
  sink = fn ?? stdSink;
}

/** One field value: safe characters only, so a claim cannot add a key=value pair, a quote or a second line. */
export function fieldValue(v: unknown, max = 120): string {
  const s = String(v ?? '').replace(JWT_LIKE, '<jwt>').replace(/[^A-Za-z0-9._:/@+<>,-]+/g, '_').slice(0, max);
  return s || '-';
}

/** Free text (a reason): one line, no control characters, JWT-shaped strings replaced, bounded. */
export function reasonText(v: unknown, max = 160): string {
  return String(v ?? '').replace(JWT_LIKE, '<jwt>').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function write(level: Level, message: string): void {
  if (!decisionLogEnabled()) return;
  try {
    sink(level, `[${new Date().toISOString()}] ${level}: ${message}`.slice(0, MAX_LINE));
  } catch { /* a log sink must never change an MCP reply */ }
}

const scopesOf = (d: DecodedToken): string => (Array.isArray(d.scope) ? d.scope.map(String) : String(d.scope ?? '').split(' ')).filter(Boolean).join(' ');

/** Token passed signature, expiry and audience. */
export function logTokenValidated(method: string, d: DecodedToken & { client_id?: string }): void {
  const act = d.act as { sub?: string; act?: { sub?: string } } | undefined;
  write('INFO', `token audience validated method=${fieldValue(method, 40)} sub=${fieldValue(d.sub)} client=${fieldValue(d.client_id)} act=${fieldValue(act?.sub)} actprior=${fieldValue(act?.act?.sub)} scope="${fieldValue(scopesOf(d).replace(/ /g, ','), 160)}"`);
}

/** Token failed. TokenError.code picks the phrase; anything else is a plain validation failure. */
export function logTokenRefused(method: string, err: unknown): void {
  const code = (err as { code?: string })?.code;
  const phrase = code === 'invalid_aud' ? 'audience mismatch' : code === 'expired_token' ? 'token expired' : 'token validation failed';
  write('WARN', `${phrase} method=${fieldValue(method, 40)} reason=${reasonText(err instanceof Error ? err.message : err)}`);
}

/** No bearer token on an HTTP request. */
export function logNoBearer(method: string | undefined, path: string): void {
  write('WARN', `unauthorized method=${fieldValue(method, 40)} path=${fieldValue(path, 60)} reason=no bearer token`);
}

/** A tool name is written only when the server knows it; request text never becomes a field. */
export function logToolUnknown(sub: string): void {
  write('WARN', `tool call denied tool=- reason=unknown tool sub=${fieldValue(sub)}`);
}

export function logScopeRefused(tool: string, required: string[], sub: string): void {
  write('WARN', `insufficient scope tool=${fieldValue(tool, 64)} required="${fieldValue(required.join(','), 160)}" sub=${fieldValue(sub)}`);
}

/** Exactly `Tool <name> called`: the shape the panel reads as served. `tool` must be a registered tool name. */
export function logToolCalled(tool: string): void {
  write('INFO', `Tool ${fieldValue(tool, 64)} called`);
}

export function logToolFailed(tool: string, sub: string): void {
  write('ERROR', `tool call failed tool=${fieldValue(tool, 64)} sub=${fieldValue(sub)}`);
}
