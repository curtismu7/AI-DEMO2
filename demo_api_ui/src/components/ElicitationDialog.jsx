import React, { useState } from 'react';
import './ElicitationDialog.css';

/**
 * ElicitationDialog — MCP Client Elicitation UI
 * Renders either a form (form mode) or URL consent dialog (URL mode)
 * based on the server's elicitation request.
 */
export default function ElicitationDialog({ elicitation, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!elicitation) return null;

  const { mode, message, requestedSchema, url } = elicitation;

  // Form mode handler
  if (mode === 'form') {
    const properties = requestedSchema?.properties || {};
    const required = requestedSchema?.required || [];

    const handleInputChange = (key, value) => {
      setFormData(prev => ({ ...prev, [key]: value }));
      // Clear error for this field when user starts typing
      if (errors[key]) {
        setErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors[key];
          return newErrors;
        });
      }
    };

    const validateForm = () => {
      const newErrors = {};
      required.forEach(key => {
        if (!formData[key]) {
          newErrors[key] = `${key} is required`;
        }
      });
      // Type/range validation for every PRESENT numeric field (not just required
      // ones). A field the user never touched stays absent from formData, so an
      // optional field left untouched is not forced. But once touched — including
      // cleared back to empty — it must hold a finite number within min/max, so a
      // non-required field can never submit a NaN/empty value (which JSON-encodes
      // to null) to the BFF.
      Object.entries(properties).forEach(([key, schema]) => {
        if (schema.type !== 'number' && schema.type !== 'integer') return;
        if (!Object.prototype.hasOwnProperty.call(formData, key)) return;
        const value = formData[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          if (!newErrors[key]) newErrors[key] = `${key} must be a valid number`;
        } else if (schema.minimum !== undefined && value < schema.minimum) {
          newErrors[key] = `${key} must be at least ${schema.minimum}`;
        } else if (schema.maximum !== undefined && value > schema.maximum) {
          newErrors[key] = `${key} must be at most ${schema.maximum}`;
        }
      });
      return newErrors;
    };

    const handleSubmit = async (action) => {
      if (action === 'accept') {
        const validationErrors = validateForm();
        if (Object.keys(validationErrors).length > 0) {
          setErrors(validationErrors);
          return;
        }
      }

      setIsSubmitting(true);
      try {
        await onSubmit({
          action,
          content: action === 'accept' ? formData : undefined
        });
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <div className="elicit-modal-overlay">
        <div className="elicit-modal">
          <div className="elicit-modal__header">
            <h2 className="elicit-modal__title">Additional Information Needed</h2>
            <button
              className="elicit-modal__close"
              onClick={() => handleSubmit('cancel')}
              disabled={isSubmitting}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="elicit-modal__body">
            {message && <p className="elicit-modal__message">{message}</p>}

            <form className="elicit-form" onSubmit={(e) => { e.preventDefault(); handleSubmit('accept'); }}>
              {Object.entries(properties).map(([key, schema]) => (
                <div key={key} className="elicit-form__group">
                  <label htmlFor={`elicit-${key}`} className="elicit-form__label">
                    {schema.description || key}
                    {required.includes(key) && <span className="elicit-form__required">*</span>}
                  </label>

                  {schema.type === 'string' && schema.enum ? (
                    // Single-select enum
                    <select
                      id={`elicit-${key}`}
                      className={`elicit-form__select ${errors[key] ? 'elicit-form__select--error' : ''}`}
                      value={formData[key] || ''}
                      onChange={(e) => handleInputChange(key, e.target.value)}
                      required={required.includes(key)}
                    >
                      <option value="">Select {schema.description || key}…</option>
                      {schema.enum.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  ) : schema.type === 'boolean' ? (
                    // Checkbox
                    <input
                      id={`elicit-${key}`}
                      type="checkbox"
                      className="elicit-form__checkbox"
                      checked={formData[key] || false}
                      onChange={(e) => handleInputChange(key, e.target.checked)}
                    />
                  ) : schema.type === 'number' || schema.type === 'integer' ? (
                    // Number input
                    <input
                      id={`elicit-${key}`}
                      type="number"
                      className={`elicit-form__input ${errors[key] ? 'elicit-form__input--error' : ''}`}
                      value={formData[key] || ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const parsed = schema.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
                        // Never let NaN (empty/invalid input) land in formData —
                        // it JSON-encodes to null on submit. Keep the raw string so
                        // validateForm can flag it and the field renders as typed.
                        handleInputChange(key, Number.isNaN(parsed) ? raw : parsed);
                      }}
                      placeholder={schema.description || key}
                      required={required.includes(key)}
                      min={schema.minimum}
                      max={schema.maximum}
                    />
                  ) : (
                    // Text input (default)
                    <input
                      id={`elicit-${key}`}
                      type={schema.format === 'email' ? 'email' : schema.format === 'uri' ? 'url' : 'text'}
                      className={`elicit-form__input ${errors[key] ? 'elicit-form__input--error' : ''}`}
                      value={formData[key] || ''}
                      onChange={(e) => handleInputChange(key, e.target.value)}
                      placeholder={schema.description || key}
                      required={required.includes(key)}
                      minLength={schema.minLength}
                      maxLength={schema.maxLength}
                      pattern={schema.pattern}
                    />
                  )}

                  {errors[key] && <div className="elicit-form__error">{errors[key]}</div>}
                </div>
              ))}
            </form>
          </div>

          <div className="elicit-modal__footer">
            <button
              className="elicit-btn elicit-btn--secondary"
              onClick={() => handleSubmit('decline')}
              disabled={isSubmitting}
            >
              Decline
            </button>
            <button
              className="elicit-btn elicit-btn--primary"
              onClick={() => handleSubmit('accept')}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // URL mode handler
  if (mode === 'url') {
    return (
      <div className="elicit-modal-overlay">
        <div className="elicit-modal">
          <div className="elicit-modal__header">
            <h2 className="elicit-modal__title">Authorization Required</h2>
            <button
              className="elicit-modal__close"
              onClick={() => onSubmit({ action: 'cancel' })}
              disabled={isSubmitting}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="elicit-modal__body">
            {message && <p className="elicit-modal__message">{message}</p>}

            <div className="elicit-url-box">
              <p className="elicit-url-label">You will be taken to:</p>
              <div className="elicit-url-display">{url}</div>
              <p className="elicit-url-warning">
                ⚠️ Please verify this is the correct domain before opening.
              </p>
            </div>
          </div>

          <div className="elicit-modal__footer">
            <button
              className="elicit-btn elicit-btn--secondary"
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  await onSubmit({ action: 'decline' });
                } finally {
                  setIsSubmitting(false);
                }
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className="elicit-btn elicit-btn--primary"
              onClick={async () => {
                setIsSubmitting(true);
                try {
                  // Send accept response to BFF
                  await onSubmit({ action: 'accept' });
                  // Open URL with noopener,noreferrer so the untrusted MCP-supplied
                  // page cannot reach back through window.opener and navigate this tab.
                  window.open(url, '_blank', 'noopener,noreferrer');
                } finally {
                  setIsSubmitting(false);
                }
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Opening…' : 'Open in Browser'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
