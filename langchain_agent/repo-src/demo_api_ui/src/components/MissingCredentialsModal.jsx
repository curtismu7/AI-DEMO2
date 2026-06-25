// banking_api_ui/src/components/MissingCredentialsModal.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import DraggableModal from "./DraggableModal";
import "./MissingCredentialsModal.css";

const FIELD_META = {
  client_id: {
    label: "Client ID",
    type: "text",
    hint: "PingOne → Applications → your app → Overview → Client ID",
  },
  client_secret: {
    label: "Client Secret",
    type: "password",
    hint: "PingOne → Applications → your app → Overview → Client Secret",
  },
  environment_id: {
    label: "Environment ID",
    type: "text",
    hint: "PingOne → Settings → Environment → Properties → Environment ID",
  },
  worker_app_id: {
    label: "Worker App ID",
    type: "text",
    hint: "PingOne → Applications → Worker app → Client ID",
  },
  worker_app_secret: {
    label: "Worker App Secret",
    type: "password",
    hint: "PingOne → Applications → Worker app → Client Secret",
  },
  token_endpoint: {
    label: "Token Endpoint",
    type: "text",
    hint: "e.g. https://auth.pingone.com/{envId}/as/token",
  },
  authorize_endpoint: {
    label: "Authorize Endpoint",
    type: "text",
    hint: "e.g. https://auth.pingone.com/{envId}/as/authorize",
  },
};

const GUIDANCE = {
  worker_token: {
    title: "How to create a Worker Application in PingOne",
    steps: [
      "Go to PingOne Admin Console → Applications",
      'Click "+ Add Application" → select "Worker"',
      'Name it (e.g. "Demo Worker")',
      'On the Roles tab, assign "Environment Admin" role for your environment',
      "Copy the Client ID and Client Secret from the Overview tab",
    ],
  },
  oauth_client: {
    title: "How to create an OAuth Application in PingOne",
    steps: [
      "Go to PingOne Admin Console → Applications",
      'Click "+ Add Application" → select "OIDC Web App"',
      "Set the redirect URI to your callback URL",
      "Enable required grant types (Authorization Code, Client Credentials)",
      "Copy the Client ID and Client Secret",
    ],
  },
  customer_oauth: {
    title: "Configure the Customer OAuth Application",
    steps: [
      "Go to PingOne Admin Console → Applications → find your end-user app",
      'Ensure Grant Types include "Authorization Code" and optionally "Client Credentials"',
      "Set Redirect URIs to include your app's callback URL",
      "Copy Client ID and Client Secret below",
    ],
  },
};

/**
 * MissingCredentialsModal — prompts for missing OAuth/worker credentials
 * with PingOne setup guidance.
 */
export default function MissingCredentialsModal({
  isOpen,
  missingFields = [],
  credentialType,
  message,
  onSubmit,
  onCancel,
}) {
  const [formData, setFormData] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const firstInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      const initial = {};
      missingFields.forEach((f) => {
        initial[f] = "";
      });
      setFormData(initial);
      setFieldErrors({});
      setSubmitError(null);
      setSubmitting(false);
    }
  }, [isOpen, missingFields]);

  useEffect(() => {
    if (isOpen && firstInputRef.current) {
      setTimeout(() => firstInputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  const handleChange = useCallback(
    (field, value) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (fieldErrors[field]) {
        setFieldErrors((prev) => {
          const n = { ...prev };
          delete n[field];
          return n;
        });
      }
    },
    [fieldErrors],
  );

  const validate = useCallback(() => {
    const errors = {};
    missingFields.forEach((f) => {
      if (!formData[f]?.trim()) errors[f] = "Required";
    });
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [missingFields, formData]);

  const handleSubmit = useCallback(
    async (e) => {
      e?.preventDefault();
      if (!validate()) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await onSubmit?.(formData);
      } catch (err) {
        setSubmitError(
          err?.message || "Failed to save credentials. Please try again.",
        );
        setSubmitting(false);
      }
    },
    [validate, onSubmit, formData],
  );

  if (!isOpen || !missingFields.length) return null;

  const guidance = GUIDANCE[credentialType];

  return (
    <DraggableModal
      isOpen
      onClose={onCancel}
      title="Missing Credentials"
      defaultWidth={520}
      defaultHeight={560}
      storageKey="missing-credentials-modal"
      minWidth={340}
      minHeight={300}
      backdropClose
      footer={
        <>
          <button
            className="mcm-btn mcm-btn-cancel"
            onClick={onCancel}
            disabled={submitting}
            type="button"
          >
            Cancel
          </button>
          <button
            className="mcm-btn mcm-btn-submit"
            onClick={handleSubmit}
            disabled={submitting}
            type="button"
          >
            {submitting ? "Saving…" : "Save Credentials"}
          </button>
        </>
      }
    >
      <div className="dm-scroll">
        {message && <p className="mcm-description">{message}</p>}

        {guidance && (
          <div className="mcm-guidance">
            <div className="mcm-guidance-title">{guidance.title}</div>
            <ol>
              {guidance.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        )}

        {submitError && <div className="mcm-error-banner">{submitError}</div>}

        <form className="mcm-body" onSubmit={handleSubmit}>
          {missingFields.map((field, idx) => {
            const meta = FIELD_META[field] || {
              label: field,
              type: "text",
              hint: "",
            };
            return (
              <div className="mcm-field" key={field}>
                <label htmlFor={`mcm-${field}`}>{meta.label}</label>
                {meta.hint && <div className="mcm-hint">{meta.hint}</div>}
                <input
                  id={`mcm-${field}`}
                  ref={idx === 0 ? firstInputRef : undefined}
                  type={meta.type}
                  autoComplete="off"
                  value={formData[field] || ""}
                  onChange={(e) => handleChange(field, e.target.value)}
                  className={fieldErrors[field] ? "mcm-input-error" : ""}
                  disabled={submitting}
                />
                {fieldErrors[field] && (
                  <div className="mcm-field-error">{fieldErrors[field]}</div>
                )}
              </div>
            );
          })}
        </form>
      </div>
    </DraggableModal>
  );
}
