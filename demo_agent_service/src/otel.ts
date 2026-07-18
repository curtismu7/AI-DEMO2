// SDK init via NODE_OPTIONS -r /otel/otel-instrument.js (scripts/otel-instrument.js)
// This file just exports the tracer reference for use in agent code.

import { trace } from '@opentelemetry/api';

export const tracer = trace.getTracer('banking-agent-service', '1.0.0');