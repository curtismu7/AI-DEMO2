import { copyFile, mkdir } from "node:fs/promises";
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
  await Promise.all(exportFiles.map((filename) => copyFile(resolve(sourceDir, filename), resolve(publicDir, filename))));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncTopologyExports();
}
