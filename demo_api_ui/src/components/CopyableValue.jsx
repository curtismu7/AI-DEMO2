// demo_api_ui/src/components/CopyableValue.jsx
import React, { useState, useCallback, useEffect } from 'react';
import { useMcpField } from '../context/McpFieldContext';
import './CopyableValue.css';

/**
 * A labelled field display with a fused copy button.
 * Reads/writes from McpFieldContext via fieldKey.
 *
 * Props:
 *   label        {string}   — Field label text
 *   fieldKey     {string}   — Key in McpFieldContext (use MCP_FIELD_KEYS constants)
 *   required     {boolean}  — Show amber "required" badge when empty
 *   readOnly     {boolean}  — True for derived/auto-filled fields
 *   defaultValue {string}   — Seed value written into context on mount if field is empty
 *   defaultSource{string}   — Source label for chip when defaultValue is used
 *   placeholder  {string}   — Placeholder text for empty editable fields
 *   hint         {string}   — Small help text rendered below the field
 *   monospace    {boolean}  — Use mono font for UUID/URL values
 *   onChange     {Function} — Called with new value when user types (editable fields only)
 */
export default function CopyableValue({
  label,
  fieldKey,
  required = false,
  readOnly = false,
  defaultValue,
  defaultSource,
  placeholder,
  hint,
  monospace = false,
  onChange,
}) {
  const { value, source, setValue } = useMcpField(fieldKey);
  const [copied, setCopied] = useState(false);

  // Seed defaultValue into context on mount if field is empty
  useEffect(() => {
    if (defaultValue !== undefined && defaultValue !== '' && value === '') {
      setValue(defaultValue, defaultSource || 'auto-filled');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue]);

  const handleChange = useCallback(
    (e) => {
      setValue(e.target.value, null);
      if (onChange) onChange(e.target.value);
    },
    [setValue, onChange]
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // clipboard write failed — no visual change, button stays idle
      });
  }, [value]);

  // Determine visual state.
  // isAutofill drives STYLING only (green border/tint).
  // Whether the input is actually read-only is controlled by the readOnly prop alone.
  const isEmpty = !value;
  const isAutofillStyle = !isEmpty && (source === 'auto-filled' || readOnly);
  const fieldStateClass = isEmpty
    ? 'copyable-value-field--required'
    : isAutofillStyle
    ? 'copyable-value-field--autofill'
    : 'copyable-value-field--filled';

  // Determine chip
  let chip = null;
  if (isEmpty && required) {
    chip = <span className="copyable-value-chip--required">required</span>;
  } else if (!isEmpty && source === 'auto-filled') {
    chip = <span className="copyable-value-chip--autofill">auto-filled</span>;
  } else if (!isEmpty && source) {
    chip = <span className="copyable-value-chip--source">From {source}</span>;
  }

  return (
    <div className="copyable-value-wrapper">
      <div className="copyable-value-label-row">
        <span className="copyable-value-label">{label}</span>
        {chip}
      </div>

      <div className={`copyable-value-field ${fieldStateClass}`}>
        <input
          type="text"
          className={`copyable-value-input${monospace ? ' copyable-value-input--mono' : ''}`}
          value={value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : handleChange}
          placeholder={isEmpty ? (placeholder || '') : ''}
          aria-label={label}
        />
        {!isEmpty && (
          <button
            type="button"
            className="copyable-value-copy-btn"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
          >
            {copied ? '✅ Copied' : '⎘ Copy'}
          </button>
        )}
      </div>

      {hint && <div className="copyable-value-hint">{hint}</div>}
    </div>
  );
}
