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
 * Parses YAML directly rather than shelling out to `docker compose config`:
 * that needs the gitignored .env files and a running Docker, and CI has
 * neither.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

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
    'deploy-live.sh:222 documents this — run-docker.sh does not manage llm-proxy; rebuild it directly with docker compose up -d --build llm-proxy',
  'tier-manager-k8':
    'k8s-only tier manager; the Docker stack drives tiers through llm-proxy, so it is never started by the launcher',
  'ungoverned-agent':
    'deliberately-ungoverned demo agent, run ad hoc for the attack narrative rather than as part of any stack',
  'mcp-brave':
    'optional third-party Brave MCP server; needs an API key and is started by hand when demoing it',
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

const compose = YAML.parse(fs.readFileSync(COMPOSE, 'utf8'));
const services = compose && compose.services ? Object.keys(compose.services) : [];
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
  const profiles = compose.services[name].profiles || [];
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
