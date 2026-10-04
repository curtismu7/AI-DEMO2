import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { syncTopologyExports } from "../../../scripts/sync-topology-exports.mjs";

describe("server topology static exports", () => {
  it("copies the checked-in Lucidchart diagram and companion inventory to public download paths", async () => {
    await syncTopologyExports();

    const [lucidSource, lucidDownload, detailsSource, detailsDownload] = await Promise.all([
      readFile(resolve(process.cwd(), "../docs/exports/server-topology-lucidchart.csv"), "utf8"),
      readFile(resolve(process.cwd(), "public/exports/server-topology-lucidchart.csv"), "utf8"),
      readFile(resolve(process.cwd(), "../docs/exports/server-topology-details.csv"), "utf8"),
      readFile(resolve(process.cwd(), "public/exports/server-topology-details.csv"), "utf8"),
    ]);

    expect(lucidDownload).toBe(lucidSource);
    expect(detailsDownload).toBe(detailsSource);
  });

  it("keeps a newer download instead of replacing it from an older source", async () => {
    const sourceDir = await mkdtemp(resolve(tmpdir(), "topology-src-"));
    const publicDir = await mkdtemp(resolve(tmpdir(), "topology-pub-"));
    const files = ["server-topology-lucidchart.csv", "server-topology-details.csv"];
    const past = new Date(Date.now() - 60_000);
    for (const name of files) {
      await writeFile(resolve(sourceDir, name), "baked into an old image");
      await utimes(resolve(sourceDir, name), past, past);
      await writeFile(resolve(publicDir, name), "current checkout");
    }

    await syncTopologyExports({ sourceDir, publicDir });
    expect(await readFile(resolve(publicDir, files[0]), "utf8")).toBe("current checkout");

    // A source that changed after the download was written still replaces it.
    const future = new Date(Date.now() + 60_000);
    await writeFile(resolve(sourceDir, files[0]), "regenerated");
    await utimes(resolve(sourceDir, files[0]), future, future);
    await syncTopologyExports({ sourceDir, publicDir });
    expect(await readFile(resolve(publicDir, files[0]), "utf8")).toBe("regenerated");
  });
});
