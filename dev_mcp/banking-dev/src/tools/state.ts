import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { open, type Database } from "lmdb";
import { bankingApiDataDir } from "../shared/env";
import { redact, redactString } from "../shared/redact";
import { decodeJwt, describeDecoded } from "../shared/jwt";

interface LmdbSessionEntry {
  sess: Record<string, unknown>;
  expire: number;
}

function sessionsLmdbDir(): string {
  return path.join(bankingApiDataDir(), "persistent", "lmdb");
}

// Module-level singleton — avoids opening a new env + leaking file descriptors
// on every MCP tool call. Lazily initialised on first use.
let _sessionsDbSingleton: Database<LmdbSessionEntry, string> | null = null;
function getSessionsDb() {
  if (!_sessionsDbSingleton) {
    const dir = sessionsLmdbDir();
    const env = open({ path: dir, encoding: "json", maxDbs: 16 });
    _sessionsDbSingleton = env.openDB<LmdbSessionEntry, string>("sessions", { encoding: "json" });
  }
  return _sessionsDbSingleton;
}

function runtimeDataPath(): string {
  return path.join(bankingApiDataDir(), "runtimeData.json");
}

function bootstrapDataPath(): string {
  return path.join(bankingApiDataDir(), "bootstrapData.json");
}

function sampleDataPath(): string {
  return path.join(bankingApiDataDir(), "sampleData.js");
}

function backupsDir(): string {
  return path.join(bankingApiDataDir(), "backups");
}

function summarizeSess(sessJson: string): {
  cookieExpires: string | null;
  sub: string | null;
  scope: string | null;
  aud: string[] | string | null;
  hasAccessToken: boolean;
  accessTokenInfo: ReturnType<typeof describeDecoded> | null;
  hasIdToken: boolean;
  hasRefreshToken: boolean;
  keys: string[];
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(sessJson);
  } catch {
    return {
      cookieExpires: null,
      sub: null,
      scope: null,
      aud: null,
      hasAccessToken: false,
      accessTokenInfo: null,
      hasIdToken: false,
      hasRefreshToken: false,
      keys: [],
    };
  }
  const cookie = parsed.cookie as Record<string, unknown> | undefined;
  const tokens = parsed.oauthTokens as Record<string, unknown> | undefined;
  const access = typeof tokens?.accessToken === "string" ? (tokens.accessToken as string) : null;
  let info: ReturnType<typeof describeDecoded> | null = null;
  if (access) {
    try {
      info = describeDecoded(decodeJwt(access));
    } catch {
      info = null;
    }
  }
  return {
    cookieExpires:
      cookie && typeof cookie.expires === "string" ? (cookie.expires as string) : null,
    sub: info?.sub ?? null,
    scope: info?.scope ?? null,
    aud: info?.aud ?? null,
    hasAccessToken: !!access,
    accessTokenInfo: info,
    hasIdToken: typeof tokens?.idToken === "string",
    hasRefreshToken: typeof tokens?.refreshToken === "string",
    keys: Object.keys(parsed),
  };
}

export const sessionsListSchema = z.object({
  activeOnly: z.boolean().default(true).describe("When true, exclude expired sessions"),
  limit: z.number().int().min(1).max(100).default(20).describe("Maximum sessions to return (1–100, default 20)"),
});

export function sessionsList(input: z.infer<typeof sessionsListSchema>): {
  total: number;
  returned: number;
  sessions: Array<{ sid: string; expire: string; expired: boolean; summary: ReturnType<typeof summarizeSess> }>;
} {
  const dir = sessionsLmdbDir();
  if (!fs.existsSync(dir)) {
    return { total: 0, returned: 0, sessions: [] };
  }
  const db = getSessionsDb();
  const now = Date.now();
  const all: Array<{ sid: string; expire: string; expired: boolean; summary: ReturnType<typeof summarizeSess> }> = [];
  let total = 0;
  for (const { key, value } of db.getRange()) {
    if (!value) continue;
    total++;
    if (input.activeOnly && value.expire <= now) continue;
    all.push({
      sid: key,
      expire: new Date(value.expire).toISOString(),
      expired: value.expire <= now,
      summary: summarizeSess(JSON.stringify(value.sess)),
    });
  }
  all.sort((a, b) => (a.expire < b.expire ? 1 : -1));
  return { total, returned: Math.min(all.length, input.limit), sessions: all.slice(0, input.limit) };
}

