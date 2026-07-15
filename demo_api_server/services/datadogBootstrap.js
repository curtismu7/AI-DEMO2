// demo_api_server/services/datadogBootstrap.js
/**
 * Datadog scaffold — no-op unless DD_TRACE_ENABLED=true and DD_API_KEY is set.
 * Optional dependency: require("dd-trace") only when enabled. Local/CI must run
 * without Datadog credentials (see docs/observability/datadog-scaffold.md).
 */

function bootstrapDatadog() {
  const enabled =
    String(process.env.DD_TRACE_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    return { enabled: false, reason: "DD_TRACE_ENABLED not true" };
  }
  if (!process.env.DD_API_KEY) {
    console.warn(
      "[datadog] DD_TRACE_ENABLED=true but DD_API_KEY missing — skipping tracer",
    );
    return { enabled: false, reason: "missing DD_API_KEY" };
  }
  try {
    // Optional — not required in package.json for default installs.
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const tracer = require("dd-trace");
    tracer.init({
      service: process.env.DD_SERVICE || "banking-demo-bff",
      env: process.env.DD_ENV || process.env.NODE_ENV || "development",
      version: process.env.DD_VERSION || undefined,
      logInjection:
        String(process.env.DD_LOGS_INJECTION || "true").toLowerCase() !==
        "false",
    });
    console.log("[datadog] tracer initialized");
    return { enabled: true };
  } catch (err) {
    console.warn(
      "[datadog] dd-trace not installed or failed to init:",
      err.message,
    );
    return { enabled: false, reason: err.message };
  }
}

module.exports = { bootstrapDatadog };
