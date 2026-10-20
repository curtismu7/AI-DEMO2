// Shared helpers for the Ping-style diagram configs whose arrows carry no token (telemetry, onboarding bookkeeping).
// A step detail is { form, tokens, noToken, refs }; the reason is also printed at the end of the form, which is what the
// step detail panel shows (same convention as externalDoorStandards.js).
export const noTokenDetail = (form, reason, refs) => ({
  form: `${form}\n\nToken: none. ${reason}`,
  tokens: [],
  noToken: reason,
  refs,
});

export const diagramStep = (key, edges, title, what, why, detail) => ({
  key, edges, title, what, ...(why ? { why } : {}), detail,
});
