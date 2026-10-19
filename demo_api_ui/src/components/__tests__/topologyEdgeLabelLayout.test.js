import { describe, expect, it } from "vitest";
import { layoutEdgeLabels, layoutRoutedLabels } from "../topologyEdgeLabelLayout";

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

  it("reserves more space for emphasized incoming and outgoing labels", () => {
    const [regular] = layoutEdgeLabels([
      { id: "regular", text: "IN · HTTPS / JSON API", x: 200, y: 100 },
    ]);
    const [emphasized] = layoutEdgeLabels([
      { id: "emphasized", text: "IN · HTTPS / JSON API", x: 200, y: 100, emphasized: true },
    ]);

    expect(emphasized.width).toBeGreaterThan(regular.width);
    expect(emphasized.height).toBeGreaterThan(regular.height);
  });

  it("moves labels outside server card rectangles", () => {
    const obstacle = { id: "bff", x: 300, y: 200, width: 218, height: 104 };
    const [label] = layoutEdgeLabels(
      [{ id: "bff-agent", text: "Agent request", x: 300, y: 200 }],
      [obstacle],
    );
    const horizontalDistance = Math.abs(label.x - obstacle.x);
    const verticalDistance = Math.abs(label.y - obstacle.y);

    expect(
      horizontalDistance >= (label.width + obstacle.width) / 2 + 8
      || verticalDistance >= (label.height + obstacle.height) / 2 + 8,
    ).toBe(true);
  });
});

describe("routed label layout", () => {
  const pts = [{ x: 0, y: 100 }, { x: 14, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 600 }, { x: 586, y: 600 }, { x: 600, y: 600 }];
  const onRoute = (l) => (l.y === 100 && l.x >= 14 && l.x <= 300) || (l.x === 300 && l.y >= 100 && l.y <= 600) || (l.y === 600 && l.x >= 300 && l.x <= 586);

  it("keeps every label on its own route, even when a box and another label are in the way", () => {
    const labels = [
      { id: "a", text: "01", pts, x: 300, y: 350 },
      { id: "b", text: "02", pts, x: 300, y: 350 },
    ];
    const box = { x: 300, y: 350, width: 100, height: 100 };
    const out = layoutRoutedLabels(labels, [box]);
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
    out.forEach((l) => expect(onRoute(l)).toBe(true));
    expect(Math.abs(out[0].x - out[1].x) >= out[0].width || Math.abs(out[0].y - out[1].y) >= out[0].height).toBe(true);
  });

  it("slides along the line to clear a box instead of leaving the line", () => {
    const out = layoutRoutedLabels([{ id: "a", text: "01", pts, x: 300, y: 350 }], [{ x: 300, y: 350, width: 80, height: 120 }]);
    expect(onRoute(out[0])).toBe(true);
    expect(Math.abs(out[0].y - 350) > 60 || out[0].x !== 300).toBe(true);
  });
});
