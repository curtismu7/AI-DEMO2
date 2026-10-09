// banking_api_ui/src/components/SessionExpiryTimer.jsx - Global Banking Header
import React, { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import bffAxios from "../services/bffAxios";
import { getCachedJson } from "../services/cachedStatusService";
import { isEducationalPath } from "../utils/educationalPages";
import { performLogout } from "../services/logout";
import "./SessionExpiryTimer.css";

/**
 * BankingHeader — Professional banking header that appears on all logged-in pages.
 * Inspired by PNC and major banking UIs.
 * Shows: user info, session timer, and context-aware controls.
 */
export default function SessionExpiryTimer({ hideOnPaths = [] }) {
  const { pathname } = useLocation();
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [isExpired, setIsExpired] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Don't show on landing page, setup, or logout pages
  const shouldHide =
    hideOnPaths.some((p) => pathname.startsWith(p)) ||
    pathname === "/" ||
    pathname === "/" ||
    pathname === "/setup" ||
    pathname === "/setup/wizard" ||
    pathname === "/setup/pingone" ||
    pathname === "/logout";

  // Fetch session token and user info, then keep polling. A mount-once fetch
  // (the previous shape) never learns about a SILENT token refresh — the
  // backend extends the session behind the scenes, `expiresAt` here stays
  // pinned to the value read at mount, and this header eventually renders
  // "Expired" against a session that is actually still live. Re-fetching on
  // the same cadence the countdown already re-renders on (30s, below) keeps
  // `expiresAt` from ever drifting far from the truth.
  useEffect(() => {
    // Skip on documentation-only pages — no session is expected there and
    // both endpoints below would 401, producing console noise.
    if (isEducationalPath(pathname) || shouldHide) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchSessionData() {
      try {
        const [previewRes, statusRes] = await Promise.all([
          bffAxios
            .get("/api/tokens/session-preview")
            .catch(() => ({ data: {} })),
          getCachedJson("/api/auth/oauth/user/status").catch(() => ({ data: {} })),
        ]);

        if (cancelled) return;

        const events = previewRes.data?.tokenEvents || [];
        const userTokenEvent = events.find(
          (e) =>
            e.decoded &&
            (e.id === "user-token" || e.label?.toLowerCase().includes("user")),
        );

        if (userTokenEvent?.decoded?.payload?.exp) {
          setExpiresAt(userTokenEvent.decoded.payload.exp);
        }

        if (statusRes.data?.user) {
          setUserInfo(statusRes.data.user);
        }

        setLoading(false);
      } catch (err) {
        console.warn("[BankingHeader] fetch error:", err.message);
        if (!cancelled) setLoading(false);
      }
    }

    fetchSessionData();
    const poll = setInterval(fetchSessionData, 30000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-once for the skip check — pathname/shouldHide changes don't re-arm it; the interval is what keeps expiresAt fresh now

  // Calculate and update time remaining every 30 seconds
  const updateTimeRemaining = useCallback(() => {
    if (!expiresAt) return;

    const diffMs = expiresAt * 1000 - Date.now();
    const expired = diffMs <= 0;
    setIsExpired(expired);

    if (expired) {
      setTimeRemaining("Expired");
    } else {
      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);

      if (hours > 0) {
        setTimeRemaining(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setTimeRemaining(`${minutes}m ${seconds}s`);
      } else {
        setTimeRemaining(`${seconds}s`);
      }
    }
  }, [expiresAt]);

  useEffect(() => {
    if (!expiresAt) return;

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 30000);
    return () => clearInterval(interval);
  }, [expiresAt, updateTimeRemaining]);

  if (shouldHide) {
    return null;
  }

  if (loading) {
    return (
      <header className="banking-header">
        <div className="banking-header__inner">
          <div className="banking-header__left" />
          <div className="banking-header__right" />
        </div>
      </header>
    );
  }

  const userName = userInfo
    ? `${userInfo.firstName || ""} ${userInfo.lastName || ""}`.trim()
    : "User";
  const userInitials = userInfo
    ? `${userInfo.firstName?.[0] || ""}${userInfo.lastName?.[0] || ""}`.toUpperCase()
    : "U";
  const userRole = userInfo?.role || "user";

  return (
    <header className="banking-header">
      <div className="banking-header__inner">
        <div className="banking-header__left">
          {userInfo && (
            <div className="banking-header__user-context">
              <span className="banking-header__user-context-label">
                {userRole === "admin" ? "Admin Dashboard" : "Customer Portal"}
              </span>
            </div>
          )}
        </div>

        <div className="banking-header__right">
          {expiresAt && (
            <div
              className={`banking-header__session ${isExpired ? "expired" : ""}`}
            >
              <span className="banking-header__session-label">Session</span>
              <span className="banking-header__session-time">
                {timeRemaining}
              </span>
            </div>
          )}

          {userInfo && (
            <div className="banking-header__user">
              <div className="banking-header__user-avatar">{userInitials}</div>
              <div className="banking-header__user-info">
                <div className="banking-header__user-name">{userName}</div>
                <div className="banking-header__user-role">{userRole}</div>
              </div>
            </div>
          )}

          <button
            className="banking-header__logout-btn"
            onClick={performLogout}
            title="Sign Out"
            aria-label="Sign Out"
          >
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
}
