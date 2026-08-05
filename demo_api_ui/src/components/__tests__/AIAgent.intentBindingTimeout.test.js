import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../AIAgent.js"), "utf8");

describe("UC14b quick result", () => {
  it("allows the multi-hop intent-binding request to exceed the global 10-second timeout", () => {
    expect(source).toMatch(
      /apiClient\.post\("\/api\/demo\/intent-binding\/run",\s*\{[\s\S]*?requestedAmount:\s*80,[\s\S]*?\},\s*\{\s*timeout:\s*30000\s*\}\)/,
    );
  });
});
