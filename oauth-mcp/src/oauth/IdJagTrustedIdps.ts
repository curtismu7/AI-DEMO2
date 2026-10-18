import * as fs from 'fs';
import * as https from 'https';
import axios from 'axios';

/**
 * The enterprise IdPs whose ID-JAGs this AS redeems: the env-configured IdP
 * (ENTERPRISE_IDP_*) plus a bring-your-own registry served by the BFF.
 *
 * The registry is fetched lazily with a short cache. A failed fetch keeps the
 * last good list (warned once) so a BFF blip never revokes trust mid-demo, and
 * never blocks startup or crashes the token endpoint.
 *
 * The registry decides whose ID-JAGs we accept, so the fetch is authenticated
 * both ways: we send ID_JAG_REGISTRY_TOKEN as a Bearer, and we verify the BFF's
 * TLS certificate — against ID_JAG_REGISTRY_CA_FILE (PEM, pinned) when set, else
 * the default trust store (system roots + NODE_EXTRA_CA_CERTS). Never skipped.
 */

export interface TrustedIdp {
  id: string;
  issuer: string;
  jwksUrl: string;
  /** IdP-side client_id in the ID-JAG -> our redeeming client_id. */
  clientAliases: Record<string, string>;
  /** Space-separated extra cap on granted scope; empty = no extra cap. */
  scopes: string;
  /** Accept an ID-JAG without client_id. Only the env IdP may opt in. */
  allowUnboundClient?: boolean;
}

const CACHE_MS = 30_000;
const TIMEOUT_MS = 3_000;
const REGISTRY_PATH = '/api/id-jag-playground/trusted-idps/registry';

let registry: TrustedIdp[] = [];
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let warned = false;

/** "idp-client=our-client,other=ours" -> { 'idp-client': 'our-client', other: 'ours' } */
function parseClientAliases(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw || '').split(',')) {
    const [from, to] = pair.split('=').map((s) => s.trim());
    if (from && to) out[from] = to;
  }
  return out;
}

export function envIdp(): TrustedIdp | undefined {
  const issuer = process.env.ENTERPRISE_IDP_ISSUER;
  const jwksUrl = process.env.ENTERPRISE_IDP_JWKS_URL;
  if (!issuer || !jwksUrl) return undefined;
  return {
    id: 'env',
    issuer,
    jwksUrl,
    clientAliases: parseClientAliases(process.env.ENTERPRISE_IDP_ID_JAG_CLIENT_MAP),
    scopes: '',
    allowUnboundClient: process.env.ENTERPRISE_IDP_ALLOW_UNBOUND_ID_JAG === 'true',
  };
}

function registryUrl(): string | null {
  const explicit = process.env.ENTERPRISE_IDP_REGISTRY_URL;
  if (explicit) return explicit === 'off' ? null : explicit;
  const base = process.env.DEMO_API_BASE_URL;
  return base ? `${base.replace(/\/+$/, '')}${REGISTRY_PATH}` : null;
}

function parseRegistry(data: unknown): TrustedIdp[] {
  const idps = (data as { idps?: unknown })?.idps;
  if (!Array.isArray(idps)) throw new Error('registry response has no idps array');
  return idps
    .filter((e): e is Record<string, unknown> =>
      !!e && typeof e.issuer === 'string' && !!e.issuer && typeof e.jwksUrl === 'string' && !!e.jwksUrl)
    .map((e) => ({
      id: String(e.id ?? e.issuer),
      issuer: e.issuer as string,
      jwksUrl: e.jwksUrl as string,
      clientAliases: e.clientAliases && typeof e.clientAliases === 'object'
        ? Object.fromEntries(Object.entries(e.clientAliases as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : {},
      scopes: typeof e.scopes === 'string' ? e.scopes : '',
    }));
}

/** Refresh the registry if stale. Never throws; failure keeps the last good list. */
export async function refreshRegistry(): Promise<void> {
  const url = registryUrl();
  if (!url) { registry = []; return; }
  if (Date.now() - fetchedAt < CACHE_MS) return;
  if (!inflight) {
    inflight = (async () => {
      try {
        const caFile = process.env.ID_JAG_REGISTRY_CA_FILE;
        const token = process.env.ID_JAG_REGISTRY_TOKEN;
        const res = await axios.get(url, {
          timeout: TIMEOUT_MS,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          httpsAgent: caFile && url.startsWith('https') ? new https.Agent({ ca: fs.readFileSync(caFile) }) : undefined,
        });
        registry = parseRegistry(res.data);
        warned = false;
      } catch (err) {
        if (!warned) {
          console.warn(`[IdJag] trusted-IdP registry fetch failed (${url}); keeping last good list: ${(err as Error).message}`);
          warned = true;
        }
      } finally {
        fetchedAt = Date.now(); // failures also wait out the cache window — no hammering
        inflight = null;
      }
    })();
  }
  await inflight;
}

/** Synchronous view: env IdP first (wins an issuer collision), then the cached registry. */
export function trustedIdps(): TrustedIdp[] {
  const env = envIdp();
  return env ? [env, ...registry.filter((r) => r.issuer !== env.issuer)] : [...registry];
}

export function resetTrustedIdpsForTests(): void {
  registry = [];
  fetchedAt = 0;
  inflight = null;
  warned = false;
}
