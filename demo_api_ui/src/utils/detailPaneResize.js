export const DETAIL_PANE_MIN_HEIGHT = 180;
export const DETAIL_PANE_MAX_VIEWPORT_RATIO = 0.75;

export function clampDetailPaneHeight(height, viewportHeight) {
  const maxHeight = Math.max(
    DETAIL_PANE_MIN_HEIGHT,
    Math.round(viewportHeight * DETAIL_PANE_MAX_VIEWPORT_RATIO),
  );
  return Math.min(maxHeight, Math.max(DETAIL_PANE_MIN_HEIGHT, Math.round(height)));
}
