import * as fs from "fs";
import * as path from "path";
import { redactString } from "./redact";

export const LOG_SERVICES = [
  "api-server",
  "mcp-server",
  "mcp-gateway",
  "hitl-service",
  "mortgage-service",
  "mcp-invest",
  "agent-service",
  "langchain-agent",
  "authorize-server",
  "helix",
  "ui",
  "mcp-traffic",
  "api-llmonly",
] as const;

export type LogService = (typeof LOG_SERVICES)[number];

const LOG_DIR = "/tmp";

export function logPath(service: LogService): string {
  return path.join(LOG_DIR, `bank-${service}.log`);
}

export function readTail(service: LogService, lines: number): string[] {
  const file = logPath(service);
  if (!fs.existsSync(file)) return [];
  // Read the whole file then slice — log files are typically < few MB in dev.
  // For production-scale tails we'd seek, but this server is dev-only.
  const content = fs.readFileSync(file, "utf8");
  const all = content.split("\n");
  // Drop trailing blank line if file ends in \n
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  const tail = lines >= all.length ? all : all.slice(all.length - lines);
  return tail.map((l) => redactString(l));
}

export function readWithLineNumbers(
  service: LogService,
  predicate: (line: string) => boolean,
  cap: number
): Array<{ service: LogService; line: number; text: string }> {
  const file = logPath(service);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8");
  const out: Array<{ service: LogService; line: number; text: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && out.length < cap; i++) {
    if (predicate(lines[i])) {
      out.push({ service, line: i + 1, text: redactString(lines[i]) });
    }
  }
  return out;
}

// Parse a leading ISO-8601 timestamp from a log line if present.
// run-demo.sh prefixes lines with [ISO_TIME] but service loggers vary.
const ISO_PREFIX_RE = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/;
const ISO_LEADING_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/;

export function lineTimestamp(line: string): number | null {
  const m = line.match(ISO_PREFIX_RE) ?? line.match(ISO_LEADING_RE);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

// Parse "5m" / "1h" / "30s" / "2d" into ms.
export function parseDuration(input: string): number {
  const m = input.match(/^(\d+)(s|m|h|d)$/);
  if (!m) throw new Error(`Invalid duration: ${input}. Use Ns, Nm, Nh, Nd.`);
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    case "d":
      return n * 24 * 60 * 60 * 1000;
    default:
      throw new Error("Unreachable");
  }
}
