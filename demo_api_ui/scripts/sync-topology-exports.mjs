import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(packageRoot, "../docs/exports");
const publicDirectory = resolve(packageRoot, "public/exports");
const exportFiles = [
  "server-topology-lucidchart.csv",
  "server-topology-details.csv",
];

export async function syncTopologyExports({ sourceDir = sourceDirectory, publicDir = publicDirectory } = {}) {
  await mkdir(publicDir, { recursive: true });
  await Promise.all(exportFiles.map(async (filename) => {
    const source = resolve(sourceDir, filename);
    const target = resolve(publicDir, filename);
    // The Docker UI container bind-mounts public/ from the checkout but reads
    // docs/exports from a copy baked into its image. After a merge that copy
    // is older than the checkout's, and copying it would put the stale
    // download back on every container start. Never replace a newer file.
    // ponytail: compares modification times, not content; a clock-skewed
    // build host could keep an old download until the next sync on the host.
    const [from, to] = await Promise.all([stat(source), stat(target).catch(() => null)]);
    if (to && to.mtimeMs > from.mtimeMs) return;
    await copyFile(source, target);
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncTopologyExports();
}
