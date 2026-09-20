import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createInventoryStore({ filePath, retentionMs = 24 * 60 * 60 * 1000 }) {
  let cache = { scanId: null, scannedAt: null, records: [], diagnostics: [] };

  async function load() {
    try {
      cache = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      cache = { scanId: null, scannedAt: null, records: [], diagnostics: [] };
    }
    return cache;
  }

  async function persist() {
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}`;
    await writeFile(tempPath, JSON.stringify(cache, null, 2));
    await rename(tempPath, filePath);
  }

  return {
    async list() { return (await load()).records; },
    async get(id) { return (await load()).records.find((record) => record.id === id) || null; },
    async snapshot() { return await load(); },
    async replaceScan({ scanId, records, diagnostics }) {
      const previous = await load();
      const now = Date.now();
      const currentIds = new Set(records.map((record) => record.id));
      const retained = previous.records.filter((record) => !currentIds.has(record.id) && now - Date.parse(record.lastSeenAt || 0) < retentionMs);
      cache = { scanId, scannedAt: new Date().toISOString(), records: [...records, ...retained], diagnostics: diagnostics || [] };
      await persist();
      return cache;
    },
  };
}
