import { resolveStatusVisual } from "../TokenChainDisplay";

describe("resolveStatusVisual — intent-binding event statuses", () => {
  test("'active' (intent-binding-verified) resolves to the active/success bucket", () => {
    expect(resolveStatusVisual("active").bucket).toBe("active");
  });

  test("'error' (gateway deny) resolves to the failed bucket", () => {
    expect(resolveStatusVisual("error").bucket).toBe("failed");
  });
});
