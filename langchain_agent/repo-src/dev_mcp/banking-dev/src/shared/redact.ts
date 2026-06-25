// Redact secrets in any value before returning to the agent.
// All token values shown as `<len=N tail=…XXXX>` so the agent can reason about
// length/identity diffs without seeing the secret.

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SECRET_KEYS = new Set([
  "access_token",
  "accessToken",
  "id_token",
  "idToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "password",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  "Set-Cookie",
  "api_key",
  "apiKey",
  "apikey",
  "PINGONE_ADMIN_CLIENT_SECRET",
  "PINGONE_WORKER_CLIENT_SECRET",
  "SESSION_SECRET",
]);

function tag(value: string): string {
  const tail = value.length >= 4 ? value.slice(-4) : value;
  return `<len=${value.length} tail=…${tail}>`;
}

export function redactString(s: string): string {
  return s
    .replace(JWT_RE, (m) => tag(m))
    .replace(BEARER_RE, (m) => `Bearer ${tag(m.replace(/^Bearer\s+/i, ""))}`);
}

export function redact<T>(value: T): T {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k)) {
        out[k] = typeof v === "string" ? tag(v) : "<redacted>";
      } else {
        out[k] = redact(v);
      }
    }
    return out as unknown as T;
  }
  return value;
}
