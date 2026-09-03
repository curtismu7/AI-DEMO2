import { useCallback, useEffect, useMemo, useState } from "react";
import JsonHighlight from "../components/shared/JsonHighlight";
import { getSdkClient, isSdkError } from "../lib/oidcSdkClient";

// OIDC Centralized Login sandbox (/sdk-login).
//
// Demonstrates the Ping Orchestration JavaScript SDK (@forgerock/oidc-client):
// browser-side authorization-code + PKCE login, then token revocation. This is the
// OPPOSITE pattern to the AI Demo BFF login (where tokens live on the server
// and the browser only holds a session cookie) — here the SDK performs PKCE in the
// browser and holds tokens in localStorage. It exists to illustrate the SDK, not to
// replace the BFF flow. See GET /api/sdk-demo/config for the non-secret config.

const THEME_KEY = "sdkLoginTheme";

const PALETTES = {
  dark: {
    isDark: true,
    bg: "#0b1220", panel: "#111a2e", panel2: "#0e1626", border: "#1e2c47",
    text: "#e6edf7", muted: "#93a4c0", blue: "#2f81f7", code: "#0a1322",
    red: "#f85149", redText: "#ff7b72", green: "#5fd07a",
    tagOut: "rgba(147,164,192,.12)", tagIn: "rgba(46,160,67,.14)", tagRev: "rgba(248,81,73,.12)",
    tagInB: "rgba(46,160,67,.35)", tagRevB: "rgba(248,81,73,.35)",
    bannerOkBg: "rgba(46,160,67,.10)", bannerOkB: "rgba(46,160,67,.30)",
    bannerErrBg: "rgba(248,81,73,.10)", bannerErrB: "rgba(248,81,73,.30)",
  },
  light: {
    isDark: false,
    bg: "#f6f8fc", panel: "#ffffff", panel2: "#eef2f9", border: "#d9e1ee",
    text: "#0e1626", muted: "#5a6b85", blue: "#2f6fe0", code: "#f4f7fc",
    red: "#d23b34", redText: "#c5302a", green: "#1a7f37",
    tagOut: "rgba(90,107,133,.10)", tagIn: "rgba(26,127,55,.12)", tagRev: "rgba(210,59,52,.10)",
    tagInB: "rgba(26,127,55,.35)", tagRevB: "rgba(210,59,52,.35)",
    bannerOkBg: "rgba(26,127,55,.08)", bannerOkB: "rgba(26,127,55,.28)",
    bannerErrBg: "rgba(210,59,52,.08)", bannerErrB: "rgba(210,59,52,.28)",
  },
};

