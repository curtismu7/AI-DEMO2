import { describe, expect, it } from "vitest";
import { sequenceDiagramLabel } from "../sequenceDiagramLabels";

describe("sequence diagram vertical labels", () => {
  it("uses the active vertical name for banking agent labels", () => {
    expect(sequenceDiagramLabel("BANKING AGENT", "United Airlines")).toBe("UNITED AIRLINES AGENT");
    expect(sequenceDiagramLabel("Banking Agent receives request", "United Airlines")).toBe(
      "United Airlines Agent receives request",
    );
  });

  it("uses a neutral agent label while the vertical name is unavailable", () => {
    expect(sequenceDiagramLabel("Banking Agent receives request", "")).toBe(
      "AI Agent receives request",
    );
  });
});
