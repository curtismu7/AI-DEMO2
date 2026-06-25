// demo_api_ui/src/components/McpParamSuggest.jsx
import React from 'react';

/**
 * Free-text input with clickable suggestion chips below.
 *
 * Props:
 *   paramKey    {string}         — Tool param name
 *   label       {string}         — Display label
 *   suggestions {string[]}       — Chip labels; clicking sets value
 *   value       {string}         — Current value (controlled)
 *   onChange    {Function}       — Called with new string value
 *   placeholder {string}
 *   hint        {string}
 */
export default function McpParamSuggest({ paramKey, label, suggestions, value, onChange, placeholder, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
      <span style={{ fontSize: 14, color: '#0f2044', marginBottom: 4, lineHeight: 1.5, letterSpacing: '0.01em' }}>
        {label}
      </span>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        style={{
          padding: '8px 12px', border: '1px solid #c0ccd8', borderRadius: 6,
          background: '#f4f7fb', color: '#0f2044', fontSize: 14,
          lineHeight: 1.5, letterSpacing: '0.01em',
        }}
        aria-label={label}
      />
      {suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              style={{
                padding: '2px 10px', border: '1px solid #d0d9e8', borderRadius: 12,
                background: '#f4f7fb', color: '#0f2044', fontSize: 12, cursor: 'pointer',
                lineHeight: 1.5,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {hint && (
        <span style={{ fontSize: 12, color: '#4a6080', marginTop: 3, lineHeight: 1.6 }}>{hint}</span>
      )}
    </label>
  );
}