function makeStyles(C) {
  return {
    page: { background: C.bg, color: C.text, minHeight: "100vh", padding: "28px 20px 60px",
      transition: "background .25s ease, color .25s ease",
      font: '14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' },
    wrap: { maxWidth: 920, margin: "0 auto" },
    headRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 },
    topbar: { display: "flex", alignItems: "center", gap: 10, color: C.muted, fontSize: 12,
      letterSpacing: ".04em", textTransform: "uppercase" },
    dot: { width: 8, height: 8, borderRadius: "50%", background: C.blue, display: "inline-block" },
    h1: { fontSize: 22, margin: "0 0 8px" },
    badge: { display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 999,
      border: `1px solid ${C.border}`, color: C.muted, marginLeft: 8, verticalAlign: "middle" },
    sub: { color: C.muted, margin: "0 0 22px", maxWidth: 680 },
    explain: { display: "flex", gap: 14, alignItems: "flex-start", background: C.panel2,
      border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", margin: "0 0 22px" },
    card: { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20,
      margin: "0 0 22px", transition: "background .25s ease, border-color .25s ease" },
    cardH: { fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", color: C.muted,
      margin: "0 0 14px", display: "flex", alignItems: "center", gap: 8 },
    tag: (kind) => ({ marginLeft: "auto", fontSize: 11, padding: "2px 9px", borderRadius: 999,
      border: `1px solid ${kind === "in" ? C.tagInB : kind === "rev" ? C.tagRevB : C.border}`,
      color: kind === "in" ? C.green : kind === "rev" ? C.redText : C.muted,
      background: kind === "in" ? C.tagIn : kind === "rev" ? C.tagRev : C.tagOut }),
    row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
    btn: { font: "inherit", fontWeight: 600, borderRadius: 8, padding: "10px 18px", cursor: "pointer",
      border: "1px solid transparent" },
    btnPrimary: { background: C.blue, color: "#fff" },
    btnGhost: { background: "transparent", color: C.text, borderColor: C.border },
    btnDanger: { background: "transparent", color: C.redText, borderColor: C.tagRevB },
    note: { fontSize: 12, color: C.muted, marginTop: 10 },
    label: { margin: "14px 0 6px", color: C.muted, fontSize: 12 },
    pre: { background: C.code, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "14px 16px", margin: "0 0 8px", overflow: "auto", fontSize: 12.5 },
    who: { display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px" },
    avatar: { width: 38, height: 38, borderRadius: "50%", color: "#fff", fontWeight: 700,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg,#2f81f7,#7b5cff)" },
    banner: (ok) => ({ borderRadius: 10, padding: "12px 14px", margin: "0 0 16px", fontSize: 13,
      background: ok ? C.bannerOkBg : C.bannerErrBg,
      border: `1px solid ${ok ? C.bannerOkB : C.bannerErrB}`,
      color: ok ? C.green : C.redText }),
  };
}

// Inline SVG icons (no emoji, per the project UI style rules).
function SunIcon({ size = 14, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" role="img">
      <title>Light</title>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}
function MoonIcon({ size = 13, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} role="img">
      <title>Dark</title>
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z" />
    </svg>
  );
}

// Cool animated light/dark toggle (sliding knob with SVG sun/moon).
function ThemeToggle({ theme, onToggle, C }) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
      title={`Switch to ${dark ? "light" : "dark"} theme`}
      style={{
        position: "relative", width: 60, height: 30, borderRadius: 999, cursor: "pointer",
        padding: 0, marginLeft: "auto", flexShrink: 0,
        border: `1px solid ${C.border}`,
        background: dark
          ? "linear-gradient(120deg,#0e1626,#1b2a4a)"
          : "linear-gradient(120deg,#dbe7ff,#fdf3d6)",
        transition: "background .3s ease, border-color .3s ease",
      }}
    >
      <span aria-hidden style={{ position: "absolute", left: 7, top: 7, opacity: dark ? 0.4 : 1, color: "#e0a528" }}>
        <SunIcon />
      </span>
      <span aria-hidden style={{ position: "absolute", right: 7, top: 8, opacity: dark ? 1 : 0.4, color: "#cdd6e6" }}>
        <MoonIcon />
      </span>
      <span
        style={{
          position: "absolute", top: 3, left: 3, width: 24, height: 24, borderRadius: "50%",
          background: dark ? "#0b1220" : "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,.35)",
          transform: dark ? "translateX(30px)" : "translateX(0)",
          transition: "transform .3s cubic-bezier(.4,1.3,.5,1), background .3s ease",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: dark ? "#cdd6e6" : "#e0a528",
        }}
      >
        {dark ? <MoonIcon size={12} /> : <SunIcon size={13} />}
      </span>
    </button>
  );
}

// Small CSS info badge (circled "i") — replaces the emoji info glyph.
function InfoBadge({ C }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0, width: 20, height: 20, borderRadius: "50%", marginTop: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontStyle: "italic", fontWeight: 700, fontFamily: "Georgia, serif",
        color: C.blue, border: `1.5px solid ${C.blue}`,
      }}
    >
      i
    </span>
  );
}

function initials(info) {
  const name = info?.name || info?.email || info?.sub || "?";
  return String(name).trim().slice(0, 2).toUpperCase();
}

function initialTheme() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage unavailable */
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

