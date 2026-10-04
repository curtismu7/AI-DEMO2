// The Server Topology page's two downloads are generated from the data the
// page draws. This fails when docs/exports is stale; regenerate with
//   UPDATE_TOPOLOGY_EXPORTS=1 npx vitest run src/components/serverTopologyExports.test.js
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildTopologyDetailsCsv, buildTopologyLucidchartCsv, readAssessmentNotes } from "./serverTopologyExports";
import { SERVER_EDGES, SERVER_MAP } from "./serverTopologyData";

const exportsDir = resolve(__dirname, "../../../docs/exports");
const detailsPath = resolve(exportsDir, "server-topology-details.csv");
const lucidPath = resolve(exportsDir, "server-topology-lucidchart.csv");
const update = process.env.UPDATE_TOPOLOGY_EXPORTS === "1";

test("the details export matches the topology data", () => {
  const current = readFileSync(detailsPath, "utf8");
  // Assessment notes are written by hand in the file; everything else is generated.
  const generated = buildTopologyDetailsCsv(readAssessmentNotes(current));
  if (update) writeFileSync(detailsPath, generated);
  else expect(current).toBe(generated);
});

test("the Lucidchart export matches the topology data", () => {
  const generated = buildTopologyLucidchartCsv();
  if (update) writeFileSync(lucidPath, generated);
  else expect(readFileSync(lucidPath, "utf8")).toBe(generated);
});

test("every server and connection has a row, and hand-written notes survive", () => {
  const notes = { bff: 'Has a "quoted" note, with a comma' };
  const csv = buildTopologyDetailsCsv(notes);
  expect(csv.trimEnd().split("\n").filter((line) => /^(Server|Connection),/.test(line))).toHaveLength(SERVER_MAP.length + SERVER_EDGES.length);
  expect(readAssessmentNotes(csv)).toEqual(notes);
});
