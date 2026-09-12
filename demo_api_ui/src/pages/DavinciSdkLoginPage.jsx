// /davinci-sdk-login — runs a DaVinci flow with the Ping Orchestration SDK and
// renders the flow's collectors as our own UI.
//
// Deliberately does NOT touch /davinci-login (the hosted-widget page) or any
// file in REGRESSION_PLAN §1. Parallel route, parallel BFF endpoints.
//
// Scope today: TextCollector, PasswordCollector, SubmitCollector — enough to
// drive the flow's Password Sign On Page. CollectorField renders a visible
// fallback for anything else rather than omitting a field silently.
//
// Debugging goes through the SDK's own logger (see davinciSdkClient.js), which
// narrates what the SDK decided. `trace` below collects those entries; the live
// trace panel will render them, and until then they are one console call away.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CollectorField from "../components/davinci/CollectorField";
import {
  fetchSdkConfig,
  initClient,
  postCallback,
  takePkceVerifier,
} from "../lib/davinciSdkClient";
import "./DavinciSdkLoginPage.css";

export default function DavinciSdkLoginPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState("loading"); // loading | collecting | notConfigured | failed | done
  const [message, setMessage] = useState(null);
  const [missing, setMissing] = useState(null);
  const [collectors, setCollectors] = useState([]);
  const [values, setValues] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const clientRef = useRef(null);
  const cfgRef = useRef(null);
  const traceRef = useRef([]);
  // StrictMode double-invokes effects; starting the flow twice would burn two
  // nonces and leave the first flow orphaned.
  const startedRef = useRef(false);

  const onTrace = useCallback((entry) => {
    traceRef.current.push(entry);
  }, []);

  // Reads collectors off the client rather than off the node, because
  // getCollectors() is the supported accessor and an error node still carries
  // its collectors — which is what lets the form re-render with complaints.
  const syncFromClient = useCallback((client, node) => {
    setCollectors(client.getCollectors?.() || []);
    const errs = {};
    if (node?.status === "error") {
      for (const ec of client.getErrorCollectors?.() || []) {
        if (ec?.target) errs[ec.target] = ec.message;
      }
    }
    setFieldErrors(errs);
    setMessage(node?.status === "error" ? client.getError?.()?.message || null : null);
  }, []);

  const start = useCallback(async () => {
    setPhase("loading");
    setMessage(null);
    setMissing(null);
    try {
      const cfg = await fetchSdkConfig();
      cfgRef.current = cfg;
      const client = await initClient(cfg, { onTrace });
      clientRef.current = client;

      const node = await client.start({ query: { nonce: cfg.nonce } });
      if (node?.status === "failure") {
        // A 5XX or an unparseable payload lands here, not on 'error'. The SDK
        // logs "Response of 5XX indicates unrecoverable failure"; its own error
        // message is often empty, so say something useful instead of blank.
        setMessage(
          client.getError?.()?.message ||
            "The flow could not be started. It may not be deployed, or not enabled for PingOne.",
        );
        setPhase("failed");
        return;
      }
      syncFromClient(client, node);
      setPhase("collecting");
    } catch (err) {
      if (err.notConfigured) {
        setMissing(err.missing);
        setMessage(err.message);
        setPhase("notConfigured");
        return;
      }
      setMessage(err.message);
      setPhase("failed");
    }
  }, [onTrace, syncFromClient]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start();
  }, [start]);

  const finish = useCallback(async (client) => {
    const code = client.getClient?.()?.authorization?.code;
    if (!code) throw new Error("The flow succeeded but returned no authorization code.");
    // The SDK owns the PKCE verifier; the BFF does the exchange and holds the
    // tokens, so the verifier has to travel with the code.
    const codeVerifier = takePkceVerifier(cfgRef.current.clientId);
    await postCallback({ code, codeVerifier });
    setPhase("done");
    navigate("/davinci-login/confirmed", { replace: true });
  }, [navigate]);

  // A FlowCollector branches the flow instead of submitting this screen, so it
  // must NOT go through submit() — no values are written and next() is not
  // called. client.flow({action}) returns the initiator to invoke.
  const takeFlow = useCallback(async (collector) => {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      const node = await client.flow({ action: collector.output?.key ?? collector.name })();
      if (node?.status === "failure") {
        setMessage(client.getError?.()?.message || "That path could not be started.");
        setPhase("failed");
        return;
      }
      setValues({});
      syncFromClient(client, node);
      setPhase("collecting");
    } catch (err) {
      setMessage(err.message);
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }, [syncFromClient]);

  const submit = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setBusy(true);
    setMessage(null);
    try {
      // Write every collected value through its updater. NEVER by assignment —
      // the SDK state is frozen and assignment is a silent no-op. The updater
      // returns an error object that has to be checked.
      const writeErrors = {};
      for (const c of client.getCollectors?.() || []) {
        const key = c.output?.key ?? c.name;
        if (c.category === "ActionCollector" || !(key in values)) continue;
        const err = client.update(c)(values[key]);
        if (err && "error" in err) writeErrors[key] = err.error?.message || "Could not accept this value.";
      }
      if (Object.keys(writeErrors).length) {
        setFieldErrors(writeErrors);
        return;
      }

      const node = await client.next();
      if (node?.status === "success") {
        await finish(client);
        return;
      }
      if (node?.status === "failure") {
        setMessage(client.getError?.()?.message || "The flow ended without signing in.");
        setPhase("failed");
        return;
      }
      // 'continue' and 'error' both re-render; 'error' carries field messages.
      setValues({});
      syncFromClient(client, node);
      setPhase("collecting");
    } catch (err) {
      setMessage(err.message);
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }, [values, finish, syncFromClient]);

  return (
    <div className="dvsdk-page">
      <h1 className="dvsdk-title">DaVinci SDK Login</h1>
      <p className="dvsdk-sub">
        The flow&rsquo;s collectors, rendered by this app rather than by DaVinci.
      </p>

      {phase === "loading" && <p className="dvsdk-status">Starting the flow...</p>}

      {phase === "notConfigured" && (
        <div className="dvsdk-notice">
          <p className="dvsdk-notice-title">Not configured</p>
          <p>{message}</p>
          {missing?.length > 0 && (
            <ul className="dvsdk-missing">
              {missing.map((m) => (
                <li key={m}>
                  <code>{m}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {phase === "failed" && (
        <div className="dvsdk-error">
          <p>{message}</p>
          <button type="button" className="dvsdk-retry" onClick={start}>
            Try again
          </button>
        </div>
      )}

      {phase === "collecting" && (
        <form
          className="dvsdk-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {message && <p className="dvsdk-form-error">{message}</p>}
          {collectors.map((c) => {
            const key = c.output?.key ?? c.name ?? c.id;
            return (
              <CollectorField
                key={c.id ?? key}
                collector={c}
                value={values[key]}
                error={fieldErrors[key]}
                busy={busy}
                onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                onSubmit={submit}
                onFlow={() => takeFlow(c)}
              />
            );
          })}
        </form>
      )}
    </div>
  );
}
