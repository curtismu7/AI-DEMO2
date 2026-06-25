/**
 * PathFilterBar — interactive path filter buttons.
 *
 * Generalised from Phase266ArchitecturePage.jsx inline PathFilterBar.
 * Renders one button per path plus an "All" button.
 * The active-state border colour matches the path's swatch colour inline;
 * CSS opacity dimming on SVG nodes is controlled by the consuming page.
 *
 * Props:
 *   paths        — [{ key, label, color }] — null key = "All" button
 *   selectedPath — string|null — currently active path key
 *   onSelect     — func — called with key (null = All)
 *   className    — string — extra class on wrapper div
 */
import { memo } from "react";
import "./DiagramControls.css";

function PathFilterBar({ paths = [], selectedPath, onSelect, className }) {
  return (
    <div className={`pfb-bar${className ? ` ${className}` : ""}`}>
      {paths.map(({ key, label, color }) => {
        const isActive = selectedPath === key;
        const activeStyle =
          isActive && key !== null && color
            ? { background: `${color}22`, borderColor: color, color }
            : undefined;

        return (
          <button
            key={String(key)}
            type="button"
            className="pfb-btn"
            data-active={isActive ? "true" : undefined}
            style={activeStyle}
            onClick={() => onSelect(key)}
            aria-pressed={isActive}
          >
            {color && key !== null && (
              <span className="pfb-swatch" style={{ background: color }} />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default memo(PathFilterBar);
