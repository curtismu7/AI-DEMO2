import { describe, expect, it } from "vitest";
import { layoutEdgeLabels } from "../topologyEdgeLabelLayout";

describe("topology edge label layout", () => {
  it("moves labels clear of their routes and separates labels sharing the same anchor", () => {
    const labels = [
      { id: "first", text: "HTTPS / JSON API", x: 240, y: 120 },
      { id: "second", text: "OAuth token exchange", x: 240, y: 120 },
      { id: "third", text: "MCP request", x: 240, y: 120 },
    ];

    const laidOut = layoutEdgeLabels(labels);

    expect(laidOut).toHaveLength(labels.length);
    expect(laidOut.every(({ y }, index) => y !== labels[index].y)).toBe(true);
    for (let i = 0; i < laidOut.length; i += 1) {
      for (let j = i + 1; j < laidOut.length; j += 1) {
        const horizontalGap = Math.abs(laidOut[i].x - laidOut[j].x)
          - (laidOut[i].width + laidOut[j].width) / 2;
        const verticalGap = Math.abs(laidOut[i].y - laidOut[j].y)
          - (laidOut[i].height + laidOut[j].height) / 2;
        expect(horizontalGap >= 8 || verticalGap >= 8).toBe(true);
      }
    }
  });

  it("keeps labels with clear horizontal separation on the nearest lane", () => {
    const laidOut = layoutEdgeLabels([
      { id: "left", text: "HTTPS :443", x: 120, y: 80 },
      { id: "right", text: "Authorize request", x: 520, y: 80 },
    ]);

    expect(laidOut.map(({ y }) => y)).toEqual([61, 61]);
  });
});
