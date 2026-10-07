// cimdPrivilegeData.js — content for /cimd-privilege under Diagrams.
//
// Two figures, both drawn by StaticFlowDiagram and stepped by the shared Play/Step bar:
//   FLOW          how a client that identifies itself by a document URL gets into Privilege
//   CAPABILITIES  what that identity gives us
//
// Every step carries a status. "observed" means we saw it in the Privilege console or on the live host;
// "expected" means it follows from the CIMD design but has not been exercised with our own documents.
// Keep the evidence line honest: it is the reason the page can be shown to others without overclaiming.

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DOWN = { vertical: true };

const step = (key, edges, title, status, what, why, evidence) => ({ key, edges, title, status, what, why, evidence });

export const STATUS = { observed: "Observed", expected: "Expected" };

// ---------------------------------------------------------------------------------------------
// Figure 1: how it works
// ---------------------------------------------------------------------------------------------
// Group keys are the ones PersonalAgent.css already styles (.pa-sw--traveller, --priv, --ag, --ping, --team),
// so the legend needs no inline colour and no new stylesheet.
export const FLOW_GROUPS = {
  traveller: { label: "AI client or agent", bg: "var(--th-text-muted)" },
  priv: { label: "PingOne Privilege", bg: "var(--th-status-error)" },
  ag: { label: "Client document", bg: "var(--th-status-info)" },
  ping: { label: "PingOne sign-in", bg: "var(--th-status-warning)" },
  team: { label: "MCP server", bg: "var(--th-status-success)" },
};

export const FLOW_NODES = [
  N("list", "priv", "MCP Client Documents list", ["Settings tab in the console", "only listed URLs are accepted"], 290, 0),
  N("doc", "ag", "Client document", ["JSON at an https URL", "name, redirect URIs, grants"], 580, 0),
  N("client", "traveller", "AI client or agent", ["Claude, ChatGPT or our agents", "client_id is the document URL"], 0, 200),
  N("priv", "priv", "PingOne Privilege", ["authorization server", "for MCP clients"], 290, 200),
  N("mcp", "team", "MCP server", ["behind Privilege", "gets the token + client identity"], 580, 200),
  N("redirect", "traveller", "Client's redirect URI", ["where the code is delivered", "must appear in the document"], 0, 400),
  N("user", "ping", "PingOne sign-in", ["user signs in and consents", "consent names the client"], 580, 400),
];

export const FLOW_EDGES = [
  E("client", "priv", "authorize"), // 0
  E("list", "priv", "is the URL listed?", DOWN), // 1
  E("priv", "doc", "fetch the document"), // 2
  E("priv", "user", "sign in and consent"), // 3
  E("user", "redirect", "code to redirect URI"), // 4
  E("redirect", "priv", "exchange code (PKCE)"), // 5
  E("priv", "mcp", "tool call"), // 6
];

export const FLOW_STEPS = [
  step(
    "authorize",
    [0],
    "The client starts a sign-in with its document URL",
    "expected",
    "The client asks Privilege to sign a user in and sets client_id to the web address of its document, not to an id Privilege handed out.",
    "No registration step comes first. The address is the identity, and its owner controls what is published there.",
    "From the CIMD design. Privilege has been shown to fetch a document, not to run an authorize request that names one."
  ),
  step(
    "list",
    [1],
    "Privilege checks the URL against its list",
    "observed",
    "Privilege looks for the URL on the MCP Client Documents list. Only listed URLs are accepted, and an empty list turns the feature off.",
    "Anyone can host a file. The list is what turns that into \"only clients an admin chose\".",
    "The tab exists and states this rule, and we added Claude's document to it. Rejecting an unlisted URL at authorize time has not been tried."
  ),
  step(
    "fetch",
    [2],
    "Privilege fetches and reads the document",
    "observed",
    "Privilege fetches the URL itself. Public documents are fetched centrally. Private ones are fetched by the gateway and cached for the number of hours set on the tab.",
    "Privilege learns the client's name and its allowed redirect addresses from the client's own file, with no secret exchanged.",
    "Seen with Claude's own document: Status \"Fetched\", the name and one redirect URI. A wrong URL showed \"404 Not Found\". Our documents are live and return 200, but Privilege has not fetched one yet."
  ),
  step(
    "signin",
    [3],
    "The user signs in and approves",
    "expected",
    "Privilege signs the user in at PingOne and shows a consent step that names the client, using the client_name from its document.",
    "The person approving can see which agent is asking, not an anonymous registration.",
    "Not yet seen. Whether the consent screen shows the document's client_name is unconfirmed."
  ),
  step(
    "code",
    [4],
    "The code goes only to a declared address",
    "expected",
    "Privilege sends the browser back to the client's redirect URI with an authorization code, and only if that address appears in the document.",
    "A code cannot be delivered to an address the client's owner did not declare.",
    "Our redirect URI is our own choice: the BFF's /api/external-agents/callback. Whether Privilege accepts it is the main open test."
  ),
  step(
    "exchange",
    [5],
    "The client exchanges the code, with no secret",
    "expected",
    "The client posts the code and its PKCE verifier to Privilege's token endpoint. It is a public client, so there is no client secret.",
    "Nothing stored on the client can be stolen and reused. PKCE proves the same client that started the sign-in finishes it.",
    "From the document's declared token_endpoint_auth_method of none. Not yet exercised against Privilege."
  ),
  step(
    "call",
    [6],
    "The tool call arrives as a known client",
    "expected",
    "The client calls the MCP server through Privilege with its token. Privilege applies the same allow and deny it applies to any client, now to a client with a stable name.",
    "Policy can be written against one named agent, not against whoever registered last.",
    "Per our Personal Agent notes, Privilege's per-client allowlists and claim-based policy are preview features. Keying them on a document URL is untested."
  ),
];

