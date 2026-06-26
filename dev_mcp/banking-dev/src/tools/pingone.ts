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

// Bootstrap check — always-on, read-only
export const pingoneCheckBootstrapSchema = z.object({});

export async function pingoneCheckBootstrap(): Promise<{
  configured: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  summary: string;
}> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  const envVars = [
    'PINGONE_ENVIRONMENT_ID',
    'PINGONE_WORKER_CLIENT_ID',
    'PINGONE_WORKER_CLIENT_SECRET',
  ];
  for (const v of envVars) {
    const val = process.env[v];
    checks.push({
      name: `env:${v}`,
      ok: !!val && val.length > 0,
      detail: val ? 'set' : 'MISSING',
    });
  }

  const envOk = checks.every(c => c.ok);
  if (envOk) {
    try {
      const token = await getWorkerToken();
      checks.push({ name: 'worker_token', ok: true, detail: `obtained (${token.slice(0, 10)}…)` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({ name: 'worker_token', ok: false, detail: `failed: ${msg}` });
    }
  } else {
    checks.push({ name: 'worker_token', ok: false, detail: 'skipped — env vars missing' });
  }

  const configured = checks.every(c => c.ok);
  const failing = checks.filter(c => !c.ok).map(c => c.name);
  const summary = configured
    ? 'Bootstrap complete — all checks passed.'
    : `Bootstrap incomplete. Failing: ${failing.join(', ')}. Run: pingcli init`;

  return { configured, checks, summary };
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
