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

function overlapWithGap(a, b, gap) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap;
}

const isClear = (candidate, others, gap) => !others.some((other) => overlapWithGap(candidate, other, gap));

// Points along a route, at least CORNER_MARGIN from either end of a run, nearest the label's preferred point first.
const CORNER_MARGIN = 16;
const SAMPLE_STEP = 14;
function pointsAlong(pts, preferred) {
  const out = [];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len < 2 * CORNER_MARGIN) { out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); continue; }
    for (let d = CORNER_MARGIN; d <= len - CORNER_MARGIN; d += SAMPLE_STEP) {
      out.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
    }
  }
  return out.sort((p, q) => Math.hypot(p.x - preferred.x, p.y - preferred.y) - Math.hypot(q.x - preferred.x, q.y - preferred.y));
}

// Labels of routed arrows stay ON their own line: each label slides along its route to the nearest spot that clears the boxes
// and the labels already placed. If no spot is clear of the boxes it still stays on the line, clear of the other labels.
// labels: { id, text, emphasized, pts, x, y } with (x, y) the preferred point. Emphasized labels are placed first.
// scale: how much larger than normal the badges are drawn (they grow when the diagram is zoomed out).
export function layoutRoutedLabels(labels, obstacles = [], scale = 1) {
  const placed = [];
  const order = labels.map((label, index) => ({ label, index })).sort((p, q) => Number(Boolean(q.label.emphasized)) - Number(Boolean(p.label.emphasized)) || p.index - q.index);
  const result = [];
  for (const { label, index } of order) {
    const metrics = LABEL_METRICS[label.emphasized ? "emphasized" : "regular"];
    const width = (Math.ceil(label.text.length * metrics.characterWidth) + metrics.horizontalPadding * 2) * scale;
    const height = (metrics.fontHeight + metrics.verticalPadding * 2) * scale;
    const candidates = pointsAlong(label.pts, label).map((p) => ({ ...label, x: p.x, y: p.y, width, height }));
    const chosen = candidates.find((c) => isClear(c, placed, LABEL_GAP / 2) && isClear(c, obstacles, 2))
      || candidates.find((c) => isClear(c, placed, LABEL_GAP / 2)) || candidates[0] || { ...label, width, height };
    placed.push(chosen);
    result.push({ index, chosen });
  }
  return result.sort((p, q) => p.index - q.index).map((r) => r.chosen);
}
