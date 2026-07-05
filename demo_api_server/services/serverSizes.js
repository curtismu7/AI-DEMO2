'use strict';

/**
 * Size data for the /servers page — Docker image size, live container memory,
 * and codebase size per inventory entry. Backs GET /api/health/inventory/sizes.
 *
 * Docker data comes from the Engine API over the mounted /var/run/docker.sock,
 * following services/agentGatewayConfig/dockerRestart.js (raw http over
 * socketPath — no docker CLI, no new dependency). Read-only GETs only.
 * Codebase sizes walk each entry's sourceDir under the bind-mounted repo root
 * (/repo in docker, resolved from the module path in native runs).
 *
 * Every field is nullable: a missing socket, stopped container, or null
 * sourceDir yields null for that field — never a throw.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { SERVER_INVENTORY } = require('../data/serverInventory');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const REPO_ROOT = fs.existsSync('/repo/scope-topology.json')
  ? '/repo'
  : path.resolve(__dirname, '..', '..');

const CACHE_TTL_MS = 10 * 60 * 1000; // image list + codebase walks change slowly
const SKIP_DIRS = new Set([
  'node_modules', '.venv', 'venv', 'dist', 'build', '.git', 'coverage',
  '__pycache__', 'logs', '.next', 'test-results',
]);

function dockerGet(apiPath, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: DOCKER_SOCKET, path: apiPath, method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/** Recursively sum file sizes under dir, skipping SKIP_DIRS and symlinks. */
async function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return total; }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) total += await api.dirSize(full);
    } else if (ent.isFile()) {
      try { total += (await fs.promises.stat(full)).size; } catch { /* raced delete */ }
    }
  }
  return total;
}

// Indirection point so tests can mock the socket and the disk walk.
const api = { dockerGet, dirSize };

let imageCache = { at: 0, value: null };   // { [containerName]: imageBytes }
let codeCache = { at: 0, value: null };    // { [sourceDir]: codeBytes }

function _resetCaches() {
  imageCache = { at: 0, value: null };
  codeCache = { at: 0, value: null };
}

/** containerName → image size in bytes, for all containers Docker knows about. */
async function imageSizesByContainer() {
  if (imageCache.value && Date.now() - imageCache.at < CACHE_TTL_MS) return imageCache.value;
  const [containers, images] = await Promise.all([
    api.dockerGet('/containers/json?all=true'),
    api.dockerGet('/images/json'),
  ]);
  if (!Array.isArray(containers) || !Array.isArray(images)) return imageCache.value || {};
  const sizeByImageId = Object.fromEntries(images.map((i) => [i.Id, i.Size]));
  const map = {};
  for (const c of containers) {
    const size = sizeByImageId[c.ImageID];
    if (size == null) continue;
    for (const n of c.Names || []) map[n.replace(/^\//, '')] = size;
  }
  imageCache = { at: Date.now(), value: map };
  return map;
}

/** Live memory for one container — usage minus page cache, like `docker stats`. */
async function memoryStats(containerName) {
  const stats = await api.dockerGet(
    `/containers/${encodeURIComponent(containerName)}/stats?stream=false&one-shot=true`
  );
  const mem = stats && stats.memory_stats;
  if (!mem || typeof mem.usage !== 'number') return { memBytes: null, memLimitBytes: null };
  const inactive = (mem.stats && (mem.stats.inactive_file ?? mem.stats.total_inactive_file)) || 0;
  return {
    memBytes: Math.max(0, mem.usage - inactive),
    memLimitBytes: typeof mem.limit === 'number' ? mem.limit : null,
  };
}

/** sourceDir → bytes on disk, cached. */
async function codeSizes() {
  if (codeCache.value && Date.now() - codeCache.at < CACHE_TTL_MS) return codeCache.value;
  const dirs = [...new Set(SERVER_INVENTORY.map((e) => e.sourceDir).filter(Boolean))];
  const map = {};
  await Promise.all(dirs.map(async (d) => { map[d] = await api.dirSize(path.join(REPO_ROOT, d)); }));
  codeCache = { at: Date.now(), value: map };
  return map;
}

/**
 * Sizes for every inventory entry:
 * { sizes: { [key]: { imageBytes, memBytes, memLimitBytes, codeBytes } }, timestamp }
 */
async function getServerSizes() {
  const socketOk = (() => { try { return fs.existsSync(DOCKER_SOCKET); } catch { return false; } })();

  const [imageMap, codeMap] = await Promise.all([
    socketOk ? imageSizesByContainer() : Promise.resolve({}),
    codeSizes(),
  ]);

  const sizes = {};
  await Promise.all(
    SERVER_INVENTORY.map(async (entry) => {
      const container = entry.container;
      const mem = socketOk && container && imageMap[container] != null
        ? await memoryStats(container)
        : { memBytes: null, memLimitBytes: null };
      sizes[entry.key] = {
        imageBytes: (container && imageMap[container]) ?? null,
        ...mem,
        codeBytes: (entry.sourceDir && codeMap[entry.sourceDir]) ?? null,
      };
    })
  );

  return { sizes, timestamp: new Date().toISOString() };
}

module.exports = { getServerSizes, _api: api, _resetCaches };
