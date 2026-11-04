import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DraggableModal from "../components/DraggableModal";
import InlineSpinner from "../components/shared/InlineSpinner";
import "./CibaApprovalPage.css";

// CIBA email-channel approval page. Opened from the one-time link in the
// approval email (no session — the 256-bit token in the URL is the authority).
// Click-to-confirm: only an explicit Approve/Deny POST records a decision, so
// mail-client prefetch of this page URL is harmless.
//
// Bare chrome (no side nav / agent FAB — see sideNavOwner isNoChromeRoute).

const PAGE_STYLE = { minHeight: "100vh", background: "var(--th-bg-page)" };
const DETAIL_BOX_STYLE = {
  background: "var(--th-bg-inset)",
  borderRadius: 6,
  padding: 12,
  fontSize: 13,
  color: "var(--th-text)",
  margin: "12px 0 0",
};
const BTN_APPROVE = {
  flex: 1, padding: "10px 16px", border: "none", borderRadius: 6,
  background: "#0a7c3f", color: "#fff", fontWeight: 600, cursor: "pointer",
};
const BTN_DENY = {
  flex: 1, padding: "10px 16px", border: "none", borderRadius: 6,
  background: "var(--th-bg-inset)", color: "var(--th-text)", fontWeight: 600, cursor: "pointer",
};
const BTN_RETRY = {
  flex: 1, padding: "10px 16px", border: "1px solid #0a7c3f", borderRadius: 6,
  background: "var(--th-bg-card)", color: "var(--th-status-success-text)", fontWeight: 600, cursor: "pointer",
};
const FOOTER_ROW = { display: "flex", gap: 8, width: "100%" };

export default function CibaEmailApprovePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState("loading"); // loading | waiting | received | invalid | expired | error
  const [details, setDetails] = useState(null);
  const [busy, setBusy] = useState(false);

  const apiBase = process.env.REACT_APP_API_URL || "";

  const load = useCallback(() => {
    if (!token) { setState("invalid"); return; }
    setState("loading");
    fetch(`${apiBase}/api/pf-ai-agent/ciba/email/link/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 410) { setState("expired"); return; }
        if (!res.ok) { setState("error"); return; }
        const data = await res.json();
        setDetails(data);
        setState(data.state === "received" ? "received" : data.state === "waiting" ? "waiting" : data.state === "expired" ? "expired" : "invalid");
      })
      .catch(() => setState("error"));
  }, [token, apiBase]);

  useEffect(() => { load(); }, [load]);

  const decide = async (action) => {
    setBusy(true);
    try {
      const res = await fetch(
        `${apiBase}/api/pf-ai-agent/ciba/email/link/${encodeURIComponent(token)}/decide`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: action }) },
      );
      if (!res.ok) { setState(res.status === 410 ? "expired" : "error"); return; }
      const data = await res.json();
      setDetails(data);
      setState("received");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  };

  const footer =
    state === "waiting" ? (
      <div style={FOOTER_ROW}>
        <button type="button" style={BTN_APPROVE} disabled={busy} onClick={() => decide("approve")}>Approve</button>
        <button type="button" style={BTN_DENY} disabled={busy} onClick={() => decide("deny")}>Deny</button>
      </div>
    ) : state === "error" ? (
      <div style={FOOTER_ROW}>
        <button type="button" style={BTN_RETRY} onClick={load}>Try again</button>
        <button type="button" style={BTN_DENY} onClick={() => window.close()}>Close</button>
      </div>
    ) : undefined;

  return (
    <div style={PAGE_STYLE} data-testid="ciba-email-approve-page">
      <DraggableModal
        isOpen
        onClose={() => { try { window.close(); } catch { /* ignore */ } }}
        title="CIBA Email Approval"
        className="ciba-phone-modal"
        footer={footer}
        closeLabel="Close"
        defaultWidth={340}
        defaultHeight={520}
        minWidth={280}
        minHeight={420}
        storageKey="ciba-email-approve-modal"
        zIndex={100100}
      >
        <div className="dm-scroll">
          {state === "loading" && <div><InlineSpinner label="Loading approval request…" /></div>}
          {state === "waiting" && details && (
            <>
              <div>This emailed link needs your approval.</div>
              {details.bindingMessage && <div style={DETAIL_BOX_STYLE}>{details.bindingMessage}</div>}
            </>
          )}
          {state === "received" && (
            <div>{details?.decision === "approved" ? "✓ Approved." : "Denied."} The page that asked is waiting for this answer; you can close this tab.</div>
          )}
          {state === "expired" && <div>This approval link has expired. Start the request again from the demo.</div>}
          {state === "invalid" && <div>This approval link is not valid (already used or unknown).</div>}
          {state === "error" && <div>Could not load this approval request. Use Try again below.</div>}
        </div>
      </DraggableModal>
    </div>
  );
}
