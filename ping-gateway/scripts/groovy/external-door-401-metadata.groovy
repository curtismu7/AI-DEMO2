/*
 * external-door-401-metadata.groovy — appends the RFC 9728 resource_metadata
 * hint to the external door's 401 challenge, pointing at the BARE
 * /.well-known/oauth-protected-resource path (never a path-suffixed
 * variant): that matches exactly what oauth-mcp's own HttpMCPTransport
 * already advertises on its own 401s, and that bare path is already
 * routed straight to mcp-server at the ingress layer (se-ingress.yaml),
 * bypassing this gateway entirely and answering with the correct identity.
 *
 * Deliberately NOT McpProtectionFilter: that filter auto-registers a
 * well-known handler keyed by resourceId's PATH ONLY, globally across the
 * whole IG instance — colliding with the internal route's own registration
 * (both resourceIds end in "/mcp", different hosts) and taking down
 * mcp-olb-primary entirely (see the revert in PR #2276, and don't repeat
 * that mistake here). This script only rewrites a response header on its
 * way back out; it registers nothing.
 */

def base = System.getenv('OAUTH_MCP_ISSUER_URI') ?: ''
def metadataUrl = base ? (base.replaceAll(/\/+$/, '') + '/.well-known/oauth-protected-resource') : ''

return next.handle(context, request).thenOnResult { rsp ->
    if (rsp.status.code == 401 && metadataUrl) {
        def existing = (rsp.headers.getFirst('WWW-Authenticate') ?: 'Bearer').trim()
        if (!existing.contains('resource_metadata')) {
            // RFC 7235: a challenge is `scheme` followed by COMMA-separated
            // auth-params — so the comma belongs between two params, never
            // between the bare scheme and the first one. The external door's
            // upstream answers with a param-less `Bearer`, and appending
            // ", resource_metadata=..." to that emitted
            //     WWW-Authenticate: Bearer , resource_metadata="..."
            // whose first auth-param is EMPTY. Strict parsers reject the whole
            // header, so the client never extracts the hint and cannot begin
            // discovery — LM Studio's MCP bridge dies at "authentication
            // required" on this door while the doors that emit
            // `Bearer resource_metadata="..."` (space) or
            // `Bearer scope="x", resource_metadata="..."` (comma, params
            // already present) authenticate fine. Pick the separator from
            // whether a param is actually there to separate from.
            def sep = existing.contains('=') ? ', ' : ' '
            rsp.headers.put('WWW-Authenticate', existing + sep + 'resource_metadata="' + metadataUrl + '"')
        }
    }
}
