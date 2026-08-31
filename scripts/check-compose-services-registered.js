#!/usr/bin/env node
/**
 * check-compose-services-registered.js — every docker-compose service must be
 * reachable through ./run-docker.sh.
 *
 * Why this exists: three times on 2026-08-27 something was added in one place
 * while the tool that manages it kept its own list, and each time the gap was
 * only found by running the thing:
 *
 *   - k8s/aws/deploy.sh applies an explicit manifest list; 76-prometheus and
 *     77-grafana were missing, so a fresh se-deploy crash-looped the frontend
 *     and took the whole site down (#2469)
 *   - AdminSideNav has a mirror catalog; a new child tripped its drift test and
 *     that one WAS caught automatically (#2466)
 *   - run-docker.sh has SERVICES; prometheus and grafana were missing, so
 *     `./run-docker.sh restart grafana` answered "Unknown service" (#2477)
 *
 * Only the nav had a guard. This is the compose one.
 *
 * A service counts as reachable when it is either listed in run-docker.sh's
 * SERVICES table, or carries one of the optional-group profiles (those are
 * resolved at runtime by _optional_group_services, so is_known_service accepts
 * them). Anything else must be named in ALLOWED_UNREGISTERED with a reason.
 *
 * Reads docker-compose.yml as text rather than shelling out to
 * `docker compose config` (needs the gitignored .env files and a running
 * daemon) or requiring the `yaml` package (root node_modules are NOT installed
 * in CI's hygiene job — that is how the first version of this script failed the
 * very gate it was added to). Every other check in hygiene:check parses its
 * inputs the same dependency-free way.
 *
 * Only two things are extracted, so a full parser is not warranted: the service
 * names (keys at exactly two-space indent under `services:`) and each service's
 * `profiles:` list. The parser self-checks — finding zero services or zero
 * SERVICES entries is a hard failure, so silent parser rot cannot pass
 * vacuously.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMPOSE = path.join(ROOT, 'docker-compose.yml');
const LAUNCHER = path.join(ROOT, 'run-docker.sh');

/**
 * Compose profiles that map to `./run-docker.sh optional <group>`. Kept in sync
 * with OPTIONAL_GROUP_NAMES / _optional_group_profiles in run-docker.sh — a
 * service carrying one of these is startable even though it is not in SERVICES.
 */
const OPTIONAL_PROFILES = new Set(['rag', 'agents', 'tracing', 'demo-auth', 'mcpgw']);

/**
 * Services deliberately NOT managed by run-docker.sh. Each needs a reason: the
 * point of the allowlist is that skipping a service is a decision someone made,
 * not an oversight nobody noticed.
 */
const ALLOWED_UNREGISTERED = {
  'llm-proxy':
    'MUST stay unregistered, not merely unmanaged: clear_stale_host_listeners() ' +
    'kills any non-Docker listener on every port in the SERVICES table, and with ' +
    'LLM_BACKEND=omlx|mlx the HOST owns :8090 — registering it would shoot the ' +
    'host LLM backend on every start (run-docker.sh:1138, deploy-live.sh:222). ' +
    'Recreate it with compose directly: --no-deps --force-recreate llm-proxy; ' +
    'add --build only when the image itself is stale, since se-update-code.sh llm ' +
    'already rebuilds and pushes it.',
  'tier-manager-k8':
    'k8s-only tier manager; the Docker stack drives tiers through llm-proxy, so it is never started by the launcher',
  'ungoverned-agent':
    'deliberately-ungoverned demo agent, run ad hoc for the attack narrative rather than as part of any stack',
  mcpgw:
    'PRE-EXISTING ANOMALY, allowlisted rather than silently fixed: unlike its siblings ' +
    '(mcpgw-nginx, ping-mcpgw, opensearch — all profiles:[mcpgw]) this one declares NO profile, ' +
    'so compose treats it as core, yet it has no container running and no SERVICES entry. ' +
    'Either it should carry profiles:[mcpgw] like the rest of that group, or it should be ' +
    'registered — that call belongs to whoever owns the Privilege gateway work, not to the ' +
    'change that added this guard.',
};

function fail(lines) {
  console.error('\n[compose-services] FAILED\n');
  for (const l of lines) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
}

