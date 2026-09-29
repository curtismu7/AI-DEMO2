const FONT_HEIGHT = 10;
const CHARACTER_WIDTH = 6;
const HORIZONTAL_PADDING = 9;
const VERTICAL_PADDING = 6;
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
  const labelHeight = FONT_HEIGHT + VERTICAL_PADDING * 2;
  const firstLaneOffset = labelHeight / 2 + ROUTE_GAP;
  const laneSpacing = labelHeight + LABEL_GAP;

  return labels.map((label) => {
    const width = Math.ceil(label.text.length * CHARACTER_WIDTH) + HORIZONTAL_PADDING * 2;
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
        height: labelHeight,
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
