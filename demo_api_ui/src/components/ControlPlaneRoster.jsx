import { useCallback, useEffect, useRef, useState } from "react";
import { useThemeOptional } from "../context/ThemeContext";
import { useAppEventsSSE } from "../hooks/useAppEventsSSE";
import { useAuth } from "../hooks/useAuth";
import apiClient from "../services/apiClient";
import { comprehensiveShutdown, getAgents } from "../services/controlPlaneApi";
import ControlPlaneDemoGuideModal from "./ControlPlaneDemoGuideModal";
import "./ControlPlaneRoster.css";
import InlineSpinner from './shared/InlineSpinner';

const nowStamp = () => new Date().toLocaleTimeString();

// Agent Kill Switch roster. Any logged-in user. The only row is the real
// agent with real PingOne revocation — no simulated platform identities.
export default function ControlPlaneRoster({ openKillSwitchModal }) {
  const { user, logout } = useAuth();
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [showGuide, setShowGuide] = useState(false);
  const [live, setLive] = useState(null);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await getAgents();
      if (!mounted.current) return;
      setLive(data.live);
    } catch (_) { /* leave empty; surface nothing intrusive */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  // Push: control-plane stops notify every open session (no-op for the live
  // row — its status changes only via the real kill, which destroys the
  // session anyway).
  useAppEventsSSE(() => {}, { category: "control_plane" });

  // Comprehensive shutdown: full-scope kill of the live agent + PingOne SSO
  // session termination, one click. The server destroys the session and
  // answers 401 agent_killed; comprehensiveShutdown resolves with the step
  // report. Show it before the session-death redirect takes over — same
  // trick as the kill-switch modal's end state.
  const onComprehensiveShutdown = async () => {
    if (busy) return;
    setBusy(true);
    setProgress("Running comprehensive shutdown...");
    try {
      const result = await comprehensiveShutdown();
      const ran = (result?.steps || []).filter((s) => s.ran).length;
      setProgress(`Comprehensive shutdown: ${ran} enforcement step(s) ran. Signing out…`);
      // `_noAuthBanner` suppressed the global 401 handling, so nothing signs
      // the user out implicitly — do it explicitly now that the report showed.
      setTimeout(() => logout(), 2500);
    } catch (_) {
      setProgress("Comprehensive shutdown request failed — check the roster and audit trail.");
      setBusy(false);
    }
  };

  // Live row: real kill via the existing unchanged endpoint. Destroys the
  // session (logout) on the server; the apiClient 401 handling takes over.
  // Returns the kill result (scope + step breakdown) so the confirm modal can
  // show what ran vs. what was skipped before it closes. Throws on any
  // failure that ISN'T the expected agent_killed 401 (network error, axios
  // timeout on a slow full-scope kill, ...) so the modal can show that
  // failure instead of silently vanishing with no explanation.
  const confirmLiveKill = async (agentId, reason, scope) => {
    let res;
    try {
      res = await apiClient.post(`/api/admin/agent/${agentId}/kill-switch`, { reason, scope });
    } catch (err) {
      // 401 agent_killed is the expected success response — the body still carries scope/steps
      if (err?.response?.data?.error === "agent_killed") {
        setLive((l) => (l ? { ...l, status: "revoked" } : l));
        return err.response.data;
      }
      throw new Error(err?.response?.data?.message || err?.message || "Kill-switch request failed");
    }
    setLive((l) => (l ? { ...l, status: "revoked" } : l));
    return res?.data || null;
  };

  // Opens the shared, App.js-owned kill-switch modal (see App.js for why —
  // this page's own route unmounts on the same session-death this action
  // causes, so a locally-owned modal instance could never survive to show
  // its result).
  const openLiveKillModal = (scope) => {
    openKillSwitchModal({
      agentId: live ? live.id : "demo-agent",
      initialScope: scope,
      onConfirm: confirmLiveKill,
      onDismiss: () => {},
    });
  };

  // Inverse of confirmLiveKill: re-enables the PingOne agent application(s)
  // the kill switch disabled, so testing the red button doesn't require
  // manual PingOne console access to recover.
  const confirmLiveRevive = async (agentId) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/admin/agent/${agentId}/re-enable`);
      setLive((l) => (l ? { ...l, status: "active" } : l));
    } catch (_) { /* surfaced via the normal apiClient error toast */ }
    setBusy(false);
  };

  return (
    <div className="cp-wrap">
      <button
        type="button"
        onClick={toggleDarkMode}
        className="cp-theme-toggle"
        title="Switch this page between light and dark"
        aria-pressed={darkMode}
      >
        {darkMode ? "☀️ Light mode" : "🌙 Dark mode"}
      </button>

      <div className="cp-head">
        <div className="cp-title">
          Ping &mdash; Agent Kill Switch
          <small>ONE PLACE TO GOVERN AI ACROSS EVERY PLATFORM</small>
        </div>
        {user?.role === "admin" && (
          <button
            type="button"
            className="cp-demo-guide-btn"
            onClick={() => setShowGuide(true)}
          >
            📚 Demo Guide
          </button>
        )}
        <div className="cp-verbs">
          <div className="cp-verb">govern</div>
          <div className="cp-verb">authorize</div>
          <div className="cp-verb">audit</div>
          <div className="cp-verb">shut down</div>
        </div>
      </div>

      <div className="cp-intro">
        <b>What this is:</b> an AI agent gets its identity and tokens from Ping &mdash; so Ping is where its
        authority is revoked. When an agent misbehaves or is compromised, the control plane below revokes that
        identity: every platform the agent touches loses trust in it at once. Only <b>real</b> identities appear
        here &mdash; every row has a live PingOne identity behind it, and every stop is a real revocation.
      </div>

      <div className="cp-how">
        <div className="cp-step"><div className="n">1</div><h4>Agents authenticate through Ping</h4>
          <p>Each agent &mdash; whatever vendor or LLM runs it &mdash; gets its identity and tokens from Ping.</p>
          <span className="tag">identity layer</span></div>
        <div className="cp-step"><div className="n">2</div><h4>Every action needs that token</h4>
          <p>An agent can only act by presenting a Ping-issued token (RFC 8693 exchange). No valid token, no action.</p>
          <span className="tag">authority, not compute</span></div>
        <div className="cp-step"><div className="n">3</div><h4>Revoke at Ping, access dies everywhere</h4>
          <p>Stop = revoke the token + disable the app + write an immutable audit record. Works on Helix, llama.cpp, or Claude alike.</p>
          <span className="tag">one button, every platform</span></div>
      </div>

      <div className="cp-rows">
        {live ? (
          (() => {
            const revoked = live.status === "revoked";
            const cls = ["cp-row", "live", revoked ? "dead" : ""].join(" ").trim();
            const sub = `LIVE - real PingOne revocation${live.providerLabel ? ` - ${live.providerLabel}` : ""}`;
            return (
              <div className={cls}>
                <div className="rdot" />
                <div className="cp-name">{live.label}<span>{sub}</span></div>
                <div className="cp-pill">{revoked ? `REVOKED ${nowStamp()}` : "LIVE"}</div>
                {!revoked && (
                  <button
                    type="button"
                    className="cp-stop cp-stop--live"
                    disabled={busy}
                    onClick={() => openLiveKillModal("instance")}
                  >Stop this instance</button>
                )}
                {!revoked && (
                  <button
                    type="button"
                    className="cp-stop cp-stop--live-full"
                    disabled={busy}
                    title="Disables the agent's PingOne application — blocks new tokens for every user of this agent client."
                    onClick={() => openLiveKillModal("full")}
                  >Stop entire agent</button>
                )}
                {revoked && (
                  <button
                    type="button"
                    className="cp-stop cp-stop--revive"
                    disabled={busy}
                    onClick={() => confirmLiveRevive(live.id)}
                  >Re-enable</button>
                )}
              </div>
            );
          })()
        ) : (
          <div className="cp-row"><div className="cp-name"><InlineSpinner label="Loading roster…" /></div></div>
        )}
      </div>

      <div className="cp-actions">
        <button
          type="button"
          className="cp-btn stopall cp-btn--comprehensive"
          disabled={busy || !live || live.status === "revoked"}
          title="Full-scope kill (tokens + user + agent app at PingOne) plus PingOne SSO session termination — in one action."
          onClick={onComprehensiveShutdown}
        >Comprehensive shutdown</button>
        <span className="cp-progress">{progress}</span>
      </div>

      <div className="cp-why">
        <div className="wt">Why this matters &mdash; the business value</div>
        <div className="grid">
          <div className="cp-val"><div className="vi">&#9201;</div><h4>Contain in seconds, everywhere</h4>
            <p>A compromised or misbehaving agent is stopped across every platform at once &mdash; not chased down vendor-by-vendor.</p>
            <span className="who">Security / SOC</span></div>
          <div className="cp-val"><div className="vi">&#129513;</div><h4>One control plane, not N integrations</h4>
            <p>Govern AI from a single place instead of custom-building controls inside every AI tool you adopt.</p>
            <span className="who">CISO / Platform</span></div>
          <div className="cp-val"><div className="vi">&#128220;</div><h4>Provable, cross-platform audit</h4>
            <p>Every stop writes an immutable record &mdash; one trail for regulators and incident review.</p>
            <span className="who">Risk / Compliance</span></div>
          <div className="cp-val"><div className="vi">&#9822;</div><h4>Own the trusted control point</h4>
            <p>Ping becomes the policy &amp; identity plane the AI ecosystem integrates with &mdash; the strategic position, not just a kill switch.</p>
            <span className="who">Strategy / Exec</span></div>
        </div>
      </div>

      {user?.role === "admin" && (
        <ControlPlaneDemoGuideModal
          isOpen={showGuide}
          onClose={() => setShowGuide(false)}
        />
      )}
    </div>
  );
}
