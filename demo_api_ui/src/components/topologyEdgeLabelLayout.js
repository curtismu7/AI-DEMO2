const LABEL_METRICS = {
  regular: { fontHeight: 10, characterWidth: 6, horizontalPadding: 9, verticalPadding: 6 },
  emphasized: { fontHeight: 16, characterWidth: 9.6, horizontalPadding: 16, verticalPadding: 10 },
};
const LABEL_GAP = 8;
const ROUTE_GAP = 8;

function boxesOverlap(a, b) {
  const horizontalDistance = Math.abs(a.x - b.x);
  const verticalDistance = Math.abs(a.y - b.y);
  return horizontalDistance < (a.width + b.width) / 2 + LABEL_GAP
    && verticalDistance < (a.height + b.height) / 2 + LABEL_GAP;
}

export function layoutEdgeLabels(labels, obstacles = []) {
  const placed = [];

  return labels.map((label) => {
    const metrics = LABEL_METRICS[label.emphasized ? "emphasized" : "regular"];
    const width = Math.ceil(label.text.length * metrics.characterWidth) + metrics.horizontalPadding * 2;
    const height = metrics.fontHeight + metrics.verticalPadding * 2;
    const firstLaneOffset = height / 2 + ROUTE_GAP;
    const laneSpacing = height + LABEL_GAP;
    let lane = 0;
    let candidate;

    do {
      const distance = firstLaneOffset + Math.floor(lane / 2) * laneSpacing;
      const direction = lane % 2 === 0 ? -1 : 1;
      candidate = {
        ...label,
        x: label.x,
        y: label.y + direction * distance,
        width,
        height,
      };
      lane += 1;
    } while (
      placed.some((other) => boxesOverlap(candidate, other))
      || obstacles.some((obstacle) => boxesOverlap(candidate, obstacle))
    );

    placed.push(candidate);
    return candidate;
  });
}
