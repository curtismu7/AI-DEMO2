// Load env from demo_api_server/.env so the dev MCP server uses the same
// PingOne creds the BFF uses. Never write to it.

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BFF_ENV = path.join(REPO_ROOT, "demo_api_server", ".env");

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  if (fs.existsSync(BFF_ENV)) {
    dotenv.config({ path: BFF_ENV });
  }
  loaded = true;
}

export function repoRoot(): string {
  return REPO_ROOT;
}

export function bankingApiDataDir(): string {
  return path.join(REPO_ROOT, "demo_api_server", "data");
}

export function getEnv(key: string): string | undefined {
  loadEnv();
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
}

export function requireEnv(key: string): string {
  const v = getEnv(key);
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function pingOneBaseUrl(): string {
  const envId = requireEnv("PINGONE_ENVIRONMENT_ID");
  const region = getEnv("PINGONE_REGION") ?? "com";
  return `https://api.pingone.${region}/v1/environments/${envId}`;
}

export function pingOneAuthBaseUrl(): string {
  const envId = requireEnv("PINGONE_ENVIRONMENT_ID");
  const region = getEnv("PINGONE_REGION") ?? "com";
  return `https://auth.pingone.${region}/${envId}/as`;
}
