import { z } from "zod";
import {
  LOG_SERVICES,
  LogService,
  lineTimestamp,
  parseDuration,
  readTail,
  readWithLineNumbers,
} from "../shared/logFile";

const MAX_RESULT_BYTES = 4096;

function capByBytes<T>(items: T[], renderer: (t: T) => string): { kept: T[]; truncated: boolean } {
  let total = 0;
  const kept: T[] = [];
  for (const it of items) {
    total += renderer(it).length;
    if (total > MAX_RESULT_BYTES) return { kept, truncated: true };
    kept.push(it);
  }
  return { kept, truncated: false };
}

export const logsTailSchema = z.object({
  service: z.enum(LOG_SERVICES),
  lines: z.number().int().min(1).max(500).default(100),
});

export function logsTail(input: z.infer<typeof logsTailSchema>): {
  service: LogService;
  returned: number;
  lines: string[];
  truncated: boolean;
} {
  const all = readTail(input.service, input.lines);
  const { kept, truncated } = capByBytes(all, (s) => s + "\n");
  return { service: input.service, returned: kept.length, lines: kept, truncated };
}

export const logsGrepSchema = z.object({
  pattern: z.string().min(1).describe("Literal substring or /regex/flags"),
  services: z.array(z.enum(LOG_SERVICES)).optional(),
  since: z
    .string()
    .regex(/^\d+(s|m|h|d)$/)
    .default("5m"),
});

function compilePattern(p: string): RegExp {
  const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) return new RegExp(m[1], m[2]);
  return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

export function logsGrep(input: z.infer<typeof logsGrepSchema>): {
  pattern: string;
  services: LogService[];
  cutoff: string;
  matches: Array<{ service: LogService; line: number; text: string; ts: string | null }>;
  truncated: boolean;
} {
  const re = compilePattern(input.pattern);
  const services = (input.services ?? (LOG_SERVICES as readonly LogService[])) as LogService[];
  const cutoffMs = Date.now() - parseDuration(input.since);
  const all: Array<{ service: LogService; line: number; text: string; ts: number | null }> = [];
  for (const svc of services) {
    const matches = readWithLineNumbers(
      svc,
      (l) => {
        if (!re.test(l)) return false;
        const ts = lineTimestamp(l);
        return ts == null || ts >= cutoffMs;
      },
      500
    );
    for (const m of matches) {
      all.push({ ...m, ts: lineTimestamp(m.text) });
    }
  }
  all.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const { kept, truncated } = capByBytes(all, (m) => `${m.service}:${m.line}: ${m.text}\n`);
  return {
    pattern: input.pattern,
    services,
    cutoff: new Date(cutoffMs).toISOString(),
    matches: kept.map((m) => ({
      service: m.service,
      line: m.line,
      text: m.text,
      ts: m.ts != null ? new Date(m.ts).toISOString() : null,
    })),
    truncated,
  };
}

export const logsCorrelateSchema = z.object({
  request_id: z.string().min(4),
  services: z.array(z.enum(LOG_SERVICES)).optional(),
});

export function logsCorrelate(input: z.infer<typeof logsCorrelateSchema>): {
  request_id: string;
  total: number;
  services_hit: LogService[];
  events: Array<{ service: LogService; line: number; text: string; ts: string | null }>;
  truncated: boolean;
} {
  const services = (input.services ?? (LOG_SERVICES as readonly LogService[])) as LogService[];
  const all: Array<{ service: LogService; line: number; text: string; ts: number | null }> = [];
  for (const svc of services) {
    const m = readWithLineNumbers(svc, (l) => l.includes(input.request_id), 500);
    for (const e of m) all.push({ ...e, ts: lineTimestamp(e.text) });
  }
  all.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const { kept, truncated } = capByBytes(all, (m) => `${m.service}:${m.line}: ${m.text}\n`);
  const servicesHit = Array.from(new Set(kept.map((k) => k.service))) as LogService[];
  return {
    request_id: input.request_id,
    total: kept.length,
    services_hit: servicesHit,
    events: kept.map((m) => ({
      service: m.service,
      line: m.line,
      text: m.text,
      ts: m.ts != null ? new Date(m.ts).toISOString() : null,
    })),
    truncated,
  };
}

