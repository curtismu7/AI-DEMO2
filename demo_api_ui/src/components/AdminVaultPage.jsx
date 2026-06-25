import React, { useState, useEffect, useCallback } from "react";
import apiClient from "../services/apiClient";
import "./AdminVaultPage.css";

/**
 * AdminVaultPage — operator UI for the runtime credential vault.
 *
 * Three sections:
 *   1. Status card    — calls GET  /api/admin/vault/status on mount and on demand.
 *   2. Unlock form    — calls POST /api/admin/vault/unlock with { password }.
 *   3. Rotate form    — calls POST /api/admin/vault/rotate with { currentPassword, newPassword }.
 *
 * Security/UX rules baked in (Phase 269.1 threat model):
 *   - Passwords are held only in component-local useState; cleared on success.
 *   - Banner text never echoes typed passwords; always uses the server message or a
 *     static success string. (T-UI-01)
 *   - Failed unlock keeps the password input populated so the admin can retry. (UX)
 *   - Rotate runs client-side validation before any API call; mismatch / weak / same
 *     password short-circuit. (T-UI-02)
 *   - Only ⚠️ ✅ ❌ emojis appear in rendered text (CLAUDE.md non-negotiable #4).
 *
 * Network: all calls go through apiClient (cookie auth, traffic logger, spinner).
 * No raw axios / fetch — that would bypass the BFF session pattern.
 */
export default function AdminVaultPage() {
  const [status, setStatus] = useState({ loading: true });
  const [unlockPassword, setUnlockPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [banner, setBanner] = useState(null); // null | { kind: 'ok' | 'err', text }
  const [submitting, setSubmitting] = useState(false);
  const [rotating, setRotating] = useState(false);

  const refresh = useCallback(async () => {
    setStatus((prev) => ({ ...prev, loading: true }));
    try {
      const response = await apiClient.get("/api/admin/vault/status");
      const { unlocked, entriesLoaded, vaultFilePresent, vaultPath } =
        response.data || {};
      setStatus({
        loading: false,
        unlocked: Boolean(unlocked),
        entriesLoaded: Number(entriesLoaded ?? 0),
        vaultFilePresent: Boolean(vaultFilePresent),
        vaultPath: vaultPath || "",
      });
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        "Failed to load vault status";
      setStatus({ loading: false, error: msg });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const extractMessage = (err) =>
    err.response?.data?.message ||
    err.response?.data?.error ||
    err.message ||
    "Request failed";

  const handleUnlock = async (e) => {
    e.preventDefault();
    setBanner(null);
    if (unlockPassword === "") {
      setBanner({ kind: "err", text: "❌ Password is required" });
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiClient.post("/api/admin/vault/unlock", {
        password: unlockPassword,
      });
      const entriesLoaded = response.data?.entriesLoaded ?? 0;
      // Clear the password on success — never echo, never retain longer than needed.
      setUnlockPassword("");
      setBanner({
        kind: "ok",
        text: `✅ Vault unlocked — ${entriesLoaded} entries loaded`,
      });
      await refresh();
    } catch (err) {
      // Do NOT clear unlockPassword on failure — admin retries with the same input.
      setBanner({ kind: "err", text: `❌ ${extractMessage(err)}` });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRotate = async (e) => {
    e.preventDefault();
    setBanner(null);

    // Client-side validation — never let the request leave the browser if the
    // user obviously typed something wrong.
    if (
      currentPassword === "" ||
      newPassword === "" ||
      confirmNewPassword === ""
    ) {
      setBanner({
        kind: "err",
        text: "❌ All password fields are required",
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setBanner({
        kind: "err",
        text: "❌ New password and confirmation do not match",
      });
      return;
    }
    if (newPassword.length < 12) {
      setBanner({
        kind: "err",
        text: "❌ New password must be at least 12 characters",
      });
      return;
    }
    if (newPassword === currentPassword) {
      setBanner({
        kind: "err",
        text: "❌ New password must differ from current",
      });
      return;
    }

    setRotating(true);
    try {
      await apiClient.post("/api/admin/vault/rotate", {
        currentPassword,
        newPassword,
      });
      // Clear all three inputs on success.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setBanner({
        kind: "ok",
        text: "✅ Vault password rotated. ⚠️ Update VAULT_PASSWORD in your .env / pm2 / secret manager before the next BFF restart.",
      });
      await refresh();
    } catch (err) {
      setBanner({ kind: "err", text: `❌ ${extractMessage(err)}` });
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="admin-vault-page">
      <h1>Vault — Unlock and Rotate</h1>
      <p className="admin-vault-page__intro">
        Decrypt the credential vault at runtime so the BFF picks up rotated
        secrets without a process restart. The password never leaves this
        browser session and is never persisted server-side.
      </p>

      {/* Status card */}
      <section className="admin-vault-page__status">
        <h2>Status</h2>
        {status.loading ? (
          <p>Loading…</p>
        ) : status.error ? (
          <p className="admin-vault-page__error">❌ {status.error}</p>
        ) : (
          <ul>
            <li>
              Vault file present: {status.vaultFilePresent ? "✅ yes" : "❌ no"}
            </li>
            <li>
              Vault file: <code>{status.vaultPath}</code>
            </li>
            <li>
              Unlocked this process: {status.unlocked ? "✅ yes" : "❌ no"}
            </li>
            <li>Entries loaded: {status.entriesLoaded}</li>
          </ul>
        )}
        <button
          type="button"
          className="admin-vault-page__refresh"
          onClick={refresh}
        >
          Refresh status
        </button>
      </section>

      {/* Banner */}
      {banner && (
        <div
          className={`admin-vault-page__banner admin-vault-page__banner--${banner.kind}`}
          role="alert"
        >
          {banner.text}
        </div>
      )}

      {/* Unlock form */}
      <section className="admin-vault-page__unlock">
        <h2>Unlock Vault</h2>
        <form onSubmit={handleUnlock}>
          <label htmlFor="unlock-password">Vault password</label>
          <input
            id="unlock-password"
            type="password"
            autoComplete="current-password"
            value={unlockPassword}
            onChange={(e) => setUnlockPassword(e.target.value)}
            disabled={submitting}
          />
          <button type="submit" disabled={submitting || unlockPassword === ""}>
            {submitting ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      </section>

      {/* Rotate form */}
      <section className="admin-vault-page__rotate">
        <h2>Rotate Vault Password</h2>
        <p className="admin-vault-page__rotate-hint">
          ⚠️ Rotating the vault changes the password on the file. After success
          you must update <code>VAULT_PASSWORD</code> in your .env / pm2 /
          secret manager before the next BFF restart, otherwise startup will
          fail.
        </p>
        <form onSubmit={handleRotate}>
          <label htmlFor="rotate-current">Current password</label>
          <input
            id="rotate-current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={rotating}
          />

          <label htmlFor="rotate-new">New password (≥ 12 chars)</label>
          <input
            id="rotate-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={rotating}
          />

          <label htmlFor="rotate-confirm">Confirm new password</label>
          <input
            id="rotate-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            disabled={rotating}
          />

          <button
            type="submit"
            disabled={
              rotating ||
              currentPassword === "" ||
              newPassword === "" ||
              confirmNewPassword === ""
            }
          >
            {rotating ? "Rotating…" : "Rotate password"}
          </button>
        </form>
      </section>
    </div>
  );
}