export default function SdkLoginPage() {
  const [theme, setTheme] = useState(initialTheme);
  const C = PALETTES[theme];
  // makeStyles allocates ~20 style objects; only re-derive when the theme changes.
  const styles = useMemo(() => makeStyles(C), [C]);

  // status: 'loading' | 'signed-out' | 'signed-in' | 'error'
  const [status, setStatus] = useState("loading");
  const [tokens, setTokens] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, text } after revoke/logout
  const [exercise, setExercise] = useState('');

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const client = await getSdkClient();
      const result = await client.token.get();
      if (isSdkError(result) || !result.accessToken) {
        setTokens(null);
        setUserInfo(null);
        setStatus("signed-out");
        return;
      }
      setTokens(result);
      setStatus("signed-in");
      const info = await client.user.info();
      setUserInfo(isSdkError(info) ? null : info);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const client = await getSdkClient();
      // authorize.url() generates + stores state and the PKCE code_verifier.
      // Never construct this URL by hand.
      // login_hint=demouser prefills the username on the PingOne login page.
      // The SDK only forwards extra OAuth params via `query`; unknown top-level
      // keys (e.g. loginHint) are silently dropped from the authorization URL.
      const url = await client.authorize.url({ query: { login_hint: "demouser" } });
      if (typeof url !== "string") {
        throw new Error(url?.error || "Could not build the authorization URL");
      }
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }, []);

  const handleRevoke = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const client = await getSdkClient();
      const result = await client.token.revoke();
      if (isSdkError(result)) {
        throw new Error(result.error || "Token revocation failed");
      }
      setNotice({
        ok: true,
        text: "Access token revoked and cleared from storage. token.get() now returns no tokens.",
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const client = await getSdkClient();
      const result = await client.user.logout();
      if (isSdkError(result)) {
        throw new Error(result.error || "Logout failed");
      }
      setNotice({
        ok: true,
        text: "Logged out: token revoked and the PingOne session ended (end_session_endpoint).",
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // JsonHighlight's default palette is tuned for light backgrounds; the jh-dark
  // wrapper class switches it to the dark palette.
  const preClass = C.isDark ? "jh-dark" : undefined;

  const timeline = [
    ['1', 'Discover config', 'Load issuer, client, redirect URI, and scopes from the BFF.'],
    ['2', 'Authorize + PKCE', 'The SDK creates state and a code verifier before redirecting to PingOne.'],
    ['3', 'Callback + tokens', 'Exchange the authorization code and persist tokens in browser storage.'],
    ['4', 'Use, refresh, revoke', 'Inspect claims, refresh before expiry, then revoke or end the session.'],
  ];
  const lifecycleExercise = (label) => {
    setExercise(label);
    setNotice({ ok: true, text: `${label} exercise selected — use the controls below to observe the SDK call and resulting token state.` });
  };
  const startMfaCheckpoint = () => {
    setExercise('MFA checkpoint');
    setNotice({
      ok: true,
      text: status === 'signed-in'
        ? 'MFA checkpoint ready. This page does not redirect or start a second login. The existing SDK session is the subject; verify PingOne MFA policy and inspect acr/amr after the protected action.'
        : 'MFA checkpoint is an in-page teaching state. Sign-in is not started here; configure MFA on the PingOne policy, then exercise it from a protected action.',
    });
  };

  return (
    <div style={styles.page}>
      <div style={styles.wrap}>
        <div style={styles.headRow}>
          <div style={styles.topbar}>
            <span style={styles.dot} /> The AI Demo · Developer Sandbox
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} C={C} />
        </div>

        <h1 style={styles.h1}>
          OIDC Centralized Login — JavaScript SDK
          <span style={styles.badge}>@forgerock/oidc-client</span>
          <span style={styles.badge}>PKCE · public client</span>
        </h1>
        <p style={styles.sub}>
          A self-contained sandbox demonstrating browser-side OAuth2 / OIDC using the Ping
          Orchestration JavaScript SDK: authorization-code + PKCE login, then token revocation —
          entirely in the browser.
        </p>

        <nav aria-label="SDK demo navigation" style={{ ...styles.card, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['Overview', '#sdk-overview'], ['Flow timeline', '#sdk-flow'], ['Token lifecycle', '#sdk-lifecycle'], ['MFA journey', '#sdk-mfa']].map(([label, href]) => (
            <a key={href} href={href} style={{ ...styles.btn, ...styles.btnGhost, padding: '7px 12px', textDecoration: 'none' }}>{label}</a>
          ))}
        </nav>

        <div id="sdk-overview" style={styles.explain}>
          <InfoBadge C={C} />
          <p style={{ margin: 0, color: C.muted }}>
            <b style={{ color: C.text }}>Different from the main app.</b> The AI Demo login is
            BFF-based — tokens live on the server and the browser only holds a session cookie.{" "}
            <b style={{ color: C.text }}>This page is the opposite pattern:</b> the SDK performs PKCE
            in the browser and holds tokens in <code>localStorage</code>. It illustrates the SDK; it
            does not replace the BFF flow.
          </p>
        </div>

        <section id="sdk-flow" style={styles.card}>
          <div style={styles.cardH}>SDK flow timeline <span style={styles.tag('out')}>guided</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {timeline.map(([num, title, desc]) => <div key={num} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, background: C.panel2 }}><b style={{ color: C.blue }}>{num}. {title}</b><div style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>{desc}</div></div>)}
          </div>
        </section>

        {status === "loading" && (
          <div style={styles.card}>
            <div style={styles.cardH}>SDK session</div>
            <p style={{ color: C.muted, margin: 0 }}>Loading SDK client…</p>
          </div>
        )}

        {status === "error" && (
          <div style={styles.card}>
            <div style={styles.cardH}>
              SDK session <span style={styles.tag("rev")}>not available</span>
            </div>
            <p style={{ color: C.muted, margin: "0 0 12px" }}>
              The SDK client could not start. This usually means the PingOne PKCE SPA client
              is not configured.
            </p>
            <div style={{ background: C.code, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 12 }}>
              <p style={{ color: C.muted, margin: "0 0 8px", fontWeight: 700 }}>To fix:</p>
              <ol style={{ margin: 0, padding: "0 0 0 18px", color: C.muted, lineHeight: 1.7 }}>
                <li>Create a SPA (public PKCE) application in PingOne</li>
                <li>Set redirect URI to: <code style={{ color: C.blue }}>{window.location.origin}/sdk-login/callback</code></li>
                <li>Go to <a href="/settings" style={{ color: C.blue }}>Settings</a> and set <code>PINGONE_SDK_DEMO_CLIENT_ID</code></li>
                <li>Restart the server (or save in Settings)</li>
              </ol>
            </div>
            <button
              type="button"
              style={{ ...styles.btn, ...styles.btnGhost }}
              onClick={() => {
                setStatus("loading");
                setError(null);
                refresh();
              }}
            >
              Retry
            </button>
          </div>
        )}

        {status === "signed-out" && (
          <div style={styles.card}>
            <div style={styles.cardH}>
              SDK session <span style={styles.tag("out")}>no tokens</span>
            </div>
            <p style={{ color: C.muted, margin: "0 0 16px" }}>
              You are not signed in. Clicking below calls <code>client.authorize.url()</code> (the SDK
              generates &amp; stores <code>state</code> + PKCE verifier) and redirects you to PingOne.
            </p>
            <div style={styles.row}>
              <button
                type="button"
                disabled={busy}
                style={{ ...styles.btn, ...styles.btnPrimary, opacity: busy ? 0.6 : 1 }}
                onClick={handleSignIn}
              >
                Sign in with the SDK →
              </button>
              <span style={{ ...styles.note, marginTop: 0 }}>
                redirects to PingOne, returns to <code>/sdk-login/callback</code>
              </span>
            </div>
          </div>
        )}

        {status === "signed-in" && (
          <div style={styles.card}>
            <div style={styles.cardH}>
              SDK session <span style={styles.tag("in")}>authenticated</span>
            </div>

            <div style={styles.who}>
              <div style={styles.avatar}>{initials(userInfo)}</div>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {userInfo?.name || userInfo?.preferred_username || "Signed in"}
                </div>
                <div style={{ color: C.muted, fontSize: 12 }}>
                  {userInfo?.email || userInfo?.sub || ""}
                </div>
              </div>
            </div>

            <div style={styles.label}>client.token.get()</div>
            <pre className={preClass} style={styles.pre}>
              <JsonHighlight value={tokens} />
            </pre>

            {userInfo && (
              <>
                <div style={styles.label}>client.user.info()</div>
                <pre className={preClass} style={styles.pre}>
                  <JsonHighlight value={userInfo} />
                </pre>
              </>
            )}

            <div style={{ ...styles.row, marginTop: 12 }}>
              <button
                type="button"
                disabled={busy}
                style={{ ...styles.btn, ...styles.btnDanger, opacity: busy ? 0.6 : 1 }}
                onClick={handleRevoke}
              >
                Revoke token
              </button>
              <button
                type="button"
                disabled={busy}
                style={{ ...styles.btn, ...styles.btnGhost, opacity: busy ? 0.6 : 1 }}
                onClick={handleLogout}
              >
                Logout (end PingOne session)
              </button>
            </div>
            <div id="sdk-lifecycle" style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <div style={styles.cardH}>Token lifecycle exercises</div>
              <div style={styles.row}>
                {['Inspect token', 'Refresh session', 'Revoke token'].map((label) => <button key={label} type="button" style={{ ...styles.btn, ...styles.btnGhost }} onClick={() => lifecycleExercise(label)}>{label}</button>)}
              </div>
              {exercise && <p style={styles.note}>Selected: <b>{exercise}</b>. Observe <code>client.token.get()</code>, expiry, storage, and revocation behavior in this panel.</p>}
            </div>
            <p style={styles.note}>
              <b>Revoke token</b> → <code>client.token.revoke()</code> (revokes the access token,
              clears storage). &nbsp;·&nbsp; <b>Logout</b> → <code>client.user.logout()</code> (revoke
              + <code>end_session_endpoint</code>).
            </p>
          </div>
        )}

        <section id="sdk-mfa" style={styles.card}>
          <div style={styles.cardH}>MFA journey integration <span style={styles.tag('out')}>PingOne MFA</span></div>
          <p style={{ color: C.muted, marginTop: 0 }}>MFA is a checkpoint on an existing session, not a second login. This page does not redirect: trigger the protected action, let PingOne policy challenge the current subject, then verify the returned <code>acr</code>/<code>amr</code> claims.</p>
          <div style={{ ...styles.row, marginTop: 10 }}><button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={startMfaCheckpoint} disabled={busy}>Run MFA checkpoint</button><span style={{ ...styles.note, marginTop: 0 }}>No login redirect; no MFA secret is stored in this browser.</span></div>
        </section>

        {error && (
          <div style={styles.banner(false)}>
            <b>Error:</b> {error}
          </div>
        )}
        {notice && <div style={styles.banner(notice.ok)}>{notice.text}</div>}
      </div>
    </div>
  );
}
