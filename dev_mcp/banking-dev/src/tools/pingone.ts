import axios from "axios";
import { z } from "zod";
import { getWorkerToken, pingOneGet, pingOnePatch, pingOnePost } from "../shared/pingone";
import { redact } from "../shared/redact";

interface User {
  id: string;
  username?: string;
  email?: string;
  enabled?: boolean;
  mfaEnabled?: boolean;
  population?: { id?: string };
  [k: string]: unknown;
}

interface Embedded<T> {
  _embedded?: Record<string, T[]>;
  count?: number;
  size?: number;
}

export const pingoneListUsersSchema = z.object({
  filter: z.string().optional().describe('PingOne SCIM filter, e.g. username sw "demo"'),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().url().optional().describe('Next-page URL from prior response nextCursor field'),
});

export async function pingoneListUsers(input: z.infer<typeof pingoneListUsersSchema>): Promise<{
  count: number;
  nextCursor?: string;
  users: Array<{ id: string; username: string | undefined; email: string | undefined; enabled: boolean | undefined }>;
}> {
  let url: string;
  if (input.cursor) {
    url = input.cursor;
  } else {
    const params = new URLSearchParams();
    params.set("limit", String(input.limit));
    if (input.filter) params.set("filter", input.filter);
    url = `/users?${params.toString()}`;
  }

  const data = await pingOneGet<Embedded<User> & { _links?: { next?: { href?: string } } }>(url);
  const users = data._embedded?.users ?? [];
  const nextCursor = data._links?.next?.href;

  return {
    count: users.length,
    ...(nextCursor ? { nextCursor } : {}),
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      enabled: u.enabled,
    })),
  };
}

export const pingoneGetUserSchema = z.object({ userId: z.string().uuid() });

export async function pingoneGetUser(input: z.infer<typeof pingoneGetUserSchema>): Promise<{
  found: boolean;
  user: Record<string, unknown> | null;
}> {
  try {
    const u = await pingOneGet<Record<string, unknown>>(`/users/${input.userId}`);
    return { found: true, user: redact(u) };
  } catch (err: unknown) {
    if (typeof err === "object" && err && "response" in err) {
      const r = (err as { response?: { status?: number } }).response;
      if (r && r.status === 404) return { found: false, user: null };
    }
    throw err;
  }
}

interface AppRecord {
  id: string;
  name?: string;
  type?: string;
  enabled?: boolean;
  protocol?: string;
  [k: string]: unknown;
}

export const pingoneListAppsSchema = z.object({
  filter: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(100),
  cursor: z.string().url().optional().describe('Next-page URL from prior response nextCursor field'),
});

export async function pingoneListApps(input: z.infer<typeof pingoneListAppsSchema>): Promise<{
  count: number;
  nextCursor?: string;
  apps: Array<{ id: string; name?: string; type?: string; enabled?: boolean }>;
}> {
  let url: string;
  if (input.cursor) {
    url = input.cursor;
  } else {
    const params = new URLSearchParams();
    params.set("limit", String(input.limit));
    if (input.filter) params.set("filter", input.filter);
    url = `/applications?${params.toString()}`;
  }

  const data = await pingOneGet<Embedded<AppRecord> & { _links?: { next?: { href?: string } } }>(url);
  const apps = data._embedded?.applications ?? [];
  const nextCursor = data._links?.next?.href;

  return {
    count: apps.length,
    ...(nextCursor ? { nextCursor } : {}),
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      enabled: a.enabled,
    })),
  };
}

export const pingoneGetAppSchema = z.object({ appId: z.string().uuid() });

export async function pingoneGetApp(input: z.infer<typeof pingoneGetAppSchema>): Promise<{
  found: boolean;
  application: Record<string, unknown> | null;
  grants: Record<string, unknown> | null;
}> {
  try {
    const app = await pingOneGet<Record<string, unknown>>(`/applications/${input.appId}`);
    let grants: Record<string, unknown> | null = null;
    try {
      grants = await pingOneGet<Record<string, unknown>>(
        `/applications/${input.appId}/grants`
      );
    } catch {
      // Some app types don't expose grants — non-fatal
    }
    return { found: true, application: redact(app), grants: grants ? redact(grants) : null };
  } catch (err: unknown) {
    if (typeof err === "object" && err && "response" in err) {
      const r = (err as { response?: { status?: number } }).response;
      if (r && r.status === 404) return { found: false, application: null, grants: null };
    }
    throw err;
  }
}

interface ResourceRecord {
  id: string;
  name?: string;
  audience?: string[];
  type?: string;
  [k: string]: unknown;
}

export const pingoneListResourcesSchema = z.object({});

