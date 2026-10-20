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
const TOKEN = { dashed: true }; // pingStyle: dashed blue = a token, code or decision handed back
const TOKEN_DOWN = { vertical: true, dashed: true };

const step = (key, edges, title, status, what, why, evidence) => ({ key, edges, title, status, what, why, evidence });

export const STATUS = { observed: "Observed", expected: "Expected" };

// ---------------------------------------------------------------------------------------------
// Figure 1: how it works
// ---------------------------------------------------------------------------------------------
// Ping palette: red = Ping products, dark = what the team builds, grey = what sits outside (the client and its document).
export const FLOW_GROUPS = {
  traveller: { label: "AI client or agent", bg: "#5a5f69" },
  priv: { label: "PingOne Privilege", bg: "#b5231a" },
  ag: { label: "Client document", bg: "#5a5f69" },
  ping: { label: "PingOne sign-in", bg: "#b5231a" },
  team: { label: "MCP server", bg: "#151a24" },
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
  E("list", "priv", "is the URL listed?", TOKEN_DOWN), // 1
  E("priv", "doc", "fetch the document"), // 2
  E("priv", "user", "sign in and consent"), // 3
  E("user", "redirect", "code to redirect URI", TOKEN), // 4
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
    "From the CIMD design. Privilege has fetched documents, including ours, but no authorize request naming one has been run yet. The client page now has a Client identity switch that sends our document URL as the client_id."
  ),
  step(
    "list",
    [1],
    "Privilege checks the URL against its list",
    "observed",
    "Privilege looks for the URL on the MCP Client Documents list. Only listed URLs are accepted, and an empty list turns the feature off.",
    "Anyone can host a file. The list is what turns that into \"only clients an admin chose\".",
    "Seen at authorize time: a sign-in naming a document URL that is not on the list was refused with \"This client is not approved for use here ... is not listed for this tenant\", and the message names the exact URL for an administrator to add under Settings, MCP Client Documents."
  ),
  step(
    "fetch",
    [2],
    "Privilege fetches and reads the document",
    "observed",
    "Privilege fetches the URL itself. Public documents are fetched centrally. Private ones are fetched by the gateway and cached for the number of hours set on the tab.",
    "Privilege learns the client's name and its allowed redirect addresses from the client's own file, with no secret exchanged.",
    "Seen with Claude's document and with ours: Status \"Fetched\", the client's name and one redirect URI (ours read \"AI Demo Privilege MCP Client\"). A wrong URL showed \"404 Not Found\"."
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
    "Privilege read our document, which lists this client's /api/privilege-mcp/auth/callback, and reported one redirect URI. Whether it enforces that list when a sign-in arrives has not been seen."
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
// ag = the document, ok = observed, ping = expected. Ping palette: red = the document everything hangs on,
// dark = seen in the console or on the live host, grey = follows from the design, not yet exercised.
export const CAP_GROUPS = {
  ag: { label: "The client document", bg: "#b5231a" },
  ok: { label: "Observed", bg: "#151a24" },
  ping: { label: "Expected, not yet exercised", bg: "#5a5f69" },
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
  E("allow", "sprawl", "admits", TOKEN), // 4
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
    "Privilege showed \"Claude\" for Claude's document and \"AI Demo Privilege MCP Client\" for ours. All 18 of our documents are served with their names on the live host; so far only the Privilege MCP client's has been listed in Privilege."
  ),
  step(
    "allowlist",
    [1],
    "An admin decides which clients are accepted",
    "observed",
    "Privilege accepts only the URLs on its list. Leaving the list empty switches the feature off, and clients that do not use it register as before.",
    "Adding or removing an agent is one row, controlled by the gateway admin, not by whoever hosts a file.",
    "Stated on the tab, and enforced: a local sign-in with an unlisted document URL was refused as \"not listed for this tenant\"."
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
  "Only steps marked Observed were seen. Everything marked Expected follows from the CIMD design and is still to be run: no sign-in with a document URL has completed yet.",
  "Privilege has read our Privilege MCP client document and enforces the client list at authorize time. Whether it enforces the document's redirect list when a listed client signs in, and whether the other 17 agents' shared callback suits them, is untested.",
  "A local stack cannot be listed itself: Privilege cannot fetch localhost. It signs in with the public host's document as its client_id (PRIVILEGE_CIMD_DOCUMENT_ORIGIN), and that document also lists the local callback, so the browser can still come back to your machine.",
  "Our server-side agents authenticate with client credentials and token exchange, not an interactive browser sign-in. A document that describes an authorization_code client may suit interactive MCP clients better.",
  "The documents are public on the SE host through 18 exact paths. That list is kept in three places: the ingress, the BFF gate and a checker script.",
];
