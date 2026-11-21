// The standards a sequence step cites, as the movie reel's "Standards behind this step" list wants them: { id, kind, title, href }.
// A step stores only { spec, section?, note? }; the link is built here from a fixed table, so a diagram cannot carry an arbitrary URL.
const RFC_TITLES = {
  6749: "OAuth 2.0 Authorization Framework",
  6750: "OAuth 2.0 Bearer Token Usage",
  7519: "JSON Web Token (JWT)",
  7636: "Proof Key for Code Exchange (PKCE)",
  7662: "OAuth 2.0 Token Introspection",
  8414: "OAuth 2.0 Authorization Server Metadata",
  8693: "OAuth 2.0 Token Exchange",
  8725: "JWT Best Current Practices",
  9068: "JWT Profile for OAuth 2.0 Access Tokens",
  9110: "HTTP Semantics",
  9126: "OAuth 2.0 Pushed Authorization Requests",
};
const SPECS = {
  "CIBA Core 1.0": { title: "OpenID Connect Client-Initiated Backchannel Authentication Core 1.0", href: "https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html" },
  "OIDC Core 1.0": { title: "OpenID Connect Core 1.0", href: "https://openid.net/specs/openid-connect-core-1_0.html" },
  MCP: { title: "Model Context Protocol specification", href: "https://modelcontextprotocol.io/specification" },
};
const RFC = /^RFC (\d{3,5})$/;
const SECTION = /^[A-Za-z0-9.-]{1,16}$/;

/** True when `ref.spec` is an RFC number or one of the listed specs. */
export const isKnownSpec = (ref) => Boolean(ref && typeof ref.spec === "string" && (RFC.test(ref.spec) || Object.hasOwn(SPECS, ref.spec)));

export function resolveRefs(refs = []) {
  return refs.filter(isKnownSpec).map((r) => {
    const m = RFC.exec(r.spec);
    const section = r.section && SECTION.test(r.section) ? r.section : null;
    const id = `${r.spec}${section ? ` section ${section}` : ""}`;
    const title = [m ? RFC_TITLES[m[1]] || "" : SPECS[r.spec].title, r.note].filter(Boolean).join(". ");
    return { id, kind: m ? "rfc" : "spec", title, href: m ? `https://www.rfc-editor.org/rfc/rfc${m[1]}${section ? `#section-${section}` : ""}` : SPECS[r.spec].href };
  });
}