const ERROR_RE = /(ERROR|❌|aud mismatch|Failed|SyntaxError|UnhandledRejection|TypeError)/i;

export const logsErrorsSchema = z.object({
  since: z
    .string()
    .regex(/^\d+(s|m|h|d)$/)
    .default("10m"),
});

export function logsErrors(input: z.infer<typeof logsErrorsSchema>): {
  cutoff: string;
  groups: Array<{
    signature: string;
    count: number;
    services: LogService[];
    example: { service: LogService; line: number; text: string };
  }>;
  truncated: boolean;
} {
  const cutoffMs = Date.now() - parseDuration(input.since);
  const all: Array<{ service: LogService; line: number; text: string }> = [];
  for (const svc of LOG_SERVICES as readonly LogService[]) {
    const matches = readWithLineNumbers(
      svc,
      (l) => {
        if (!ERROR_RE.test(l)) return false;
        const ts = lineTimestamp(l);
        return ts == null || ts >= cutoffMs;
      },
      200
    );
    for (const m of matches) all.push(m);
  }
  // Dedupe by a coarse signature (strip uuids, hex, timestamps, ports, line numbers).
  const groups = new Map<
    string,
    { count: number; services: Set<LogService>; example: { service: LogService; line: number; text: string } }
  >();
  for (const m of all) {
    const sig = m.text
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, "<ts>")
      .replace(/\b\d+\b/g, "N")
      .slice(0, 120);
    const g = groups.get(sig);
    if (g) {
      g.count++;
      g.services.add(m.service);
    } else {
      groups.set(sig, { count: 1, services: new Set([m.service]), example: m });
    }
  }
  const sorted = Array.from(groups.entries())
    .map(([signature, g]) => ({
      signature,
      count: g.count,
      services: Array.from(g.services),
      example: g.example,
    }))
    .sort((a, b) => b.count - a.count);
  const { kept, truncated } = capByBytes(
    sorted,
    (g) => `${g.count}x [${g.services.join(",")}] ${g.example.text}\n`
  );
  return { cutoff: new Date(cutoffMs).toISOString(), groups: kept, truncated };
}

const OAUTH_TAGS_RE =
  /\[McpExchangerToken\]|\[pkceState\]|\[authState\]|\[oauthCallback\]|introspect|McpToken|TokenChain|act\b|may_act|aud mismatch|RFC ?8693|token exchange|client_credentials|access_token/i;

export const logsOauthFlowSchema = z.object({
  since: z
    .string()
    .regex(/^\d+(s|m|h|d)$/)
    .default("10m"),
});

export function logsOauthFlow(input: z.infer<typeof logsOauthFlowSchema>): {
  cutoff: string;
  events: Array<{ service: LogService; line: number; text: string; ts: string | null }>;
  truncated: boolean;
} {
  const cutoffMs = Date.now() - parseDuration(input.since);
  const all: Array<{ service: LogService; line: number; text: string; ts: number | null }> = [];
  for (const svc of LOG_SERVICES as readonly LogService[]) {
    const matches = readWithLineNumbers(
      svc,
      (l) => {
        if (!OAUTH_TAGS_RE.test(l)) return false;
        const ts = lineTimestamp(l);
        return ts == null || ts >= cutoffMs;
      },
      500
    );
    for (const m of matches) all.push({ ...m, ts: lineTimestamp(m.text) });
  }
  all.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const { kept, truncated } = capByBytes(all, (m) => `${m.service}:${m.line}: ${m.text}\n`);
  return {
    cutoff: new Date(cutoffMs).toISOString(),
    events: kept.map((m) => ({
      service: m.service,
      line: m.line,
      text: m.text,
      ts: m.ts != null ? new Date(m.ts).toISOString() : null,
    })),
    truncated,
  };
}
