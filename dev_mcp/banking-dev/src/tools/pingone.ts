import { z } from "zod";
import { pingOneGet, pingOnePatch } from "../shared/pingone";
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
});

export async function pingoneListUsers(input: z.infer<typeof pingoneListUsersSchema>): Promise<{
  count: number;
  users: Array<{
    id: string;
    username: string | undefined;
    email: string | undefined;
    enabled: boolean | undefined;
  }>;
}> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  if (input.filter) params.set("filter", input.filter);
  const data = await pingOneGet<Embedded<User>>(`/users?${params.toString()}`);
  const users = data._embedded?.users ?? [];
  return {
    count: users.length,
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
});

export async function pingoneListApps(input: z.infer<typeof pingoneListAppsSchema>): Promise<{
  count: number;
  applications: Array<{
    id: string;
    name: string | undefined;
    type: string | undefined;
    enabled: boolean | undefined;
    protocol: string | undefined;
  }>;
}> {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));
  if (input.filter) params.set("filter", input.filter);
  const data = await pingOneGet<Embedded<AppRecord>>(`/applications?${params.toString()}`);
  const apps = data._embedded?.applications ?? [];
  return {
    count: apps.length,
    applications: apps.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      enabled: a.enabled,
      protocol: a.protocol,
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

// WRITE — only registered when DEV_MCP_PINGONE_WRITE=1
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
