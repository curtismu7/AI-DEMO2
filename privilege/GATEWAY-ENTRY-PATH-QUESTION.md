# Question for Ping: AI Gateway now rejects `/<app>/mcp` for apps registered with an `/sse` backend

**Date observed:** 2026-09-07
**Gateway:** `mcpgw.ai-demo.ping-devops.com` — Helm release `agentless-mcpgw`, namespace `ping-devops-curtismuir`, cluster `ai-demo-cmuir`
**PingOne tenant:** `0428ba4f-169c-436b-aff9-b230496e0e3b` ("AI Agent")
**Pod:** `agentless-mcpgw-bccddc664-s7zbt`, 5/5 Running, 0 restarts, rebuilt ~6h before this observation

## Summary

MCP clients calling `https://mcpgw.ai-demo.ping-devops.com/<app>/mcp` now receive
`404 Not found` for the two Agentic Apps whose **backend** is registered with the
`/sse` transport. The gateway appears to derive the **client-facing entry path**
from the backend URL's path, so a client may only call `/<app>/sse`.

This is a behaviour change for us: these apps previously served `/<app>/mcp` to
clients, which is also the client URL the Ping-supplied guidance we followed
documents (`https://mcpgw.ai-demo.ping-devops.com/<AgenticAppName>/mcp`).

**The question:** is the client-facing entry path intended to be tied to the
backend transport path? If so, how should an app whose backend must be `/sse`
(required for gateway discovery — see below) expose a Streamable-HTTP `/mcp`
endpoint to clients?

## Evidence

### The gateway resolves the app fine, then rejects the path

From `kubectl logs deployment/agentless-mcpgw -c log-tailer`:

```
level=info  msg="[mcpgw] resolved host for app opensearch22: opensearch22.default.applications.procyon.ai:8643"
level=warning msg="[mcpgw] rejecting /mcp on app opensearch22: outside entry path \"/sse\""
```

`mcpgw.go:430` resolves the host; `mcpgw.go:435` rejects the path. The app is
registered, its mesh route resolves, and the request carried a valid bearer —
the gateway had already accepted the token and logged
`Mcp-Method:[initialize]` before the rejection.

Counts over the last 3000 log lines:

```
 31 rejecting /mcp on app opensearch22: outside entry path "/sse"
  3 rejecting /mcp on app opensearch:   outside entry path "/sse"
```

Only these two apps are affected — they are the two registered with an `/sse`
backend.

### Auth is not the problem

A garbage bearer is rejected at the auth layer with `401`, so the `404` above is
reached only *after* successful authentication:

Sending an obviously invalid bearer (any junk string) in the `Authorization`
header of a POST to `/opensearch22/mcp`:

```
HTTP/2 401
www-authenticate: Bearer realm="MCP OAuth Server", resource_metadata=".../oauth-protected-resource/opensearch22/mcp", ...
{"error":"unauthorized","error_description":"Bearer token required", ...}
```

### Both paths advertise protected-resource metadata

The gateway serves RFC 9728 metadata for **both** paths, which is what makes the
`404` surprising — `/mcp` presents itself as a valid protected resource and then
refuses the request:

```
$ curl -s -o /dev/null -w '%{http_code}\n' \
    https://mcpgw.ai-demo.ping-devops.com/.well-known/oauth-protected-resource/opensearch22/mcp
200
$ curl -s -o /dev/null -w '%{http_code}\n' \
    https://mcpgw.ai-demo.ping-devops.com/.well-known/oauth-protected-resource/opensearch22/sse
200
```

`/opensearch22/sse` behaves as a working protected resource (401 + challenge on a
bad token), so the app is reachable there.

### The backend is healthy

```
$ kubectl -n ping-devops-curtismuir get pods
agentless-mcpgw-bccddc664-s7zbt                              5/5   Running   0   5h52m
opensearch-mcp-server-74645947d7-llgn7                       1/1   Running   0   6d
opensearch-7f7fcdfc88-h42vd                                  1/1   Running   0   6d
```

### Why the backend is registered as `/sse`

This is not an arbitrary choice on our side. Registering the backend as `/mcp`
makes gateway **discovery** fail: the gateway's discovery client issues a bare
`GET` and waits for the SSE `endpoint` event rather than POSTing `initialize`.
FastMCP answers `GET /mcp` with 200 but never emits that event, so the console
reports:

```
Gateway Unreachable — Error discovering MCP server: calling "initialize": sending "initialize": Unauthorized
```

and the app ends up with no tools and **policy creation disabled**. So `/sse` is
the only backend registration that yields a working app — which now appears to
force clients onto `/sse` as well.

## What we would like to know

1. Is entry-path derivation from the backend URL intended, or a regression in the
   current gateway build?
2. If intended: what is the supported way to register an app whose backend is
   `/sse` (required for discovery) while exposing `/mcp` to MCP clients, given
   that Streamable HTTP `/mcp` is what current MCP clients default to?
3. Was this changed in the build deployed on 2026-09-07? These apps served
   `/<app>/mcp` to clients before that.

## What we have NOT done

We deliberately have not worked around this by repointing our client at
`/<app>/sse` (an ~8-line change on our side), because we would rather understand
whether the gateway behaviour is intended before encoding a workaround into the
demo.
