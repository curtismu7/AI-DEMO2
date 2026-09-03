import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./DavinciLoginPage.css";

// Landing page after a successful DaVinci widget login (/davinci-login/confirmed).
// The callback route establishes a normal BFF session and redirects here rather
// than to "/", so the user gets an explicit confirmation of who they're signed
// in as instead of silently landing back on the app shell.

export default function DavinciLoginConfirmedPage() {
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load your session (HTTP ${res.status}).`);
        return res.json();
      })
      .then((body) => {
        setUser(body.user);
        setStatus("ok");
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, []);

  return (
    <div className="dvl-page">
      <h1 className="dvl-title">DaVinci Login</h1>

      {status === "loading" && <p className="dvl-status">Checking your session...</p>}
      {status === "error" && <div className="dvl-error">{error}</div>}

      {status === "ok" && user && (
        <div className="dvl-confirmed">
          <p className="dvl-confirmed-lede">Signed in via the DaVinci widget flow.</p>
          <dl className="dvl-confirmed-facts">
            <dt>Username</dt>
            <dd>{user.username}</dd>
            <dt>Role</dt>
            <dd>{user.role}</dd>
            {user.email && (
              <>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </>
            )}
          </dl>
          <Link className="dvl-retry" to="/">
            Continue to the app
          </Link>
        </div>
      )}
    </div>
  );
}
