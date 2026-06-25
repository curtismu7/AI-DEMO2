// banking_api_ui/src/components/AccessIdTokenPathPage.jsx
// Phase 266 Plan 04 R2: Path B info page — dual-token (access + id_token) disposition.
//
// R2 architecture: this page consumes /api/resource-server/identity DIRECTLY via bffAxios.
// banking_resource_server decodes the access token and id_token server-side (per CLAUDE.md
// token custody rule — raw JWTs never reach the browser) and returns sanitized claims only,
// protected by the existing authenticateToken middleware (server.js:846).
//
// Error handling:
//   401 — session expired / no valid bearer in session
//   412 (error: 'id_token_missing') — session has no id_token (sign-in without openid scope)
//
// REGRESSION §0: no emoji glyphs anywhere in this file.
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import bffAxios from "../services/bffAxios";
import "./AccessIdTokenPathPage.css";

function ClaimsList({ title, claims }) {
  if (!claims || Object.keys(claims).length === 0) {
    return (
      <div className="aitp-claims-col">
        <h3 className="aitp-claims-title">{title}</h3>
        <div className="aitp-claims-empty">No claims available</div>
      </div>
    );
  }
  return (
    <div className="aitp-claims-col">
      <h3 className="aitp-claims-title">{title}</h3>
      <dl className="aitp-claims-list">
        {Object.entries(claims).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="aitp-claim-key">{k}</dt>
            <dd className="aitp-claim-value">
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

export default function AccessIdTokenPathPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [errorStatus, setErrorStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    // R2: consume the real banking_resource_server route directly.
    // Route: GET /api/resource-server/identity (Plan 02 Task 2)
    // Returns: { credentialPath, badge, color, accessTokenClaims, idTokenClaims, message, returnTo, returnLabel }
    bffAxios
      .get("/api/resource-server/identity")
      .then((r) => {
        if (alive) setData(r.data);
      })
      .catch((e) => {
        if (!alive) return;
        setErrorStatus(e?.response?.status || null);
        setError(e?.response?.data?.error || "fetch_failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    // Surface the two clean failure modes from /api/resource-server/identity:
    //   401 — session expired / no bearer (T-266-04-05)
    //   412 — session has no id_token, login flow lacked openid scope (T-266-04-07)
    let userMessage;
    if (errorStatus === 412 || error === "id_token_missing") {
      userMessage =
        "Your session does not include an id_token. Please sign in again to request the openid scope.";
    } else if (errorStatus === 401) {
      userMessage = "Your session has expired. Please sign in again.";
    } else {
      userMessage = `Unable to load access + id-token path info: ${error}`;
    }
    return (
      <div className="aitp-container">
        <div className="aitp-error">{userMessage}</div>
        <button
          className="aitp-back-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="aitp-container">
        <div className="aitp-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="aitp-container">
      <div className="aitp-header">
        <span className="aitp-badge">ACCESS + ID-TOKEN PATH</span>
        <h1 className="aitp-title">
          banking_resource_server decoded your access token and id_token
        </h1>
      </div>
      <div className="aitp-body">
        <p className="aitp-message">{data.message}</p>
        <div className="aitp-claims-grid">
          <ClaimsList
            title="Access Token Claims"
            claims={data.accessTokenClaims}
          />
          <ClaimsList title="ID Token Claims" claims={data.idTokenClaims} />
        </div>
      </div>
      <div className="aitp-actions">
        <button
          className="aitp-back-btn"
          onClick={() => navigate("/dashboard")}
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
