/**
 * StepTimeSelector — shared per-step timing (dwell) dropdown.
 *
 * Owns the `.dc-steptime*` markup so both DiagramControls and
 * ArchitectureSimControls render the identical control instead of each
 * re-implementing it against the internal CSS class names.
 *
 * Renders nothing when `options` is empty/missing.
 */
import { memo } from "react";
import "./StepTimeSelector.css";

function StepTimeSelector({
  value,
  options,
  onChange,
  disabled = false,
  title = "Time each step takes during playback",
}) {
  if (!Array.isArray(options) || options.length === 0) return null;

  return (
    <label className="dc-steptime" title={title}>
      <span className="dc-steptime-label">Step time:</span>
      <select
        className="dc-steptime-select"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default memo(StepTimeSelector);
