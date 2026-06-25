// demo_api_ui/src/components/McpParamToggle.jsx
import React from 'react';

/**
 * Boolean param control for WebMcpPanel.
 *
 * If paramKey === 'freeze': renders Freeze / Unfreeze radio pair.
 * If paramKey === 'confirm': renders a single confirmation checkbox.
 * Otherwise: renders a generic checkbox.
 *
 * Props:
 *   paramKey   {string}    — Tool param name
 *   label      {string}    — Display label
 *   value      {string}    — Current string value ('true'/'false' or '')
 *   onChange   {Function}  — Called with new string value
 *   hint       {string}
 */
export default function McpParamToggle({ paramKey, label, value, onChange, hint }) {
  const labelStyle = { fontSize: 14, color: '#0f2044', marginBottom: 4, lineHeight: 1.5, letterSpacing: '0.01em' };
  const hintStyle = { fontSize: 12, color: '#4a6080', marginTop: 3, lineHeight: 1.6 };

  if (paramKey === 'freeze') {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>{label}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
          {['true', 'false'].map((v) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
              <input
                type="radio"
                name={`toggle-${paramKey}`}
                value={v}
                checked={value === v}
                onChange={() => onChange(v)}
              />
              {v === 'true' ? 'Freeze' : 'Unfreeze'}
            </label>
          ))}
        </div>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
    );
  }

  if (paramKey === 'confirm') {
    return (
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
            style={{ marginTop: 3, flexShrink: 0 }}
          />
          <span style={{ ...labelStyle, marginBottom: 0 }}>
            I confirm permanent deletion of this customer and all their data
          </span>
        </label>
        {hint && <div style={hintStyle}>{hint}</div>}
      </div>
    );
  }

  // Generic boolean
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span style={labelStyle}>{label}</span>
      </label>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}
