import React, { useEffect, useRef, useState, useCallback } from "react";
import apiClient from "../services/apiClient";
import { getAgents, stopAgent, resetRoster } from "../services/controlPlaneApi";
import { useAppEventsSSE } from "../hooks/useAppEventsSSE";
import KillSwitchConfirmModal from "./KillSwitchConfirmModal";
import "./ControlPlaneRoster.css";

const STAGGER_MS = 640;
const REVOKE_MS = 520;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowStamp = () => new Date().toLocaleTimeString();

// AI Control Plane roster. Any logged-in user. The live row is the real agent
// (real PingOne revocation via the existing kill-switch endpoint); the other
// rows are Ping-governed demo identities stopped via the control-plane API.
export default function ControlPlaneRoster() {
  const [live, setLive] = useState(null);
  const [demo, setDemo] = useState([]);
  const [auditCount, setAuditCount] = useState(0);
  const [progress, setProgress] = useState("");
  const [caption, setCaption] = useState(null);
  const [armed, setArmed] = useState(false);
  const [waveKey, setWaveKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [summary, setSummary] = useState(null);
  const [endCard, setEndCard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [transient, setTransient] = useState({}); // id -> { pulse, hit, flashrow }
  const [showLiveModal, setShowLiveModal] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await getAgents();
      if (!mounted.current) return;
      setLive(data.live);
      setDemo(data.demo || []);
    } catch (_) { /* leave empty; surface nothing intrusive */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  // Push: any control-plane stop notifies every open session.
  useAppEventsSSE((evt) => {
    if (!evt || evt.category !== "control_plane" || !evt.metadata) return;
    setDemo((prev) => prev.map((a) => (a.id === evt.metadata.agentId ? { ...a, status: "revoked" } : a)));
  }, { category: "control_plane" });

  const mark = (id, flags) => setTransient((t) => ({ ...t, [id]: { ...(t[id] || {}), ...flags } }));
  const clearMark = (id) => setTransient((t) => { const c = { ...t }; delete c[id]; return c; });

  // Stop one demo agent with the during-animation; returns when revoked.
  const stopOne = async (agent) => {
    setCaption(`Revoking Ping token -> ${agent.label} loses authority`);
    mark(agent.id, { pulse: true, hit: true });
    setProgress(`Revoking ${agent.label}...`);
    try {
      await stopAgent(agent.id);
    } catch (_) { /* still reflect intent in the demo UI */ }
    await sleep(REVOKE_MS);
    if (!mounted.current) return;
    setDemo((prev) => prev.map((a) => (a.id === agent.id ? { ...a, status: "revoked" } : a)));
    setAuditCount((n) => n + 1);
    mark(agent.id, { pulse: false, hit: false, flashrow: true });
    setProgress(`Revoking ${agent.label}... done`);
    setTimeout(() => clearMark(agent.id), 600);
  };

  const onStopAgent = async (agent) => {
    if (busy || agent.status === "revoked") return;
    setBusy(true);
    await stopOne(agent);
    setCaption(null);
    setBusy(false);
  };

  const onStopAll = async () => {
    if (busy) return;
    const active = demo.filter((a) => a.status === "active");
    if (!active.length) return;
    setBusy(true);
    setSummary(null);
    setEndCard(null);
    setArmed(true);
    setWaveKey((k) => k + 1);
    setCaption("Severing authority at the identity layer...");
    for (const agent of active) {
      // eslint-disable-next-line no-await-in-loop
      await stopOne(agent);
      // eslint-disable-next-line no-await-in-loop
      await sleep(STAGGER_MS - REVOKE_MS);
    }
    if (!mounted.current) return;
    setArmed(false);
    setFlashKey((k) => k + 1);
    setCaption(null);
    const count = active.length;
    setSummary(`Stopped ${count} platforms across the control plane - reason manual_safety - ${nowStamp()} - ${count} immutable audit records written.`);
    setEndCard({ count, time: nowStamp() });
    setProgress(`Done - control plane severed access across ${count} platforms.`);
    setBusy(false);
  };

  const onReset = async () => {
    if (busy) return;
    try { await resetRoster(); } catch (_) { /* fall through to reload */ }
    setSummary(null);
    setEndCard(null);
    setProgress("");
    setCaption(null);
    setAuditCount(0);
    setTransient({});
    await load();
  };

  // Live row: real kill via the existing unchanged endpoint. Destroys the
  // session (logout) on the server; the apiClient 401 handling takes over.
  // Returns the kill result (scope + step breakdown) so the confirm modal can
  // show what ran vs. what was skipped before it closes.
  const confirmLiveKill = async (agentId, reason, scope) => {
    let data = null;
    try {
      const res = await apiClient.post(`/api/admin/agent/${agentId}/kill-switch`, { reason, scope });
      data = res?.data || null;
    } catch (err) {
      // 401 agent_killed is the expected success response — the body still carries scope/steps
      data = err?.response?.data?.error === "agent_killed" ? err.response.data : null;
    }
    setLive((l) => (l ? { ...l, status: "revoked" } : l));
    return data;
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

  const allRows = [];
  if (live) allRows.push({ ...live, isLive: true });
  demo.forEach((d) => allRows.push({ ...d, isLive: false }));

  const N = demo.length;
  const anchorX = 50;

  return (
    <div className="cp-wrap">
      <div key={`flash-${flashKey}`} className={`cp-flash${flashKey ? " go" : ""}`} />

      <div className="cp-head">
        <div className="cp-title">
          Ping &mdash; AI Control Plane
          <small>ONE PLACE TO GOVERN AI ACROSS EVERY PLATFORM</small>
        </div>
        <div className="cp-verbs">
          <div className="cp-verb">govern</div>
          <div className="cp-verb">authorize</div>
          <div className="cp-verb audit">audit <b>{auditCount}</b></div>
          <div className="cp-verb">shut down</div>
        </div>
      </div>

      <div className="cp-intro">
        <b>What this is:</b> enterprises now run AI agents across many platforms &mdash; ChatGPT, Copilot, Glean,
        Agentforce, ServiceNow, plus your own. Every vendor ships its own kill switch. The real question is where you go to{" "}
        <b>govern, authorize, audit, and shut down</b> AI across <i>all</i> of them. That place is the control plane below.
      </div>
      <div className="cp-access"><span className="ico">&#10003;</span> Any logged-in user can open and run this &mdash; each person gets their own scoped roster.</div>

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

      <div className="cp-trust">
        <svg className="cp-links">
          {demo.map((a, i) => {
            const x = ((i + 1) / (N + 1)) * 100;
            return (
              <line
                key={a.id}
                x1={`${anchorX}%`} y1="43" x2={`${x}%`} y2="168"
                className={a.status === "revoked" ? "dead" : ""}
              />
            );
          })}
        </svg>
        <div key={`wave-${waveKey}`} className={`cp-wave${waveKey ? " go" : ""}`} />
        {caption && <div className="cp-caption show">{caption}</div>}
        <div className={`cp-anchor${armed ? " armed" : ""}`}>
          <div className="dot">PING</div>
          <div className="lbl"><b>TRUST ANCHOR</b> &middot; issues every token</div>
        </div>
        {demo.map((a, i) => {
          const x = ((i + 1) / (N + 1)) * 100;
          const t = transient[a.id] || {};
          const cls = ["cp-node", a.status === "revoked" ? "dead" : "", t.hit ? "hit" : ""].join(" ").trim();
          return (
            <div key={a.id} className={cls} style={{ left: `calc(${x}% - 46px)` }}>
              <div className="ndot" />
              <div className="nlbl">{a.label}</div>
              <div className="tok">holds Ping token</div>
              <div className="stamp">ACCESS REVOKED</div>
            </div>
          );
        })}
      </div>

      <div className="cp-rows">
        {allRows.map((a) => {
          const t = transient[a.id] || {};
          const cls = ["cp-row", a.isLive ? "live" : "", a.status === "revoked" ? "dead" : "", t.pulse ? "cp-pulse" : "", t.flashrow ? "flashrow" : ""].join(" ").trim();
          const revoked = a.status === "revoked";
          const sub = a.isLive
            ? `LIVE - real PingOne revocation${a.providerLabel ? " - " + a.providerLabel : ""}`
            : "Ping-governed demo identity";
          const pill = revoked ? `REVOKED ${nowStamp()}` : (a.isLive ? "LIVE" : "ACTIVE");
          return (
            <div key={a.id} className={cls}>
              <div className="rdot" />
              <div className="cp-name">{a.label}<span>{sub}</span></div>
              <div className="cp-pill">{pill}</div>
              <button
                className={`cp-stop ${a.isLive ? "cp-stop--live" : ""}`}
                disabled={revoked || busy}
                onClick={() => (a.isLive ? setShowLiveModal(true) : onStopAgent(a))}
              >{a.isLive ? "STOP" : "stop"}</button>
              {a.isLive && revoked && (
                <button
                  className="cp-stop cp-stop--revive"
                  disabled={busy}
                  onClick={() => confirmLiveRevive(a.id)}
                >Re-enable</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="cp-actions">
        <button className="cp-btn stopall" disabled={busy} onClick={onStopAll}>Stop across all platforms</button>
        <button className="cp-btn reset" disabled={busy} onClick={onReset}>Reset roster</button>
        <span className="cp-progress">{progress}</span>
      </div>

      {summary && <div className="cp-summary"><b>Last action:</b> {summary} <u>View in Forensic Audit</u></div>}

      {endCard && (
        <div className="cp-end">
          <div className="big">ALL AI ACTIVITY HALTED</div>
          <div className="sub">Every agent authenticated through Ping. Revoking at the <b>control plane</b> killed their authority &mdash; so access died across every platform at once, no matter which AI vendor or model was running.</div>
          <div className="meta">Stopped <b>{endCard.count} platforms</b> &middot; reason <b>manual_safety</b> &middot; {endCard.time} &middot; <b>{endCard.count} immutable audit records</b></div>
          <div className="x" onClick={() => setEndCard(null)}>dismiss &mdash; keep the summary below</div>
        </div>
      )}

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
            <p>Every stop writes an immutable record &mdash; one trail that spans all vendors for regulators and incident review.</p>
            <span className="who">Risk / Compliance</span></div>
          <div className="cp-val"><div className="vi">&#9822;</div><h4>Own the trusted control point</h4>
            <p>Ping becomes the policy &amp; identity plane the AI ecosystem integrates with &mdash; the strategic position, not just a kill switch.</p>
            <span className="who">Strategy / Exec</span></div>
        </div>
      </div>

      <KillSwitchConfirmModal
        isOpen={showLiveModal}
        agentId={live ? live.id : "demo-agent"}
        onConfirm={confirmLiveKill}
        onCancel={() => setShowLiveModal(false)}
      />
    </div>
  );
}
