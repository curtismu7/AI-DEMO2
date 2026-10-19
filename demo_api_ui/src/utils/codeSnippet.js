// The Code tab: the Node 18+ fetch call behind a step, rebuilt from the request the page shows.
// Tokens and secrets are never in that request (the server redacts them) and never in the snippet:
// they become placeholders the reader fills in from their own run.

const PLACEHOLDER = { subject_token: "SUBJECT_TOKEN", token: "SUBJECT_TOKEN", assertion: "ID_JAG", client_secret: "CLIENT_SECRET", client_id: "CLIENT_ID" };
// Any field named like a credential, any [redacted] label and any JWT-looking value becomes a placeholder, even if
// the request handed in carries a real one (subject_token_type and token_type_hint are not credentials).
const SECRET_KEY = /(^|_)(token|secret|assertion|password|verifier)$/i;
const JWT_VALUE = /^eyJ[\w-]*\.[\w-]*\./;
const hidden = (k, v) => !!k && (!!PLACEHOLDER[k] || SECRET_KEY.test(k) || (typeof v === "string" && (/^\[.*\]$/.test(v) || JWT_VALUE.test(v))));
const placeholder = (k) => PLACEHOLDER[k] || k.toUpperCase();
const q = (v) => JSON.stringify(String(v));

function bearer(authorization) {
  if (!authorization || authorization === "none") return null;
  if (/^basic/i.test(authorization)) return '"Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)';
  return /id-jag/i.test(authorization) ? "`Bearer ${ID_JAG}`" : "`Bearer ${ACCESS_TOKEN}`";
}

/** `request` is `{ endpoint: "POST <url>", body, authorization? }` or `{ method, url, authorization }`. */
export function codeSnippet(request) {
  const [verb, rawUrl] = request.endpoint ? request.endpoint.split(/\s+/, 2) : [request.method || "GET", request.url];
  const url = String(rawUrl).split(/[?#]/)[0]; // a query string could carry a token
  const body = request.body && typeof request.body === "object" ? request.body : null;
  const json = !!body?.jsonrpc;
  const headers = [];
  if (body && json) headers.push('"Content-Type": "application/json"', 'Accept: "application/json, text/event-stream"');
  if (body && !json) headers.push('"Content-Type": "application/x-www-form-urlencoded"');
  // A form that names a client_id authenticates the client with HTTP Basic, as this app's server does.
  const auth = bearer(request.authorization) || (body && !json && body.client_id !== undefined ? bearer("Basic") : null);
  if (auth) headers.push(`Authorization: ${auth}`);

  let bodyLine = null;
  if (body && json) {
    const safe = JSON.stringify(body, (k, v) => (hidden(k, v) ? placeholder(k) : v), 2).replace(/\n/g, "\n  ");
    bodyLine = `  body: JSON.stringify(${safe}),`;
  } else if (body) {
    const fields = Object.entries(body).filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `    ${k}: ${hidden(k, String(v)) ? placeholder(k) : q(v)},`);
    bodyLine = `  body: new URLSearchParams({\n${fields.join("\n")}\n  }),`;
  }
  const opts = [
    verb.toUpperCase() !== "GET" ? `  method: ${q(verb.toUpperCase())},` : null,
    headers.length ? `  headers: {\n${headers.map((h) => `    ${h},`).join("\n")}\n  },` : null,
    bodyLine,
  ].filter(Boolean);
  const call = opts.length ? `fetch(${q(url)}, {\n${opts.join("\n")}\n})` : `fetch(${q(url)})`;
  return `const res = await ${call};\nconst data = await res.json();`;
}
