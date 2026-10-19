// Run report: a Markdown and a JSON summary of the current playground run, built in the browser from
// what the page already shows (decoded claims, redacted requests). Never a raw token: the server never
// sends one, and anything JWT-shaped (say, a pasted ID-JAG) is replaced before the file is made.

const JWT = /eyJ[\w-]*\.[\w-]+\.[\w-]*/g;
const scrub = (value) => JSON.parse(JSON.stringify(value ?? null).replace(JWT, "[redacted JWT]"));
const cell = (v) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (head, rows) => (rows.length ? [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") : "_none_");
const kv = (obj) => table(["Name", "Value"], Object.entries(obj || {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v]));

/** { json, markdown } for one run. `run` holds the page state; nothing here is fetched. */
export function buildReport(run) {
  const c = run.config || {};
  const token = run.issued?.token || (run.inspection ? { header: run.inspection.header, claims: run.inspection.claims } : null);
  const json = scrub({
    generatedAt: new Date().toISOString(),
    mode: run.mode,
    modeLabel: run.modeLabel,
    endpoints: {
      idp: { name: c.idp?.name, issuer: c.idp?.issuer, tokenEndpoint: c.idp?.tokenEndpoint, jwksUrl: c.idp?.jwksUrl, exchangeClientId: c.idp?.exchangeClientId },
      resourceAs: c.resourceAs, request: c.request,
    },
    preflight: run.preflights || {},
    idJag: token,
    specChecks: run.inspection?.checks || [],
    issue: run.issued ? { request: run.issued.request, response: run.issued.response } : null,
    redeem: run.redeemed ? { request: run.redeemed.request, status: run.redeemed.status, response: run.redeemed.response, accessToken: run.redeemed.token } : null,
    mcp: { toolsList: run.tools || null, toolsCall: run.callResult || null },
    protectedResource: run.resource || null,
    negativeTests: (run.negatives || []).map(({ id, label, expect, result }) => ({ id, label, expect, result })),
  });

  const md = [`# ID-JAG playground run`, "", `- Mode: ${json.modeLabel || json.mode} (\`${json.mode}\`)`, `- Generated: ${json.generatedAt}`,
    "- Tokens: decoded claims only. Raw tokens never leave the server and are not in this report.", ""];
  md.push("## Endpoints", "", table(["Role", "Name", "Issuer", "Token endpoint", "Client"], [
    ["IdP (issues the ID-JAG)", json.endpoints.idp.name, json.endpoints.idp.issuer, json.endpoints.idp.tokenEndpoint, json.endpoints.idp.exchangeClientId],
    ["Resource AS (redeems it)", json.endpoints.resourceAs?.name, json.endpoints.resourceAs?.issuer, json.endpoints.resourceAs?.tokenEndpoint, json.endpoints.resourceAs?.clientId],
    ["MCP server (resource)", "", json.endpoints.request?.resource, "", ""],
  ]), "");
  md.push("## Preflight", "");
  const pre = Object.entries(json.preflight);
  if (!pre.length) md.push("_No preflight ran (Mock mode sends nothing, so it has nothing to check)._", "");
  for (const [step, p] of pre) md.push(`### ${step}: ${p.ok ? "ok" : "blocked"}`, "", table(["Check", "Result", "Detail", "Fix"], p.checks.map((x) => [x.label, x.status, x.detail, x.fix])), "");
  md.push("## ID-JAG (decoded)", "", json.idJag ? kv({ ...json.idJag.header && { header: json.idJag.header }, ...json.idJag.claims }) : "_No ID-JAG yet._", "");
  md.push("## Spec checks", "", table(["Check", "Result", "Expected", "Actual", "Rule"], json.specChecks.map((x) => [x.label, x.status, x.expected, x.actual, x.cite])), "");
  md.push("## Outcomes", "");
  md.push(`- Step 2, ID-JAG: ${json.idJag ? "issued" : "not yet"}`);
  const r = json.redeem;
  md.push(`- Step 3, redeem: ${r ? `HTTP ${r.status}${r.response?.error ? ` ${r.response.error}: ${r.response.error_description || ""}` : `, scope ${r.response?.scope || r.accessToken?.claims?.scope || "?"}`}` : "not yet"}`);
  const list = json.mcp.toolsList;
  md.push(`- Step 4, tools/list: ${list ? `${(list.tools || []).length} tools (${(list.tools || []).map((t) => t.name).join(", ") || "none"})${list.deniedTools?.length ? `; hidden: ${list.deniedTools.join(", ")}` : ""}` : "not yet"}`);
  md.push(`- Step 4, tools/call: ${json.mcp.toolsCall ? `${json.mcp.toolsCall.request?.body?.params?.name || "?"} → ${cell(json.mcp.toolsCall.result?.content?.[0]?.text ?? json.mcp.toolsCall.result)}` : "not yet"}`);
  const pr = json.protectedResource;
  const prFail = pr?.body?.verified?.find?.((v) => !v.ok);
  md.push(`- Protected resource: ${pr ? `HTTP ${pr.status} with ${pr.request?.authorization}${prFail ? ` (refused at ${prFail.check}: ${prFail.detail})` : pr.body?.principal ? ` (sub ${pr.body.principal.sub})` : ""}` : "not yet"}`, "");
  if (r?.accessToken) md.push("### Access token (decoded)", "", kv(r.accessToken.claims), "");
  md.push("## Negative tests", "", table(["Test", "Expects", "Result", "HTTP", "Error"], json.negativeTests.map((t) => [t.label, t.expect,
    !t.result ? "not run" : t.result.skipped ? "skipped" : t.result.pass ? "refused (pass)" : "not refused (fail)", t.result?.status, t.result?.error || t.result?.note])), "");
  return { json, markdown: md.join("\n").replace(JWT, "[redacted JWT]") };
}

/** Save text as a file: a Blob and a temporary a[download], from the user's click. */
export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
