// demo_api_ui/src/components/McpParamSelect.jsx
import React from 'react';

/**
 * Dropdown param control for WebMcpPanel.
 *
 * Props:
 *   paramKey   {string}            — Tool param name (e.g. "account_id")
 *   label      {string}            — Display label
 *   options    {Array<{value, label}>} — Selectable options
 *   value      {string}            — Current value (controlled)
 *   onChange   {Function}          — Called with new string value
 *   required   {boolean}
 *   hint       {string}
 */
export default function McpParamSelect({ paramKey, label, options, value, onChange, required, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
      <span style={{ fontSize: 14, color: '#0f2044', marginBottom: 4, lineHeight: 1.5, letterSpacing: '0.01em' }}>
        {label}
        {required && !value && (
          <span style={{
            marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px',
            borderRadius: 9, border: '1px solid #fbbf24', background: '#fef3c7',
            color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>required</span>
        )}
      </span>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '8px 12px', border: '1px solid #c0ccd8', borderRadius: 6,
          background: '#f4f7fb', color: '#0f2044', fontSize: 14,
          lineHeight: 1.5, letterSpacing: '0.01em', cursor: 'pointer',
        }}
        aria-label={label}
      >
        <option value="">— select —</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && (
        <span style={{ fontSize: 12, color: '#4a6080', marginTop: 3, lineHeight: 1.6 }}>{hint}</span>
      )}
    </label>
  );
}
