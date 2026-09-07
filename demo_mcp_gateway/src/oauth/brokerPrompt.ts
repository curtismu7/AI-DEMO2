/**
 * Re-authentication parameters for this broker's PingOne authorize redirect.
 *
 * Owned by the BFF (services/mcpBrokerPrompt.js, key `mcp_broker_prompt`) so one
 * radio on /privilege-mcp-client drives BOTH brokers live, without recreating a
 * container. This service is image-built, so anything hard-coded here needs a
 * rebuild and a GHCR push to change — hence we fetch the PARAMS, not a mode, and
 * apply them blindly. A new mode then ships with a BFF restart alone.
 *
 * TLS verification stays ON: this container sets NODE_EXTRA_CA_CERTS to the
 * mkcert CA bundle (docker-compose.yml), which is what makes the BFF's cert
 * verify.
 *
 * Deliberately a near-copy of oauth-mcp/src/oauth/brokerPrompt.ts rather than a
 * shared package: the two brokers are separate builds with different BFF-access
 * conventions (this one takes a full BFF_* URL, like BFF_TRANSACTION_HOP_URL;
 * oauth-mcp takes DEMO_API_BASE_URL), and coupling them through a new shared
 * module would drag one service's build into the other's for ~40 lines.
 */

/**
 * Params we are willing to put on the authorize URL, whatever the BFF says.
 * The BFF is trusted, but this endpoint is unauthenticated and an authorize
 * request is not a place to let an upstream inject arbitrary OIDC parameters —
 * `redirect_uri` or `client_id` coming back from here must never take effect.
 */
const ALLOWED = new Set(['prompt', 'max_age']);

/**
 * Fallback when the BFF cannot be reached. `max_age` rather than nothing:
 * a lookup failure must not silently restore session reuse, which is the bug
 * this setting exists to prevent. 1800s matches the BFF's `once` window — the
 * BFF owns the real value; this is only the can't-ask case.
 */
const FALLBACK: Record<string, string> = { max_age: '1800' };

/** Authorize is user-driven and infrequent, but a demo click-storm should not
 *  hammer the BFF; a short TTL still picks a radio change up within seconds. */
const TTL_MS = 15_000;
const TIMEOUT_MS = 1_500;

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

let cached: { value: Record<string, string>; at: number } | null = null;
let _fetch: FetchLike | undefined;

/** Test seams — inject a fetch and clear the memoized value between cases. */
export function __setBrokerPromptFetch(f?: FetchLike): void {
  _fetch = f;
}
export function __resetBrokerPromptCache(): void {
  cached = null;
}

function sanitize(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (ALLOWED.has(k) && (typeof v === 'string' || typeof v === 'number')) out[k] = String(v);
  }
  return out;
}

function endpoint(): string {
  return String(process.env.BFF_BROKER_PROMPT_URL || '').trim();
}

/**
 * Resolve the authorize params. `MCP_BROKER_PROMPT` still pins a mode locally —
 * an operator override that also lets a deployment skip the network call — but
 * only for the two values this service can map without the BFF.
 * Never throws: a broken lookup must not take the authorize endpoint down.
 */
export async function resolveAuthorizeParams(): Promise<Record<string, string>> {
  const pinned = String(process.env.MCP_BROKER_PROMPT || '').trim();
  if (pinned === 'off') return {};
  if (pinned === 'login' || pinned === 'select_account') return { prompt: pinned };

  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  const url = endpoint();
  const doFetch = _fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!url || !doFetch) return FALLBACK;

  try {
    const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error('bad status');
    const body = (await res.json()) as { params?: unknown };
    const params = sanitize(body?.params);
    // `{}` is a real answer — mode 'off' — so only a MISSING/!object params
    // field falls back. Distinguishing them is the whole point of sanitize()
    // returning null rather than an empty object.
    if (params === null) throw new Error('no params');
    cached = { value: params, at: now };
    return params;
  } catch {
    // Cache the fallback too, so a BFF outage does not add a 1.5s timeout to
    // every authorize for as long as it lasts.
    cached = { value: FALLBACK, at: now };
    return FALLBACK;
  }
}