// ---------------------------------------------------------------------------------------------
// Figure 2: what it can do
// ---------------------------------------------------------------------------------------------
// ag = the document, ok = observed, ping = expected: the keys PersonalAgent.css already styles.
export const CAP_GROUPS = {
  ag: { label: "The client document", bg: "var(--th-status-info)" },
  ok: { label: "Observed", bg: "var(--th-status-success)" },
  ping: { label: "Expected, not yet exercised", bg: "var(--th-status-warning)" },
};

export const CAP_NODES = [
  N("url", "ag", "Client document URL", ["one https address per agent", "published by the agent's owner"], 0, 200),
  N("name", "ok", "Named identity", ["client_name read from the document", "stable across restarts"], 290, 0),
  N("allow", "ok", "Admin allow-list", ["only listed URLs are accepted", "empty list turns it off"], 290, 200),
  N("nosecret", "ok", "No client secret", ["public client with PKCE", "nothing to store or rotate"], 290, 400),
  N("policy", "ping", "Per-client policy", ["allow or deny tools by client", "keyed on the stable client_id"], 580, 0),
  N("sprawl", "ok", "Admission by URL", ["a client is recognised", "without calling /register"], 580, 200),
  N("same", "ok", "Same door as real clients", ["Claude publishes such a document", "Privilege fetched and read it"], 580, 400),
  N("audit", "ping", "Audit by client", ["sessions and logs can name", "the client, not just a client"], 870, 0),
];

export const CAP_EDGES = [
  E("url", "name", "names it"), // 0
  E("url", "allow", "checked by"), // 1
  E("url", "nosecret", "public client"), // 2
  E("name", "policy", "client_id key"), // 3
  E("allow", "sprawl", "admits"), // 4
  E("nosecret", "same", "like Claude's"), // 5
  E("policy", "audit", "names client"), // 6
];

export const CAP_STEPS = [
  step(
    "named",
    [0],
    "A named identity for each agent",
    "observed",
    "Each of our agents publishes a document whose client_name Privilege can read. The tab shows that name once the document is fetched.",
    "An agent is something you can point at in the console, not an anonymous registration among many.",
    "Privilege showed \"Claude\" after fetching Claude's document. Our 17 documents are served with their names on the live host."
  ),
  step(
    "allowlist",
    [1],
    "An admin decides which clients are accepted",
    "observed",
    "Privilege accepts only the URLs on its list. Leaving the list empty switches the feature off, and clients that do not use it register as before.",
    "Adding or removing an agent is one row, controlled by the gateway admin, not by whoever hosts a file.",
    "Stated on the tab and visible in the edit form. Rejection of an unlisted URL has not been tried."
  ),
  step(
    "secretless",
    [2],
    "No secret to store, leak or rotate",
    "observed",
    "Our documents declare token_endpoint_auth_method none. The client is public and proves its sign-in with PKCE instead of a secret.",
    "There is no client secret to put in a vault or rotate, and none to lose.",
    "Our documents carry no secret, checked on the live host. Privilege treating them as public clients is expected, not yet seen."
  ),
  step(
    "policy",
    [3],
    "Policy can target one named client",
    "expected",
    "Because the client_id is a stable address, Privilege's per-client rules and tool allowlists can name it directly.",
    "A single agent can be limited to the tools it needs, and a compromised one can be cut off by removing its row.",
    "Per our Personal Agent notes these Privilege features are in preview. Using a document URL as the key has not been tested."
  ),
  step(
    "bydoc",
    [4],
    "Recognised without open registration",
    "observed",
    "A listed client is recognised by its URL. It does not have to call the registration endpoint to become known.",
    "Fewer anonymous client records pile up, and the ones that matter are named and listed.",
    "The tab describes this behaviour. It does not switch dynamic registration off for other clients."
  ),
  step(
    "real",
    [5],
    "The same mechanism real MCP clients use",
    "observed",
    "Claude publishes a client document at claude.ai/oauth/mcp-oauth-client-metadata, and Privilege fetched and read it. Our agents publish the same kind of file.",
    "Our agents identify themselves the way production MCP clients do, which makes the demo a faithful one.",
    "Privilege's Status for Claude's document: Fetched, one redirect URI."
  ),
  step(
    "audit",
    [6],
    "Audit that names the client",
    "expected",
    "Allow and deny decisions and session logs can carry the client's name from its document, not only a registration id.",
    "After an incident you can say which agent did what.",
    "Not yet checked in Privilege's logs."
  ),
];

export const ASSUMPTIONS = [
  "Only steps marked Observed were seen. Everything marked Expected follows from the CIMD design and is still to be run with our own documents.",
  "Our redirect URI is a guess: each document points at the BFF's /api/external-agents/callback on the serving origin. If Privilege rejects it, the fix is one line in the route.",
  "Our server-side agents authenticate with client credentials and token exchange, not an interactive browser sign-in. A document that describes an authorization_code client may suit interactive MCP clients better.",
  "The documents are public on the SE host through 17 exact paths. That list is kept in three places: the ingress, the BFF gate and a checker script.",
];
