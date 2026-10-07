import axios from "axios";
import * as https from "https";
import { z } from "zod";
import { getEnv, requireEnv } from "../shared/env";
import { redact } from "../shared/redact";

// Read-only GETs against the PingFederate Admin API. The path is an enum, not free text,
// so this cannot be turned into a general proxy. Spec: docs/reference/pf-13.1.2-openapi.json
const RESOURCES = {
  version: "version",
  clients: "oauth/clients",
  cimdPolicies: "oauth/cimd/policies",
  cimdSettings: "oauth/cimd/settings",
  jwtBearerGrantProcessors: "oauth/jwtBearerGrantProcessors",
  tokenExchangeProcessorPolicies: "oauth/tokenExchange/processor/policies",
  cibaSettings: "oauth/cibaServerPolicy/settings",
  cibaRequestPolicies: "oauth/cibaServerPolicy/requestPolicies",
  outOfBandAuthPlugins: "oauth/outOfBandAuthPlugins",
} as const;

export const pfGetSchema = z.object({
  resource: z.enum(Object.keys(RESOURCES) as [keyof typeof RESOURCES, ...(keyof typeof RESOURCES)[]]),
  id: z.string().regex(/^[\w.-]+$/).optional().describe("Fetch one item by id instead of the list"),
});

const SECRET_FIELDS = new Set(["secret", "encryptedSecret", "password", "encryptedPassword"]);

function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, SECRET_FIELDS.has(k) ? "<redacted>" : scrub(x)])
    );
  }
  return v;
}

export async function pfGet(input: z.infer<typeof pfGetSchema>): Promise<{ resource: string; data: unknown }> {
  const base = getEnv("PINGFEDERATE_ADMIN_API_BASE") ?? "https://local.ping-devops.com:9999/pf-admin-api/v1";
  const path = RESOURCES[input.resource] + (input.id ? `/${input.id}` : "");
  const res = await axios.get(`${base}/${path}`, {
    auth: {
      username: getEnv("PINGFEDERATE_ADMIN_USER") ?? "administrator",
      password: requireEnv("PINGFEDERATE_ADMIN_PASSWORD"),
    },
    headers: { "X-XSRF-Header": "PingFederate" },
    httpsAgent: getEnv("PINGFEDERATE_ADMIN_TLS_INSECURE") === "1" ? new https.Agent({ rejectUnauthorized: false }) : undefined,
    timeout: 10_000,
  });
  return { resource: input.resource, data: redact(scrub(res.data)) };
}