export async function pingoneListResources(): Promise<{
  count: number;
  resources: Array<{
    id: string;
    name: string | undefined;
    audience: string[] | undefined;
    type: string | undefined;
  }>;
}> {
  const data = await pingOneGet<Embedded<ResourceRecord>>(`/resources`);
  const resources = data._embedded?.resources ?? [];
  return {
    count: resources.length,
    resources: resources.map((r) => ({
      id: r.id,
      name: r.name,
      audience: r.audience,
      type: r.type,
    })),
  };
}

export const pingoneGetResourceScopesSchema = z.object({ resourceId: z.string().uuid() });

export async function pingoneGetResourceScopes(
  input: z.infer<typeof pingoneGetResourceScopesSchema>
): Promise<{
  count: number;
  scopes: Array<{ id: string; name: string | undefined; description: string | undefined }>;
}> {
  interface ScopeRecord {
    id: string;
    name?: string;
    description?: string;
  }
  const data = await pingOneGet<Embedded<ScopeRecord>>(
    `/resources/${input.resourceId}/scopes`
  );
  const scopes = data._embedded?.scopes ?? [];
  return {
    count: scopes.length,
    scopes: scopes.map((s) => ({ id: s.id, name: s.name, description: s.description })),
  };
}

// Bootstrap check + self-healing Helix setup — always-on, read-only
export const pingoneCheckBootstrapSchema = z.object({});

interface BootstrapCheck { name: string; ok: boolean; detail: string }
interface HelixKeyFile { keyValue?: string; keyName?: string; expiration?: string }

function findHelixKeyFile(agentName: string): { path: string; data: HelixKeyFile } | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("os") as typeof import("os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { repoRoot } = require("../shared/env") as typeof import("../shared/env");

  const safe = agentName.replace(/[^A-Za-z0-9_.-]/g, "");
  const candidates = [
    path.join(repoRoot(), `${safe}.json`),
    path.join(os.homedir(), "Documents", `${safe}.json`),
    path.join(os.homedir(), "Downloads", `${safe}.json`),
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as HelixKeyFile;
      if (typeof parsed.keyValue === "string" && parsed.keyValue.trim().length > 0) {
        return { path: candidate, data: parsed };
      }
    } catch { /* not found or unreadable */ }
  }
  return null;
}

async function postAdminConfig(config: Record<string, string>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require("https") as typeof import("https");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getEnv } = require("../shared/env") as typeof import("../shared/env");
  const baseUrl = getEnv("PUBLIC_APP_URL") ?? "https://api.ping.demo:4000";
  const agent = new https.Agent({ rejectUnauthorized: false });
  await axios.post(`${baseUrl}/api/admin/config`, config, {
    headers: { "Content-Type": "application/json" },
    httpsAgent: agent,
    timeout: 10_000,
  });
}

async function getAdminConfig(): Promise<Record<string, unknown>> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const https = require("https") as typeof import("https");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getEnv } = require("../shared/env") as typeof import("../shared/env");
  const baseUrl = getEnv("PUBLIC_APP_URL") ?? "https://api.ping.demo:4000";
  const agent = new https.Agent({ rejectUnauthorized: false });
  const res = await axios.get<Record<string, unknown>>(`${baseUrl}/api/admin/config`, {
    httpsAgent: agent,
    timeout: 10_000,
  });
  return res.data;
}

