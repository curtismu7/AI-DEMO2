// banking_api_ui/src/components/ApiKeyPathPage.jsx
// Phase 266 Plan 04: Path A info page — API-key credential disposition.
//
// Renders content fetched from /api/path/apikey-info. Path A is Gateway-terminating
// (the Gateway swaps the user's OAuth bearer for a service API key and stops there;
// no banking backend is called). This BFF info-marker route is the canonical source.
//
// REGRESSION §0: no emoji glyphs anywhere in this file.
// Token custody: full API key never reaches browser; only last-4 chars (apiKeyMaskedLast4) rendered.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import bffAxios from "../services/bffAxios";
import "./ApiKeyPathPage.css";

export default function ApiKeyPathPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    bffAxios
      .get("/api/path/apikey-info")
      .then((r) => {
        if (alive) setData(r.data);
      })
      .catch((e) => {
        if (alive) setError(e?.response?.data?.error || "fetch_failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="akp-container">
        <div className="akp-error">
          Unable to load API-key path info: {error}
        </div>
        <button className="akp-back-btn" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="akp-container">
        <div className="akp-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="akp-container">
      <div className="akp-header">
        <span className="akp-badge">API-KEY PATH</span>
        <h1 className="akp-title">Gateway used the API-key credential path</h1>
      </div>
      <div className="akp-body">
        <p className="akp-message">{data.message}</p>
        <div className="akp-key-row">
          <span className="akp-key-label">
            Service API key (last 4 chars only):
          </span>
          <code className="akp-key-value">
            ****{data.apiKeyMaskedLast4 || "XXXX"}
          </code>
        </div>
        <p className="akp-note">
          No banking data is returned on this path. The Gateway exchanged your
          OAuth bearer for a service API key and stopped there. See the Token
          Chain panel for the credential swap details.
        </p>
      </div>
      <div className="akp-actions">
        <button className="akp-back-btn" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
