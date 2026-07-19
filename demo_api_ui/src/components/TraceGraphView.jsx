// demo_api_ui/src/components/TraceGraphView.jsx
import React from "react";
import TraceGraphCore from "./TraceGraphCore";

/** Interactive service graph for one trace — thin wrapper over TraceGraphCore. */
export default function TraceGraphView({ traceId }) {
  return <TraceGraphCore rawUrl={`/api/health/tracing/traces/${traceId}/raw`} />;
}
