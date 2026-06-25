// demo_api_ui/src/components/McpParamText.jsx
import React from 'react';

/**
 * Text param control for WebMcpPanel (default text input).
 *
 * Props:
 *   paramKey   {string}    — Tool param name
 *   label      {string}    — Display label
 *   value      {string}    — Current value
 *   onChange   {Function}  — Called with new string value
 *   placeholder {string}   — Input placeholder
 *   hint       {string}    — Optional description
 *   required   {boolean}   — Whether this param is required
 *   inputType  {string}    — HTML input type (e.g. "text", "date", "number"). Default "text".
 *   step       {string}    — HTML step attribute (for number inputs)
 */
export default function McpParamText({ paramKey, label, value, onChange, placeholder, hint, required, inputType = 'text', step }) {
  const labelStyle = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#1a1a2e',
    marginBottom: 4,
    lineHeight: 1.5,
    letterSpacing: '0.01em',
  };

  const hintStyle = {
    fontSize: 11,
    color: '#4a6080',
    lineHeight: 1.6,
    marginBottom: 4,
  };

  const inputStyle = {
    marginTop: 4,
    padding: '8px 12px',
    border: '1px solid #c0ccd8',
    borderRadius: 4,
    background: '#f4f7fb',
    color: '#0f2044',
    fontSize: 14,
    lineHeight: 1.5,
    letterSpacing: '0.01em',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={`param-${paramKey}`} style={labelStyle}>
        {label}
        {required && (
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 9,
              border: '1px solid #fbbf24',
              background: '#fef3c7',
              color: '#92400e',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            required
          </span>
        )}
      </label>
      {hint && <div style={hintStyle}>{hint}</div>}
      <input
        id={`param-${paramKey}`}
        type={inputType}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
        onFocus={(e) => {
          e.target.style.borderColor = '#3b82f6';
          e.target.style.background = '#fff';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = '#c0ccd8';
          e.target.style.background = '#f4f7fb';
        }}
      />
    </div>
  );
}
