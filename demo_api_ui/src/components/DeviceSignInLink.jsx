import { openSignIn } from "../utils/signInService";

const HELP = "Opens the app's main sign-in, which can send a code to your device or an approval link instead of asking for a password.";

// Shown on the alternate sign-in screens (SDK, DaVinci, AIC): hands off to the
// app's main sign-in pop-up. compact (top nav): the helper line becomes the tooltip.
export default function DeviceSignInLink({ compact = false }) {
  const open = () => openSignIn({ returnTo: `${window.location.pathname}${window.location.search || ""}`, force: true });
  return (
    <p className="device-signin-link" style={compact ? { margin: 0 } : { margin: "8px 0", fontSize: 13 }}>
      <button
        type="button"
        onClick={open}
        title={compact ? HELP : undefined}
        style={{ background: "none", border: 0, padding: 0, color: compact ? "#fff" : "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit", fontWeight: 600 }}
      >
        Sign in with a device or an approval link
      </button>
      {!compact && <span style={{ display: "block", opacity: 0.8 }}>{HELP}</span>}
    </p>
  );
}
