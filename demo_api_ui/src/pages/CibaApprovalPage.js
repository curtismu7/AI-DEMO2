import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DraggableModal from "../components/DraggableModal";

// UC22's separate-device CIBA approval page. Opened in a new tab by
// AIAgent.js when a CIBA request starts, sharing the same session cookie —
// NOT a QR-code/device-flow page (CIBA's spec has no such concept; see
// docs/superpowers/specs/2026-07-20-uc22-ciba-separate-device-approval-design.md).
//
// Bare chrome (no App side nav / agent FAB — see sideNavOwner isNoChromeRoute).
// The card is a DraggableModal: drag title bar, resize edges, ✕ closes the tab.

const PAGE_STYLE = {
  minHeight: "100vh",
  background: "#f4f4f5",
};

const DETAIL_BOX_STYLE = {
  background: "#f8f8f8",
  borderRadius: 6,
  padding: 12,
  fontSize: 13,
  color: "#1a1a1a",
  margin: "12px 0 0",
};

const FOOTER_BTN_APPROVE = {
  flex: 1,
  padding: "10px 16px",
  border: "none",
  borderRadius: 6,
  background: "#0a7c3f",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

const FOOTER_BTN_DENY = {
  flex: 1,
  padding: "10px 16px",
  border: "none",
  borderRadius: 6,
  background: "#eee",
  color: "#333",
  fontWeight: 600,
  cursor: "pointer",
};

const FOOTER_ROW = { display: "flex", gap: 8, width: "100%" };

/** Close this popup tab when possible (opened via window.open from the agent). */
function closeApprovalTab() {
  try {
    window.close();
  } catch {
    // ignore — some browsers block close of non-script-opened windows
  }
}

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

  const footer =
    status === "pending" && details ? (
      <div style={FOOTER_ROW}>
        <button
          type="button"
          style={FOOTER_BTN_APPROVE}
          disabled={busy}
          onClick={() => decide("approve")}
        >
          Approve
        </button>
        <button
          type="button"
          style={FOOTER_BTN_DENY}
          disabled={busy}
          onClick={() => decide("deny")}
        >
          Deny
        </button>
      </div>
    ) : undefined;

  return (
    <div style={PAGE_STYLE} data-testid="ciba-approve-page">
      <DraggableModal
        isOpen
        onClose={closeApprovalTab}
        title="PingOne Identity Verification"
        footer={footer}
        closeLabel="Close"
        defaultWidth={360}
        defaultHeight={320}
        minWidth={280}
        minHeight={220}
        storageKey="ciba-approve-modal"
        zIndex={100100}
      >
        <div className="dm-scroll">
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
            </>
          )}

          {status === "approved" && <div>✓ Approved. You can close this tab.</div>}
          {status === "denied" && <div>Denied. You can close this tab.</div>}
        </div>
      </DraggableModal>
    </div>
  );
}