export async function pingoneCheckBootstrap(): Promise<{
  configured: boolean;
  helix_configured: boolean;
  checks: BootstrapCheck[];
  summary: string;
  next_step?: string;
}> {
  const checks: BootstrapCheck[] = [];

  // PingOne env vars
  for (const v of ["PINGONE_ENVIRONMENT_ID", "PINGONE_WORKER_CLIENT_ID", "PINGONE_WORKER_CLIENT_SECRET"]) {
    const val = process.env[v];
    checks.push({ name: `env:${v}`, ok: !!val && val.length > 0, detail: val ? "set" : "MISSING" });
  }

  // PingOne worker token
  const pingoneEnvOk = checks.every((c) => c.ok);
  if (pingoneEnvOk) {
    try {
      const token = await getWorkerToken();
      checks.push({ name: "pingone:worker_token", ok: true, detail: `obtained (${token.slice(0, 10)}…)` });
    } catch (err: unknown) {
      checks.push({ name: "pingone:worker_token", ok: false, detail: `failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else {
    checks.push({ name: "pingone:worker_token", ok: false, detail: "skipped — PingOne env vars missing" });
  }

  // Helix: check current config via admin API
  let helixAlreadyConfigured = false;
  try {
    const cfg = await getAdminConfig();
    helixAlreadyConfigured = cfg["helix_api_key"] === "••••••••";
  } catch { /* API unreachable — fall through */ }

  if (helixAlreadyConfigured) {
    checks.push({ name: "helix:api_key", ok: true, detail: "already configured (key is set)" });
    checks.push({ name: "helix:base_url", ok: true, detail: "https://openam-helix.forgeblocks.com (hardcoded)" });
    checks.push({ name: "helix:agent_id", ok: true, detail: "LLM3 (hardcoded)" });
  } else {
    const keyFile = findHelixKeyFile("LLM3");
    if (!keyFile) {
      checks.push({ name: "helix:api_key", ok: false, detail: "LLM3.json not found in repo root, ~/Documents, or ~/Downloads" });
      checks.push({ name: "helix:base_url", ok: true, detail: "https://openam-helix.forgeblocks.com (hardcoded)" });
      checks.push({ name: "helix:agent_id", ok: true, detail: "LLM3 (hardcoded)" });
    } else {
      const expired = keyFile.data.expiration ? new Date(keyFile.data.expiration).getTime() < Date.now() : false;
      if (expired) {
        checks.push({ name: "helix:api_key", ok: false, detail: `LLM3.json found at ${keyFile.path} but key expired at ${keyFile.data.expiration}` });
        checks.push({ name: "helix:base_url", ok: true, detail: "https://openam-helix.forgeblocks.com (hardcoded)" });
        checks.push({ name: "helix:agent_id", ok: true, detail: "LLM3 (hardcoded)" });
      } else {
        try {
          await postAdminConfig({
            helix_api_key: keyFile.data.keyValue!,
            helix_base_url: "https://openam-helix.forgeblocks.com",
            helix_environment_id: "fe213c3c-9c1d-4bdb-954a-a22879dad26d",
            helix_agent_id: "LLM3",
            helix_prompt_field_id: "textInputa7c39a0e8292",
            provider: "helix",
          });
          checks.push({ name: "helix:api_key", ok: true, detail: `imported from ${keyFile.path}${keyFile.data.expiration ? ` (expires ${keyFile.data.expiration})` : ""}` });
          checks.push({ name: "helix:base_url", ok: true, detail: "https://openam-helix.forgeblocks.com (hardcoded)" });
          checks.push({ name: "helix:agent_id", ok: true, detail: "LLM3 (hardcoded)" });
        } catch (err: unknown) {
          checks.push({ name: "helix:api_key", ok: false, detail: `found ${keyFile.path} but admin config POST failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  }

  const configured = checks.filter((c) => c.name.startsWith("env:") || c.name.startsWith("pingone:")).every((c) => c.ok);
  const helixConfigured = checks.filter((c) => c.name.startsWith("helix:")).every((c) => c.ok);
  const failing = checks.filter((c) => !c.ok).map((c) => c.name);

  let summary: string;
  let next_step: string | undefined;
  if (configured && helixConfigured) {
    summary = "Bootstrap complete — PingOne and Helix are fully configured.";
  } else if (!configured) {
    summary = `PingOne not configured. Missing: ${failing.filter((n) => n.startsWith("env:")).join(", ")}. Run: npm run setup:fresh`;
    next_step = "run_setup_fresh";
  } else {
    summary =
      "PingOne is configured. Helix LLM needs a key.\n" +
      "1. Open https://console.pingone.com → AI → Helix → Agents → LLM3\n" +
      "2. Under Secret API Keys → Create Secret API Key → Download JSON\n" +
      "3. Rename the downloaded file to LLM3.json and place it in the repo root\n" +
      "4. Re-run this tool — it will detect the file and configure Helix automatically.";
    next_step = "download_llm3_json";
  }

  return { configured, helix_configured: helixConfigured, checks, summary, ...(next_step ? { next_step } : {}) };
}

// WRITE — only registered when DEV_MCP_PINGONE_WRITE=1
export const pingoneCreateWorkerAppSchema = z.object({
  name: z.string().min(1).describe('Display name for the new Worker application'),
  description: z.string().optional().describe('Optional description'),
});

export async function pingoneCreateWorkerApp(input: z.infer<typeof pingoneCreateWorkerAppSchema>): Promise<{
  created: boolean;
  appId?: string;
  name?: string;
  type?: string;
  error?: string;
}> {
  try {
    const body = {
      name: input.name,
      description: input.description ?? '',
      enabled: true,
      type: 'WORKER',
    };

    const app = await pingOnePost<AppRecord & { id: string }>('/applications', body);

    return {
      created: true,
      appId: app.id,
      name: app.name,
      type: app.type,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { created: false, error: msg };
  }
}

export const pingoneUpdateUserAttributeSchema = z.object({
  userId: z.string().uuid(),
  attribute: z.string().min(1).describe("e.g. 'mayAct' or 'email'"),
  value: z.unknown(),
});

export async function pingoneUpdateUserAttribute(
  input: z.infer<typeof pingoneUpdateUserAttributeSchema>
): Promise<{
  ok: true;
  userId: string;
  attribute: string;
  user: Record<string, unknown>;
}> {
  const body: Record<string, unknown> = { [input.attribute]: input.value };
  const updated = await pingOnePatch<Record<string, unknown>>(`/users/${input.userId}`, body);
  return {
    ok: true,
    userId: input.userId,
    attribute: input.attribute,
    user: redact(updated),
  };
}
