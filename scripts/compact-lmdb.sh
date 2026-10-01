#!/usr/bin/env bash
# compact-lmdb.sh — runbook for the 2026-09-22 "silent session loss" incident.
#
# At the LMDB mapSize ceiling (data.mdb file size ≈ mapSize), every write
# path 500s and the express-session store silently loses saves — the symptom
# shows up far away, e.g. an admin login loop. data.mdb NEVER shrinks on its
# own: deleting expired rows only frees pages to the freelist. The fix is a
# copy into a fresh environment.
#
# Symptoms this fixes:
#   - "[lmdb] data.mdb ... of 128MB mapSize (>=100%)" in BFF logs
#   - GET /api/health/demo-status shows lmdb.healthy=false or >=90%
#   - Sessions vanish between requests (cookie-stub fallback in the UI)
#
# Usage:
#   ./compact-lmdb.sh                 # compact via docker (stack volume)
#   LMDB_PATH=./demo_api_server/data/persistent/lmdb ./compact-lmdb.sh --host
#
# Safe to run while the stack is STOPPED. With the stack RUNNING, copies are
# consistent for readers but the running process holds the old env — restart
# ai-demo-api-server afterwards (script does this when it stopped it).
set -euo pipefail

VOLUME="ai-demo_ai-demo-bff-data"
CONTAINER="ai-demo-api-server"
IN_VOLUME_DIR="/data/persistent/lmdb"

HOST_MODE=0
[[ "${1:-}" == "--host" ]] && HOST_MODE=1

timestamp() { date +%Y%m%d-%H%M%S; }

if [[ $HOST_MODE == 1 ]]; then
  LMDB_DIR="${LMDB_PATH:-$(dirname "$0")/../demo_api_server/data/persistent/lmdb}"
  echo "[*] Host mode — compacting $LMDB_DIR (stop the BFF first!)"
  node - "$LMDB_DIR" <<'EOF'
const path = require('path');
const lmdb = require(path.join(process.cwd(), 'demo_api_server/node_modules/lmdb'));
const srcDir = process.argv[2];
const dstDir = srcDir + '.compacted-' + Date.now();
const fs = require('fs');
fs.mkdirSync(dstDir, { recursive: true });
const env = lmdb.open({ path: srcDir, maxDbs: 40, mapSize: 1024 * 1024 * 1024 });
const names = [...new Set([...(env.dbNames || []), 'sessions', 'conversations', 'navConfigs', 'config'])];
(async () => {
  for (const name of names) {
    if (!name) continue;
    const sdb = env.openDB(name, { encoding: 'json' });
    const ddb = lmdb.open({ path: dstDir, maxDbs: 40, mapSize: 256 * 1024 * 1024 }).openDB(name, { encoding: 'json' });
    const entries = [];
    for (const { key, value } of sdb.getRange()) entries.push([key, value]);
    await ddb.transaction(() => { for (const [k, v] of entries) ddb.put(k, v); }).done;
    console.log(name, entries.length, 'entries');
  }
  console.log('DONE ->', dstDir);
  process.exit(0);
})();
EOF
  echo "[+] Compacted copy written. Swap it in manually (stop BFF, mv old aside, mv new in, chown)."
  exit 0
fi

# ── Docker mode (default) ──────────────────────────────────────────────────
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  echo "✕ Volume $VOLUME not found — is the stack running under a different project name?" >&2
  exit 1
fi

# Resolve the BFF's own image (even if stopped below, `docker inspect` still
# answers for a non-removed container) rather than a generic node:22-alpine:
# alpine's musl libc can't load the native lmdb binding that was installed for
# the HOST's platform in a bind-mounted node_modules — the app image already
# carries a build of lmdb that actually works on its own runtime.
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "✕ Container $CONTAINER not found — is the stack running?" >&2
  exit 1
fi
IMAGE="$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')"

WAS_RUNNING=0
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  WAS_RUNNING=1
  echo "[*] Stopping $CONTAINER (LMDB cannot be compacted safely while the writer holds the env)"
  docker stop "$CONTAINER" >/dev/null
fi

STAMP="$(timestamp)"
echo "[*] Rebuilding $VOLUME:$IN_VOLUME_DIR into a compacted copy"

# 1. Copy live data out, entry-by-entry into a fresh env (drop freelist).
# --user root: the app image runs as USER appuser (uid 1001) by default, which
# cannot mkdir inside this one-off container's own /data mount even though the
# same uid owns the real files at runtime (hit live 2026-10-01, right after
# fixing the node:22-alpine platform mismatch below). Root sidesteps it; step 2
# already chowns the compacted data.mdb to 1001:1001 before swap-in regardless.
docker run --rm --user root -v "$VOLUME":/data --entrypoint node "$IMAGE" -e "
const lmdb = require('/app/node_modules/lmdb');
const fs = require('fs');
const src = lmdb.open({ path: '/data/persistent/lmdb', maxDbs: 40, mapSize: 1024*1024*1024 });
const dstPath = '/data/persistent/lmdb-compacted-$STAMP';
fs.mkdirSync(dstPath, { recursive: true });
const dst = lmdb.open({ path: dstPath, maxDbs: 40, mapSize: 256*1024*1024 });
const names = ['agentLifecycleEvents','autonomousRuns','cimd','config','conversations','davinciEvents','delegated_commerce_registrations','delegations','demo_scenarios','demo_track','hostedRegistrations','mcpAudit','mcp_oauth_config','mcp_profiles','navConfigs','oauth_clients','personal_agent_cimd','pingoneEvents','privilegeDoors','privilegeGatewaySessions','report_shares','reports','sdk_demo_tokens','security_monitoring','sessions','transactionLedger','verticals','banking_accounts','banking_transactions'];
(async () => {
  for (const name of names) {
    const sdb = src.openDB(name, { encoding: 'json' });
    const ddb = dst.openDB(name, { encoding: 'json' });
    const entries = [];
    for (const { key, value } of sdb.getRange()) entries.push([key, value]);
    await dst.batch(() => { for (const [k, v] of entries) ddb.put(k, v); }).done;
    console.log(name, entries.length);
  }
  await dst.flushed;
  console.log('COPY DONE');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"

# 2. Swap: old aside, compacted in, prune expired sessions on the way.
docker run --rm -v "$VOLUME":/data alpine sh -c "
  cd /data/persistent/lmdb
  mv data.mdb data.mdb.bak-$STAMP
  mv lock.mdb lock.mdb.bak-$STAMP 2>/dev/null || true
  mv ../lmdb-compacted-$STAMP/data.mdb ./data.mdb
  rm -f lock.mdb
  chown 1001:1001 data.mdb
  echo '[*] Swapped. Sizes:'
  ls -la data.mdb data.mdb.bak-$STAMP
"

if [[ $WAS_RUNNING == 1 ]]; then
  echo "[*] Restarting $CONTAINER"
  docker start "$CONTAINER" >/dev/null
fi

echo
echo "✅ Compacted. Verify:"
echo "   curl -sk https://local.ping-devops.com:4000/api/health/demo-status | python3 -m json.tool | grep -A5 lmdb"
echo "   Delete data.mdb.bak-$STAMP from the volume once login is confirmed working."
