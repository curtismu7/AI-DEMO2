import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

// UC22's separate-device CIBA approval page. Opened in a new tab by
// AIAgent.js when a CIBA request starts, sharing the same session cookie —
// NOT a QR-code/device-flow page (CIBA's spec has no such concept; see
// docs/superpowers/specs/2026-07-20-uc22-ciba-separate-device-approval-design.md).
const WRAP_STYLE = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f4f4f5",
  font: '14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
};

const CARD_STYLE = {
  width: 320,
  background: "#fff",
  borderRadius: 8,
  boxShadow: "0 2px 16px rgba(0,0,0,.18)",
  overflow: "hidden",
};

const HEADER_STYLE = {
  background: "#022a52",
  padding: "16px 20px",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
};

const BODY_STYLE = { padding: 20 };

const DETAIL_BOX_STYLE = {
  background: "#f8f8f8",
  borderRadius: 6,
  padding: 12,
  fontSize: 13,
  color: "#1a1a1a",
  margin: "12px 0",
};

const BUTTON_ROW_STYLE = { display: "flex", gap: 8, marginTop: 16 };

const APPROVE_BUTTON_STYLE = {
  flex: 1,
  padding: "10px 0",
  border: "none",
  borderRadius: 6,
  background: "#0a7c3f",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

const DENY_BUTTON_STYLE = {
  flex: 1,
  padding: "10px 0",
  border: "none",
  borderRadius: 6,
  background: "#eee",
  color: "#333",
  fontWeight: 600,
  cursor: "pointer",
};

export default function CibaApprovalPage() {
  const [searchParams] = useSearchParams();
  const authReqId = searchParams.get("authReqId");
  const [status, setStatus] = useState("loading"); // loading | pending | expired | error | approved | denied
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);

  const apiBase = process.env.REACT_APP_API_URL || "";

  useEffect(() => {
    if (!authReqId) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    fetch(`${apiBase}/api/auth/ciba/request/${authReqId}`, {
      credentials: "include",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 410) {
          setStatus("expired");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const data = await res.json();
        setDetails(data);
        setStatus("pending");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [authReqId, apiBase]);

  const decide = async (action) => {
    setBusy(true);
    try {
      const endpoint =
        action === "approve"
          ? `${apiBase}/api/auth/ciba/approve-now/${authReqId}`
          : `${apiBase}/api/auth/ciba/deny/${authReqId}`;
      const res = await fetch(endpoint, { method: "POST", credentials: "include" });
      if (res.ok) {
        setStatus(action === "approve" ? "approved" : "denied");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={WRAP_STYLE}>
      <div style={CARD_STYLE}>
        <div style={HEADER_STYLE}>PingOne Identity Verification</div>
        <div style={BODY_STYLE}>
          {status === "loading" && <div>Loading approval request…</div>}

          {status === "expired" && (
            <div>This approval request has expired. Please try again.</div>
          )}

          {status === "error" && (
            <div>Could not load this approval request. Please try again.</div>
          )}

          {status === "pending" && details && (
            <>
              <div>A sign-in attempt needs your approval.</div>
              <div style={DETAIL_BOX_STYLE}>
                {details.amount != null ? (
                  <>
                    Transfer: ${Number(details.amount).toFixed(2)}
                    <br />
                    {details.from_account_label || "Account"} →{" "}
                    {details.to_account_label || "Account"}
                  </>
                ) : (
                  details.binding_message || "Approve this request"
                )}
              </div>
              <div style={BUTTON_ROW_STYLE}>
                <button
                  type="button"
                  style={APPROVE_BUTTON_STYLE}
                  disabled={busy}
                  onClick={() => decide("approve")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  style={DENY_BUTTON_STYLE}
                  disabled={busy}
                  onClick={() => decide("deny")}
                >
                  Deny
                </button>
              </div>
            </>
          )}

          {status === "approved" && <div>✓ Approved. You can close this tab.</div>}
          {status === "denied" && <div>Denied. You can close this tab.</div>}
        </div>
      </div>
    </div>
  );
}