export const sessionsGetSchema = z.object({ sid: z.string().min(8).describe("Session ID to retrieve") });

export function sessionsGet(input: z.infer<typeof sessionsGetSchema>): {
  found: boolean;
  sid: string;
  expire?: string;
  expired?: boolean;
  session?: Record<string, unknown>;
} {
  const dir = sessionsLmdbDir();
  if (!fs.existsSync(dir)) return { found: false, sid: input.sid };
  const db = getSessionsDb();
  const entry = db.get(input.sid);
  if (!entry) return { found: false, sid: input.sid };
  return {
    found: true,
    sid: input.sid,
    expire: new Date(entry.expire).toISOString(),
    expired: entry.expire <= Date.now(),
    session: redact(entry.sess),
  };
}

function readRuntimeData(): Record<string, unknown> {
  const file = runtimeDataPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const configGetSchema = z.object({ key: z.string().min(1).describe("Config key to look up (checked in runtimeData then env)") });

export function configGet(input: z.infer<typeof configGetSchema>): {
  key: string;
  found: boolean;
  source: "runtimeData" | "env" | null;
  value: unknown;
} {
  const rt = readRuntimeData();
  if (Object.prototype.hasOwnProperty.call(rt, input.key)) {
    const raw = rt[input.key];
    const value =
      typeof raw === "string" && /secret|password|token/i.test(input.key)
        ? redactString(raw)
        : raw;
    return { key: input.key, found: true, source: "runtimeData", value };
  }
  const envVal = process.env[input.key];
  if (envVal != null) {
    const value = /SECRET|PASSWORD|TOKEN/i.test(input.key) ? redactString(envVal) : envVal;
    return { key: input.key, found: true, source: "env", value };
  }
  return { key: input.key, found: false, source: null, value: null };
}

export const configListKeysSchema = z.object({ filter: z.string().optional().describe("Optional substring filter applied to key names") });

export function configListKeys(input: z.infer<typeof configListKeysSchema>): {
  count: number;
  keys: string[];
} {
  const rt = readRuntimeData();
  const all = Object.keys(rt);
  const filtered = input.filter
    ? all.filter((k) => k.toLowerCase().includes(input.filter!.toLowerCase()))
    : all;
  return { count: filtered.length, keys: filtered.sort() };
}

export function sampleDataSummary(): {
  source: string;
  bytes: number;
  preview: string;
  counts: {
    usersGuess: number;
    accountsGuess: number;
    transactionsGuess: number;
  };
} {
  const file = sampleDataPath();
  if (!fs.existsSync(file)) {
    return {
      source: file,
      bytes: 0,
      preview: "",
      counts: { usersGuess: 0, accountsGuess: 0, transactionsGuess: 0 },
    };
  }
  const content = fs.readFileSync(file, "utf8");
  // Coarse heuristics: count top-level array entries by `username:` / `accountId:`
  // / `transactionId:` occurrences. Avoids `require()` of the module.
  const usersGuess = (content.match(/username\s*:/g) ?? []).length;
  const accountsGuess = (content.match(/accountId\s*:/g) ?? []).length;
  const transactionsGuess =
    (content.match(/transactionId\s*:/g) ?? []).length +
    (content.match(/transferId\s*:/g) ?? []).length;
  return {
    source: file,
    bytes: content.length,
    preview: content.slice(0, 400),
    counts: { usersGuess, accountsGuess, transactionsGuess },
  };
}

export function backupList(): {
  dir: string;
  count: number;
  backups: Array<{ name: string; size: number; mtime: string }>;
} {
  const dir = backupsDir();
  if (!fs.existsSync(dir)) return { dir, count: 0, backups: [] };
  const entries = fs
    .readdirSync(dir)
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return { dir, count: entries.length, backups: entries };
}

export function bootstrapSummary(): {
  source: string;
  exists: boolean;
  bytes: number;
  topLevelKeys: string[];
} {
  const file = bootstrapDataPath();
  if (!fs.existsSync(file)) {
    return { source: file, exists: false, bytes: 0, topLevelKeys: [] };
  }
  const raw = fs.readFileSync(file, "utf8");
  let keys: string[] = [];
  try {
    const obj = JSON.parse(raw);
    keys = obj && typeof obj === "object" && !Array.isArray(obj) ? Object.keys(obj) : [];
  } catch {
    keys = [];
  }
  return { source: file, exists: true, bytes: raw.length, topLevelKeys: keys };
}
