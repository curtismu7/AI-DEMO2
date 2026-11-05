import React from 'react';

/**
 * A "pick one of these" control for alternative parameters (e.g. Location by City / Coordinates /
 * Saved location). Real radio inputs, so arrow keys and screen readers work; the segmented look is CSS.
 */
export default function ParamChoice({ group, active, onChange }) {
  const option = group.options.find((o) => o.id === active);
  const name = `insp-choice-${group.id}`;
  return (
    <fieldset className="insp-choice">
      <legend>{group.label}</legend>
      <div className="insp-choice-opts">
        {group.options.map((o) => (
          <label key={o.id} className="insp-choice-opt">
            <input type="radio" name={name} value={o.id} checked={o.id === active} onChange={() => onChange(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {option?.hint && <p className="insp-hint">{option.hint}</p>}
    </fieldset>
  );
}
