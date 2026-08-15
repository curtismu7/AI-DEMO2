import React, { useCallback, useEffect, useState } from "react";
import DraggableModal from "./DraggableModal";
import apiClient from "../services/apiClient";
import "./GroupMembershipToggle.css";

/**
 * GroupMembershipToggle — move the signed-in demo user in and out of the active
 * vertical's privileged PingOne group, without leaving the app.
 *
 * This is a REAL directory write. groupPolicy.groupsForUser() prefers a live
 * PingOne lookup, so a simulated toggle would change this panel and not the
 * authorization decision — the demo would look right and prove nothing.
 *
 * State always comes from the server, never from what we just asked for: the
 * server re-reads membership from PingOne after writing and returns what it
 * found. A write that silently no-ops therefore shows as unchanged here rather
 * than as success.
 */
export default function GroupMembershipToggle({ onChange = null, verticalId = null }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/api/groups/membership", {
        params: verticalId ? { verticalId } : {},
        _silent: true,
      });
      setState(res.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [verticalId]);

  useEffect(() => { load(); }, [load]);

  const privilegedGroup = state?.categories?.privileged?.name || null;
  const inGroup = Boolean(privilegedGroup && (state?.groups || []).includes(privilegedGroup));

  const toggle = useCallback(async () => {
    if (!privilegedGroup || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post("/api/groups/membership/toggle", {
        inGroup: !inGroup,
        category: "privileged",
        ...(verticalId ? { verticalId } : {}),
      }, {
        _silent: true,
      });
      const data = res.data;

      await load();
      setModal({
        inGroup: data.inGroup,
        groupName: data.groupName,
        verticalId: data.verticalId,
        username: data.username,
        // The server compares its post-write read against what was asked. A
        // mismatch means PingOne accepted the call and did not apply it — worth
        // saying out loud rather than rendering a confident wrong state.
        mismatch: data.verified && data.inGroup !== data.requested,
        userTier: data.userTier,
      });
      if (onChange) onChange(data);
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  }, [privilegedGroup, inGroup, busy, load, onChange, verticalId]);

  if (loading) {
    return <div className="gmt-panel gmt-panel--loading">Checking group membership…</div>;
  }

  if (error && !state) {
    return (
      <div className="gmt-panel gmt-panel--error">
        <span className="gmt-error-mark">⚠️</span>
        <div>
          <div className="gmt-error-title">Could not read group membership</div>
          <div className="gmt-error-detail">{error}</div>
        </div>
        <button type="button" className="gmt-retry" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!privilegedGroup) {
    return (
      <div className="gmt-panel gmt-panel--error">
        <span className="gmt-error-mark">⚠️</span>
        <div className="gmt-error-title">
          {state?.displayName || state?.verticalId} declares no privileged group
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="gmt-panel">
        <div className="gmt-head">
          <span className="gmt-label">Group membership</span>
          <span className={`gmt-state ${inGroup ? "gmt-state--in" : "gmt-state--out"}`}>
            {inGroup ? "In group" : "Not in group"}
          </span>
        </div>

        {/* The demo's story, told where the control lives: scopes are not
            entitlements. Wording is deliberately what the CODE does — a live
            directory read per call, enforced before the tool runs — and NOT
            "PingOne Authorize decides", which this gate cannot back (see
            docs/superpowers/specs/2026-08-10-admin-demo-stories-design.md). */}
        <div className="gmt-story">
          <div className="gmt-story-title">The story: scopes are not entitlements</div>
          <ol className="gmt-story-beats">
            <li>The agent's token already holds every scope it needs — and it never changes during this demo.</li>
            <li>What decides access is membership in this group, re-read live from the PingOne directory on every tool call.</li>
            <li>Remove the user, and the very next call is refused — same token, no logout, no waiting for expiry. Add them back and it is permitted again.</li>
          </ol>
        </div>

        <dl className="gmt-facts">
          <div>
            <dt>User</dt>
            <dd>{state.username || "unknown"}</dd>
          </div>
          <div>
            <dt>Group</dt>
            <dd className="gmt-mono">{privilegedGroup}</dd>
          </div>
          <div>
            <dt>Vertical</dt>
            <dd>{state.displayName || state.verticalId}</dd>
          </div>
          <div>
            <dt>Source</dt>
            {/* `manifest` means the live lookup did not run, so this panel is
                showing declared intent rather than directory truth — and the
                toggle would write somewhere the decision does not read. */}
            <dd>{state.source === "pingone" ? "PingOne directory" : "manifest (not live)"}</dd>
          </div>
        </dl>

        <button
          type="button"
          className={`gmt-toggle ${inGroup ? "gmt-toggle--remove" : "gmt-toggle--add"}`}
          onClick={toggle}
          disabled={busy}
          aria-pressed={inGroup}
        >
          {busy ? <><span className="gmt-spinner" aria-hidden="true" /> Applying…</> : inGroup ? `Remove from ${privilegedGroup}` : `Add to ${privilegedGroup}`}
        </button>

        {error ? <div className="gmt-inline-error">⚠️ {error}</div> : null}

        <p className="gmt-note">
          Writes directly to PingOne. The authorization decision reads the same
          directory, so the next tool call reflects this immediately.
        </p>
      </div>

      <DraggableModal
        isOpen={Boolean(modal)}
        onClose={() => setModal(null)}
        title="Group membership changed"
        defaultWidth={460}
        defaultHeight={340}
        storageKey="group-membership-toggle"
      >
        {modal ? (
          <div className="gmt-modal">
            <div className={`gmt-modal-state ${modal.inGroup ? "gmt-modal-state--in" : "gmt-modal-state--out"}`}>
              {modal.inGroup ? "✅" : "❌"}
              <span>
                {modal.username} is {modal.inGroup ? "now in" : "no longer in"} {modal.groupName}
              </span>
            </div>

            {/* Accuracy: the gate is a live PingOne directory read enforced
                before the tool runs — NOT a PingOne Authorize decision. The
                earlier copy credited P1AZ, a claim this demo cannot back
                (spec 2026-08-10-admin-demo-stories-design.md, "What the gate
                actually is"). */}
            <p className="gmt-modal-body">
              {modal.inGroup
                ? `The group-gated tools for ${modal.verticalId} are now permitted. The authorization check re-reads this membership from the PingOne directory on the next call.`
                : `The group-gated tools for ${modal.verticalId} are now denied. The authorization check re-reads the PingOne directory on the next call and finds no membership — regardless of the token's scopes.`}
            </p>

            {modal.userTier ? (
              <p className="gmt-modal-tier">Resolved tier: <strong>{modal.userTier}</strong></p>
            ) : null}

            {modal.mismatch ? (
              <p className="gmt-modal-warn">
                ⚠️ PingOne accepted the change but the re-read does not match what
                was requested. Membership may not have applied.
              </p>
            ) : null}
          </div>
        ) : null}
      </DraggableModal>
    </>
  );
}