/**
 * Service name -> its `profiles:` array, read straight from the compose text.
 * @returns {Map<string, string[]>}
 */
function parseComposeServices(text) {
  const lines = text.split('\n');
  const out = new Map();

  let inServices = false;
  let current = null;
  // Only collect `- x` items while inside a profiles: block. Without this the
  // parser also swallows command:/args: entries, which sit at the same indent —
  // measured: it read "-c" and "--web.enable-lifecycle" as profile names.
  let inProfiles = false;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || /^\s*#/.test(line)) continue;

    // A key at column 0 opens or closes the services block.
    if (/^[A-Za-z0-9_.-]+:/.test(line)) {
      inServices = line.startsWith('services:');
      current = null;
      inProfiles = false;
      continue;
    }
    if (!inServices) continue;

    // Exactly two spaces = a service name.
    const svc = /^ {2}([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/.exec(line);
    if (svc) {
      current = svc[1];
      out.set(current, []);
      inProfiles = false;
      continue;
    }
    if (!current) continue;

    // Any other four-space key closes a profiles: block.
    if (/^ {4}[A-Za-z0-9_.-]+:/.test(line) && !/^ {4}profiles:/.test(line)) {
      inProfiles = false;
    }

    // profiles: ["a", "b"]  |  profiles: [a]  |  profiles:\n      - a
    const inline = /^ {4}profiles:\s*\[(.+)\]\s*$/.exec(line);
    if (inline) {
      out.set(
        current,
        inline[1]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean),
      );
      inProfiles = false;
      continue;
    }
    if (/^ {4}profiles:\s*$/.test(line)) {
      out.set(current, []);
      inProfiles = true;
      continue;
    }
    if (!inProfiles) continue;

    const item = /^ {6}-\s*["']?([A-Za-z0-9._-]+)["']?\s*$/.exec(line);
    if (item) out.get(current).push(item[1]);
    else inProfiles = false;
  }
  return out;
}

const composeServices = parseComposeServices(fs.readFileSync(COMPOSE, 'utf8'));
const services = [...composeServices.keys()];
if (services.length === 0) fail(['docker-compose.yml declares no services — refusing to pass vacuously']);

const launcher = fs.readFileSync(LAUNCHER, 'utf8');
const block = /^SERVICES=\(([\s\S]*?)^\)/m.exec(launcher);
if (!block) fail(['could not find the SERVICES=( ... ) table in run-docker.sh']);

const registered = new Set(
  block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('"'))
    .map((l) => l.slice(1).split('|')[0]),
);
if (registered.size === 0) fail(['parsed the SERVICES table but found no entries — the parser is wrong, not the data']);

const problems = [];
const staleAllow = new Set(Object.keys(ALLOWED_UNREGISTERED));

for (const name of services) {
  const profiles = composeServices.get(name) || [];
  const viaProfile = profiles.some((p) => OPTIONAL_PROFILES.has(p));
  const known = registered.has(name) || viaProfile;

  if (known) {
    // A service that is BOTH reachable and allowlisted means the allowlist has
    // gone stale — someone registered it and left the exemption behind.
    if (staleAllow.has(name)) {
      problems.push(
        `"${name}" is reachable via run-docker.sh AND listed in ALLOWED_UNREGISTERED — drop the stale exemption`,
      );
    }
    staleAllow.delete(name);
    continue;
  }

  if (ALLOWED_UNREGISTERED[name]) {
    staleAllow.delete(name);
    continue;
  }

  problems.push(
    `"${name}" is in docker-compose.yml but unreachable via ./run-docker.sh — ` +
      `add it to the SERVICES table (name|label|port|url), give it an optional-group profile, ` +
      `or add it to ALLOWED_UNREGISTERED with a reason`,
  );
}

for (const name of staleAllow) {
  problems.push(`"${name}" is in ALLOWED_UNREGISTERED but no longer a compose service — remove the entry`);
}

if (problems.length) fail(problems);

console.log(
  `[compose-services] OK — ${services.length} compose services, ` +
    `${registered.size} in SERVICES, ${Object.keys(ALLOWED_UNREGISTERED).length} deliberately unmanaged`,
);
