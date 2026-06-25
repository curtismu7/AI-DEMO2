/**
 * DiagramLegend — passive colour-swatch legend row.
 *
 * Renders a list of colour-swatch + label pairs.
 * No click handlers. Use PathFilterBar when interactivity is needed.
 *
 * Props:
 *   items     — [{ key, label, color, description? }]
 *   activeKey — string|null — highlights matching item, dims others
 *   layout    — 'row' | 'column' — default 'row'
 */
import { memo } from "react";
import "./DiagramControls.css";

function DiagramLegend({ items = [], activeKey = null, layout = "row" }) {
  const hasActive = activeKey !== null && activeKey !== undefined;

  return (
    <div className={`dl-legend${layout === "column" ? " dl-legend--column" : ""}`}>
      {items.map(({ key, label, color, description }) => {
        const isDimmed = hasActive && key !== activeKey;
        return (
          <span
            key={key}
            className={`dl-item${isDimmed ? " dl-item--dimmed" : ""}`}
            title={description || undefined}
          >
            <span className="dl-swatch" style={{ background: color }} />
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default memo(DiagramLegend);
