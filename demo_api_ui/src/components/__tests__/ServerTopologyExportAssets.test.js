import { readFile } from "node:fs/promises";
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
});
