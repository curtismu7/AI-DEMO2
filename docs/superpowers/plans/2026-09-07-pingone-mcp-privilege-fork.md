# PingOne MCP behind the Privilege AI Gateway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PingOne MCP server discoverable and callable behind the PingOne Privilege AI Gateway, by adding a `client_credentials` grant and an SSE transport to a fork of `pingidentity/pingone-mcp-server`.

**Architecture:** A GitHub fork with `upstream` as a git remote, carrying three additive patches that leave stdio/browser behaviour untouched. Its CI publishes an image to GHCR; AI-DEMO2 consumes the image only and contains none of the Go source. The gateway discovers the server over SSE in-cluster and applies policy in front of it.

**Tech Stack:** Go, `github.com/modelcontextprotocol/go-sdk v1.2.0`, `github.com/pingidentity/pingone-go-client`, Docker, Kubernetes (SE cluster namespace `ping-devops-cmuir`).

**Spec:** `docs/superpowers/specs/2026-09-07-pingone-mcp-privilege-fork-design.md`

## Global Constraints

- **Two repositories.** Tasks 1–3 are in the **fork** (`curtismu7/pingone-mcp-server`). Task 4 spans both. Tasks 5–6 are in **AI-DEMO2**. Every task states its repo.
- **All fork patches are additive.** With no new flags, the binary behaves exactly as upstream. Upstream's existing test suite staying green is a required check in every fork task.
- **Grant type string is `client_credentials`** — matching `pingoneOauth2.GrantTypeClientCredentials` in `pingidentity/pingone-go-client`.
- **The gateway entry path is `/sse`.** Registering `/mcp` produces "Gateway Unreachable — Error discovering MCP server: calling initialize: Unauthorized" with tools empty and policy creation disabled.
- **Never publish the service to the host, and never give it a cluster ingress.** It holds a worker credential with PingOne admin rights.
- **No secret values in commits, images, logs, or plan output.**
- AI-DEMO2 work happens in a git worktree, never the main checkout. Stage explicitly; never `git add -A`.

---

## Spec refinement discovered while planning

The spec's §3.2(b) assumed the fork must implement its own client-credentials token source ("POST to the PingOne AS token endpoint, hold the token in memory"). **It does not.** `pingidentity/pingone-go-client` already implements the grant (`oauth2/grant_type.go` defines `GrantTypeClientCredentials`, with an `examples/client_credentials/` in-tree), and the fork's `PingOneClientAuthWrapper` already delegates all token acquisition to that library. The change is one `case` in an existing `switch`.

A second, non-obvious change the spec did not name: `InitializeAuthContext` guards headless environments with

```go
if !authClient.BrowserLoginAvailable(grantType) && grantType != auth.GrantTypeDeviceCode {
    return nil, fmt.Errorf("browser login is not available in this environment and grant type %s cannot be used...")
}
```

`BrowserLoginAvailable` returns `false` for any unrecognised grant type, so in a container this guard rejects `client_credentials` before any token is requested. Task 1 must extend it or the feature silently cannot start.

Third: the spec's §6 asks for transparent refresh on expiry. No work is required
— `login.LoginIfNecessary` already compares `activeSession.Expiry` against now and
re-authenticates when it has passed. For `client_credentials` that re-acquisition
is silent (no user, no browser), so expiry is handled by existing code. Upstream's
`//TODO handle token refresh` refers to *refresh tokens*, which this grant does not
use. Do not build a refresh path.

---

## File Structure

**Fork (`curtismu7/pingone-mcp-server`):**

| File | Responsibility | Change |
|---|---|---|
| `internal/auth/grant_type.go` | Grant-type enum, `String()`, `ParseGrantType()` | Add `GrantTypeClientCredentials` |
| `internal/auth/client/wrapper.go` | Maps our grant type to the PingOne client's | Add one `case` |
| `internal/capabilities/initialize/auth_context.go` | Headless guard before login | Exempt client credentials |
| `internal/server/server.go` | Builds the MCP server; today always `server.Run(ctx, transport)` | Branch: stdio vs SSE listener |
| `cmd/run/run.go` | `run` command flags | Add `--transport`, `--listen` |
| `cmd/root.go:43-44` | Sole transport construction site | Pass flag values through |

**AI-DEMO2:**

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Local `pingone-mcp` service, unpublished |
| `k8s/aws/pingone-mcp.yaml` | Deployment, Service, NetworkPolicy for the SE cluster |
| `REGRESSION_PLAN.md` | §1 do-not-break entry for the security posture |

---

## Task 1: `client_credentials` grant type

**Repo:** fork (`curtismu7/pingone-mcp-server`)

**Files:**
- Modify: `internal/auth/grant_type.go`
- Modify: `internal/auth/client/wrapper.go`
- Modify: `internal/capabilities/initialize/auth_context.go`
- Test: `internal/auth/grant_type_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `auth.GrantTypeClientCredentials` (a `auth.GrantType` enum value whose `String()` is `"client_credentials"`), accepted by `auth.ParseGrantType("client_credentials")`. Tasks 3-5 pass this value through `--grant-type`.

- [ ] **Step 1: Fork the repository and add the upstream remote**

```bash
gh repo fork pingidentity/pingone-mcp-server --clone --remote
cd pingone-mcp-server
git remote -v          # expect: origin = curtismu7/..., upstream = pingidentity/...
git checkout -b feat/client-credentials-and-sse
```

- [ ] **Step 2: Establish the upstream baseline is green**

```bash
go test ./...
```

Expected: PASS. If upstream is already failing, stop and report — a red baseline makes "additive" unprovable.

- [ ] **Step 3: Write the failing test**

Create `internal/auth/grant_type_test.go` (if it exists, append these functions):

```go
// Copyright © 2026 Ping Identity Corporation

package auth

import "testing"

func TestGrantTypeClientCredentials_String(t *testing.T) {
	if got := GrantTypeClientCredentials.String(); got != "client_credentials" {
		t.Errorf("String() = %q, want %q", got, "client_credentials")
	}
}

func TestParseGrantType_ClientCredentials(t *testing.T) {
	got, err := ParseGrantType("client_credentials")
	if err != nil {
		t.Fatalf("ParseGrantType() unexpected error: %v", err)
	}
	if got != GrantTypeClientCredentials {
		t.Errorf("ParseGrantType() = %v, want GrantTypeClientCredentials", got)
	}
}

// The existing grant types must keep working — this is the additive claim.
func TestParseGrantType_UpstreamGrantsUnchanged(t *testing.T) {
	for input, want := range map[string]GrantType{
		"authorization_code": GrantTypeAuthorizationCode,
		"device_code":        GrantTypeDeviceCode,
	} {
		got, err := ParseGrantType(input)
		if err != nil {
			t.Fatalf("ParseGrantType(%q) unexpected error: %v", input, err)
		}
		if got != want {
			t.Errorf("ParseGrantType(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestParseGrantType_UnknownStillErrors(t *testing.T) {
	if _, err := ParseGrantType("magic_beans"); err == nil {
		t.Error("ParseGrantType(\"magic_beans\") = nil error, want an error")
	}
}
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
go test ./internal/auth/ -run 'ClientCredentials' -v
```

Expected: FAIL — `undefined: GrantTypeClientCredentials`.

- [ ] **Step 5: Add the enum value**

In `internal/auth/grant_type.go`, append to the const block and both switches. **Append `GrantTypeClientCredentials` last** so the existing iota values keep their numbers:

```go
const (
	_ GrantType = iota
	GrantTypeAuthorizationCode
	GrantTypeDeviceCode
	GrantTypeClientCredentials
)
```

In `String()`, add before `default`:

```go
	case GrantTypeClientCredentials:
		return "client_credentials"
```

In `ParseGrantType()`, add before `default`:

```go
	case "client_credentials":
		return GrantTypeClientCredentials, nil
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
go test ./internal/auth/ -v
```

Expected: PASS, including the three upstream-unchanged assertions.

- [ ] **Step 7: Map the grant type to the PingOne client**

In `internal/auth/client/wrapper.go`, inside `TokenSource`'s `switch grantType`, add before `default`:

```go
	case auth.GrantTypeClientCredentials:
		clientGrantType = pingoneOauth2.GrantTypeClientCredentials
```

No other change is needed here: `pingidentity/pingone-go-client` already implements this grant, and `configureHeadlessHandlers` only acts on `GrantTypeDeviceCode`, so client credentials passes through it untouched.

Leave `BrowserLoginAvailable` alone — returning `false` for client credentials is correct, because no browser is involved.

- [ ] **Step 8: Exempt client credentials from the headless guard**

This is the change that makes it work in a container. In `internal/capabilities/initialize/auth_context.go`, replace the guard:

```go
	// If the browser login is not available, and the grant type is not device code, return an error
	if !authClient.BrowserLoginAvailable(grantType) && grantType != auth.GrantTypeDeviceCode {
```

with:

```go
	// Browser-less grant types are fine without a browser. Device code prints
	// instructions instead of opening one; client credentials involves no user
	// at all. Any OTHER grant type without a browser is a real error.
	browserlessGrant := grantType == auth.GrantTypeDeviceCode || grantType == auth.GrantTypeClientCredentials
	if !authClient.BrowserLoginAvailable(grantType) && !browserlessGrant {
```

- [ ] **Step 9: Run the full suite to prove the patches are additive**

```bash
go test ./...
```

Expected: PASS, matching the Step 2 baseline. Any newly failing upstream test means the change was not additive — fix before continuing.

- [ ] **Step 10: Commit**

```bash
git add internal/auth/grant_type.go internal/auth/grant_type_test.go \
        internal/auth/client/wrapper.go \
        internal/capabilities/initialize/auth_context.go
git commit -m "feat(auth): add client_credentials grant type

The Privilege AI Gateway brokers auth server-side and cannot drive a browser
or a device-code prompt, so neither upstream grant type can be used behind it.

pingone-go-client already implements this grant, so TokenSource only needs the
enum mapping. The non-obvious part is InitializeAuthContext's headless guard,
which rejected any grant lacking a browser except device code — in a container
that rejected client credentials before a token was ever requested."
```

---

## Task 2: SSE transport

**Repo:** fork (`curtismu7/pingone-mcp-server`)

**Files:**
- Modify: `internal/server/server.go`
- Modify: `cmd/run/run.go`
- Modify: `cmd/root.go:43-44`
- Test: `internal/server/server_sse_test.go`

**Interfaces:**
- Consumes: `auth.GrantTypeClientCredentials` from Task 1.
- Produces: `run` accepts `--transport {stdio|sse}` (default `stdio`) and `--listen <addr>` (default `:8080`). When `--transport sse`, the process serves MCP over SSE at `/sse` on `--listen`. Task 4 runs exactly this.

- [ ] **Step 1: Write the failing test**

Create `internal/server/server_sse_test.go`. This asserts the one behaviour the gateway depends on — a bare `GET` yields an `endpoint` event as the first SSE event:

```go
// Copyright © 2026 Ping Identity Corporation

package server

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The Privilege AI Gateway's discovery client issues a bare GET and waits for an
// SSE `endpoint` event; it never POSTs initialize. If the first event is anything
// else, discovery fails with "Gateway Unreachable" and tools stay empty.
func TestSSEHandler_FirstEventIsEndpoint(t *testing.T) {
	srv := mcp.NewServer(&mcp.Implementation{
		Name:    "pingone-mcp-server",
		Title:   "PingOne MCP Server",
		Version: "test",
	}, nil)

	handler := mcp.NewSSEHandler(func(*http.Request) *mcp.Server { return srv })
	ts := httptest.NewServer(handler)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL, nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event:") {
			if got := strings.TrimSpace(strings.TrimPrefix(line, "event:")); got != "endpoint" {
				t.Fatalf("first SSE event = %q, want %q", got, "endpoint")
			}
			return
		}
	}
	t.Fatal("stream ended without any event line")
}
```

- [ ] **Step 2: Run the test to verify it compiles and passes against the SDK**

```bash
go test ./internal/server/ -run TestSSEHandler_FirstEventIsEndpoint -v
```

Expected: PASS. This test exercises the SDK directly, so it should pass immediately — it exists to pin the SDK contract the design depends on. **If it fails, stop:** the whole approach rests on this behaviour, and the spec's transport decision must be revisited.

- [ ] **Step 3: Add the SSE branch to `Start`**

In `internal/server/server.go`, add `"fmt"` and `"net/http"` to the imports, change the `Start` signature to accept the transport mode and listen address, and replace the final `server.Run` block.

Change the signature from:

```go
func Start(ctx context.Context, version string, transport mcp.Transport, clientFactory sdk.ClientFactory, legacySdkClientFactory legacy.ClientFactory, authClientFactory client.AuthClientFactory, tokenStore tokenstore.TokenStore, toolFilter *filter.Filter, grantType auth.GrantType) error {
```

to:

```go
func Start(ctx context.Context, version string, transport mcp.Transport, transportMode string, listenAddr string, clientFactory sdk.ClientFactory, legacySdkClientFactory legacy.ClientFactory, authClientFactory client.AuthClientFactory, tokenStore tokenstore.TokenStore, toolFilter *filter.Filter, grantType auth.GrantType) error {
```

Replace:

```go
	if err := server.Run(ctx, transport); err != nil {
		return err
	}
	return nil
```

with:

```go
	// mcp.NewSSEHandler returns an http.Handler, not an mcp.Transport, so the SSE
	// path cannot reuse server.Run — it serves HTTP instead. Stdio stays the
	// default so upstream behaviour is untouched when no flag is passed.
	switch transportMode {
	case "stdio", "":
		if err := server.Run(ctx, transport); err != nil {
			return err
		}
		return nil
	case "sse":
		handler := mcp.NewSSEHandler(func(*http.Request) *mcp.Server { return server })
		httpServer := &http.Server{
			Addr:    listenAddr,
			Handler: handler,
		}
		go func() {
			<-ctx.Done()
			// Best effort: the process is shutting down either way.
			_ = httpServer.Close()
		}()
		logger.FromContext(ctx).Info("Serving MCP over SSE", slog.String("addr", listenAddr))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	default:
		return fmt.Errorf("unsupported transport %q: want \"stdio\" or \"sse\"", transportMode)
	}
```

Add `"log/slog"` to the imports for the `slog.String` call.

- [ ] **Step 4: Add the flags to the `run` command**

In `cmd/run/run.go`, inside `NewCommand`, declare the variables alongside the existing flag variables:

```go
	var transportMode string
	var listenAddr string
```

Register them on the returned command (next to the other `Flags()` calls):

```go
	cmd.Flags().StringVar(&transportMode, "transport", "stdio", "MCP transport: stdio or sse")
	cmd.Flags().StringVar(&listenAddr, "listen", ":8080", "listen address when --transport=sse")
```

And pass them through at the `server.Start` call site:

```go
			err = server.Start(cmd.Context(), version, transport, transportMode, listenAddr, clientFactory, legacyClientFactory, authClientFactory, tokenStore, toolFilter, grantType)
```

- [ ] **Step 5: Build and confirm the default is unchanged**

```bash
go build ./...
go run . run --help
```

Expected: build succeeds; `--transport` shows default `stdio` and `--listen` shows `:8080`.

- [ ] **Step 6: Run the full suite**

```bash
go test ./...
```

Expected: PASS, matching the Task 1 Step 2 baseline.

- [ ] **Step 7: Commit**

```bash
git add internal/server/server.go internal/server/server_sse_test.go cmd/run/run.go cmd/root.go
git commit -m "feat(transport): serve MCP over SSE behind --transport=sse

The Privilege AI Gateway's discovery client issues a bare GET and waits for an
SSE endpoint event, so streamable HTTP alone cannot be discovered by it.

mcp.NewSSEHandler is an http.Handler rather than an mcp.Transport, so Start
branches instead of taking a different transport. stdio remains the default."
```

---

## Task 3: Fail fast when the worker credential is bad

**Repo:** fork (`curtismu7/pingone-mcp-server`)

**Files:**
- Create: `internal/auth/preflight.go`
- Create: `internal/auth/preflight_test.go`
- Modify: `cmd/run/run.go`

**Interfaces:**
- Consumes: `auth.GrantTypeClientCredentials` (Task 1); the `client.AuthClient` interface, whose `TokenSource(ctx, grantType, *mcp.ServerSession) (oauth2.TokenSource, error)` is already defined upstream.
- Produces: `auth.VerifyCredentials(ctx context.Context, authClient client.AuthClient, grantType auth.GrantType) error` — returns nil when a token can be obtained, a wrapped error otherwise. Task 4's container relies on the resulting non-zero exit.

**Why this task exists:** the auth middleware only runs for `tools/call`
(`internal/auth/middleware/middleware.go` returns early for every other method).
With `client_credentials` there is no interactive login to fail at startup either,
so a server holding a wrong client secret starts cleanly, reports healthy, passes
gateway discovery, populates its tool list — and fails only when someone finally
calls a tool. The spec's §6 requires the opposite: exit non-zero naming the reason.

- [ ] **Step 1: Write the failing test**

Create `internal/auth/preflight_test.go`:

```go
// Copyright © 2026 Ping Identity Corporation

package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pingidentity/pingone-mcp-server/internal/auth"
	"github.com/pingidentity/pingone-mcp-server/internal/auth/client"
	"golang.org/x/oauth2"
)

type fakeAuthClient struct {
	token *oauth2.Token
	err   error
}

func (f *fakeAuthClient) TokenSource(ctx context.Context, grantType auth.GrantType, s *mcp.ServerSession) (oauth2.TokenSource, error) {
	if f.err != nil {
		return nil, f.err
	}
	return oauth2.StaticTokenSource(f.token), nil
}

func (f *fakeAuthClient) BrowserLoginAvailable(grantType auth.GrantType) bool { return false }

var _ client.AuthClient = &fakeAuthClient{}

func TestVerifyCredentials_OK(t *testing.T) {
	c := &fakeAuthClient{token: &oauth2.Token{AccessToken: "t", Expiry: time.Now().Add(time.Hour)}}
	if err := auth.VerifyCredentials(context.Background(), c, auth.GrantTypeClientCredentials); err != nil {
		t.Fatalf("VerifyCredentials() = %v, want nil", err)
	}
}

func TestVerifyCredentials_SurfacesTokenSourceError(t *testing.T) {
	c := &fakeAuthClient{err: errors.New("invalid_client")}
	err := auth.VerifyCredentials(context.Background(), c, auth.GrantTypeClientCredentials)
	if err == nil {
		t.Fatal("VerifyCredentials() = nil, want an error")
	}
	// The operator has to be able to tell a bad secret from a network problem.
	if !strings.Contains(err.Error(), "invalid_client") {
		t.Errorf("error %q does not carry the underlying cause", err.Error())
	}
}

// An empty token must not read as success — that is the silent-failure case.
func TestVerifyCredentials_RejectsEmptyToken(t *testing.T) {
	c := &fakeAuthClient{token: &oauth2.Token{AccessToken: ""}}
	if err := auth.VerifyCredentials(context.Background(), c, auth.GrantTypeClientCredentials); err == nil {
		t.Fatal("VerifyCredentials() = nil for an empty token, want an error")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
go test ./internal/auth/ -run VerifyCredentials -v
```

Expected: FAIL — `undefined: auth.VerifyCredentials`.

- [ ] **Step 3: Write the implementation**

Create `internal/auth/preflight.go`:

```go
// Copyright © 2026 Ping Identity Corporation

package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/pingidentity/pingone-mcp-server/internal/auth/client"
)

// VerifyCredentials obtains one token so a misconfigured credential fails at
// startup rather than on the first tool call.
//
// The auth middleware only runs for "tools/call", and client_credentials has no
// interactive step, so without this a server holding a wrong secret starts
// cleanly, passes gateway discovery and populates its tool list — then fails only
// when someone calls a tool, which surfaces as an unexplained gateway error far
// from the cause.
func VerifyCredentials(ctx context.Context, authClient client.AuthClient, grantType GrantType) error {
	tokenSource, err := authClient.TokenSource(ctx, grantType, nil)
	if err != nil {
		return fmt.Errorf("could not create a token source for grant type %s: %w", grantType.String(), err)
	}
	if tokenSource == nil {
		return errors.New("auth client returned a nil token source")
	}

	token, err := tokenSource.Token()
	if err != nil {
		return fmt.Errorf("could not obtain a token for grant type %s: %w", grantType.String(), err)
	}
	if token == nil || token.AccessToken == "" {
		return errors.New("token source returned an empty access token")
	}
	return nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
go test ./internal/auth/ -run VerifyCredentials -v
```

Expected: PASS, all three cases.

- [ ] **Step 5: Call it at startup, for client credentials only**

In `cmd/run/run.go`, immediately before the `server.Start(...)` call:

```go
			// Only for client credentials: the interactive grants legitimately
			// defer authentication until a user is present, so a startup check
			// there would force a browser at boot.
			if grantType == auth.GrantTypeClientCredentials {
				preflightClient, err := authClientFactory.NewAuthClient()
				if err != nil {
					return errs.NewCommandError(commandName, fmt.Errorf("credential preflight: %w", err))
				}
				if err := auth.VerifyCredentials(cmd.Context(), preflightClient, grantType); err != nil {
					return errs.NewCommandError(commandName, err)
				}
			}
```

Add `"fmt"` and the `internal/auth` import if they are not already present in the file.

- [ ] **Step 6: Verify the failure path end to end**

Build, then run with a deliberately wrong secret:

```bash
go build -o /tmp/p1mcp .
PINGONE_ENVIRONMENT_ID=$PINGONE_ENVIRONMENT_ID PINGONE_CLIENT_ID=$PINGONE_CLIENT_ID PINGONE_CLIENT_SECRET=definitely-not-the-secret   /tmp/p1mcp run --transport sse --grant-type client_credentials --token-store file
echo "exit=$?"
```

Expected: non-zero exit, with a message naming the credential failure. It must **not** start listening.

- [ ] **Step 7: Run the full suite**

```bash
go test ./...
```

Expected: PASS, matching the Task 1 Step 2 baseline.

- [ ] **Step 8: Commit**

```bash
git add internal/auth/preflight.go internal/auth/preflight_test.go cmd/run/run.go
git commit -m "feat(auth): verify the credential at startup for client_credentials

The auth middleware only runs for tools/call, and client_credentials has no
interactive step, so a wrong secret produced a server that started cleanly,
passed gateway discovery and populated its tool list — failing only when a tool
was finally called, far from the cause."
```

## Task 4: Container image and local Docker service

**Repo:** fork for Steps 1–4, AI-DEMO2 for Steps 5–8

**Files:**
- Modify (fork): `Dockerfile` if the entrypoint hardcodes stdio
- Modify (fork): `.github/workflows/` — image publish to GHCR
- Modify (AI-DEMO2): `docker-compose.yml`

**Interfaces:**
- Consumes: `--transport sse`, `--listen`, `--grant-type client_credentials` from Tasks 1–2, and the startup credential check from Task 3.
- Produces: image `ghcr.io/curtismu7/pingone-mcp-server:latest` serving SSE on port 8080. Task 5 deploys this exact image.

- [ ] **Step 1: Read the existing entrypoint before changing it**

```bash
cat Dockerfile docker-entrypoint.sh
```

Note whether the entrypoint hardcodes `run` arguments. If it passes `"$@"` through, no change is needed — do not edit it for symmetry.

- [ ] **Step 2: Build the image locally**

```bash
docker build -t pingone-mcp-server:dev .
```

Expected: build succeeds.

- [ ] **Step 3: Run it with SSE and confirm the endpoint event**

Set the three values in your shell first; do not inline secrets into the command history.

```bash
docker run --rm -p 8099:8080 \
  -e PINGONE_ENVIRONMENT_ID -e PINGONE_CLIENT_ID -e PINGONE_CLIENT_SECRET \
  pingone-mcp-server:dev run \
    --transport sse --listen :8080 \
    --grant-type client_credentials \
    --token-store file
```

In a second shell:

```bash
curl -sN -H 'Accept: text/event-stream' --max-time 5 http://localhost:8099/sse | head -5
```

Expected: the first `event:` line is `endpoint`. If the container exits instead, read its logs — a startup failure here is almost always the worker credential or a missing role, not the transport.

- [ ] **Step 4: Publish to GHCR from the fork's CI**

Add or adjust a workflow so pushes to the fork's default branch build and push `ghcr.io/curtismu7/pingone-mcp-server:latest`. Confirm the package is visible:

```bash
gh api user/packages/container/pingone-mcp-server --jq .name
```

Expected: prints the package name. If it 404s, the image did not publish — fix before Task 4, which pulls it.

- [ ] **Step 5: Switch to AI-DEMO2 in a worktree**

```bash
cd /Users/cmuir/Development/AI-DEMO2
# Enter a worktree first — the main checkout hard-blocks edits.
```

- [ ] **Step 6: Add the compose service**

In `docker-compose.yml`, add alongside the other MCP servers. **No `ports:` mapping** — nothing on the host needs it, and not publishing keeps a credentialed admin surface off the host network:

```yaml
  pingone-mcp:
    image: ghcr.io/curtismu7/pingone-mcp-server:latest
    container_name: ai-demo-pingone-mcp
    restart: unless-stopped
    command: >
      run --transport sse --listen :8080
      --grant-type client_credentials --token-store file
    environment:
      PINGONE_ENVIRONMENT_ID: "${PINGONE_ENVIRONMENT_ID}"
      PINGONE_CLIENT_ID: "${PINGONE_MCP_WORKER_CLIENT_ID}"
      PINGONE_CLIENT_SECRET: "${PINGONE_MCP_WORKER_CLIENT_SECRET}"
    networks:
      - ai-demo
```

Match the `networks:` key to whatever the neighbouring services use — read one before writing this.

- [ ] **Step 7: Bring it up and verify from inside the network**

```bash
./run-docker.sh restart pingone-mcp
docker exec ai-demo-api-server sh -c \
  "curl -sN -H 'Accept: text/event-stream' --max-time 5 http://pingone-mcp:8080/sse | head -3"
```

Expected: an `event: endpoint` line. Verify from inside the network, not the host — the service is deliberately unpublished.

- [ ] **Step 8: Commit (AI-DEMO2)**

```bash
git add docker-compose.yml
git commit -m "feat(compose): add pingone-mcp SSE service

Deliberately unpublished: it holds a worker credential with PingOne admin
rights, so it is reachable only from inside the compose network."
```

---

## Task 5: SE cluster deployment

**Repo:** AI-DEMO2

**Files:**
- Create: `k8s/aws/pingone-mcp.yaml`

**Interfaces:**
- Consumes: the GHCR image from Task 3.
- Produces: a Service `pingone-mcp` on port 8080 in `ping-devops-cmuir`, reachable only from the gateway pod. Task 6 registers this as an Agentic App.

- [ ] **Step 1: Read a neighbouring manifest first**

```bash
cat k8s/aws/mcp-resource-server.yaml
```

Copy its structure — labels, secret references, resource limits, and the `namespace: ai-demo` placeholder that `deploy.sh`'s `apply_patched()` rewrites. Applying a raw manifest directly fails on namespace mismatch.

- [ ] **Step 2: Write the manifest**

Create `k8s/aws/pingone-mcp.yaml`. The NetworkPolicy is load-bearing, not hygiene:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pingone-mcp
  namespace: ai-demo
  labels:
    app: pingone-mcp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: pingone-mcp
  template:
    metadata:
      labels:
        app: pingone-mcp
    spec:
      containers:
        - name: pingone-mcp
          image: ghcr.io/curtismu7/pingone-mcp-server:latest
          imagePullPolicy: Always
          args:
            - run
            - --transport=sse
            - --listen=:8080
            - --grant-type=client_credentials
            - --token-store=file
          ports:
            - containerPort: 8080
          env:
            - name: PINGONE_ENVIRONMENT_ID
              valueFrom:
                secretKeyRef: { name: ai-demo-secrets, key: PINGONE_ENVIRONMENT_ID }
            - name: PINGONE_CLIENT_ID
              valueFrom:
                secretKeyRef: { name: ai-demo-secrets, key: PINGONE_MCP_WORKER_CLIENT_ID }
            - name: PINGONE_CLIENT_SECRET
              valueFrom:
                secretKeyRef: { name: ai-demo-secrets, key: PINGONE_MCP_WORKER_CLIENT_SECRET }
---
apiVersion: v1
kind: Service
metadata:
  name: pingone-mcp
  namespace: ai-demo
spec:
  selector:
    app: pingone-mcp
  ports:
    - port: 8080
      targetPort: 8080
---
# LOAD-BEARING. The server is unauthenticated on the wire and holds a worker
# credential with PingOne admin rights. This policy is the only control in front
# of it: anything that can reach the pod gets full tenant admin. Do not remove.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: pingone-mcp-gateway-only
  namespace: ai-demo
spec:
  podSelector:
    matchLabels:
      app: pingone-mcp
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: agentless-mcpgw
      ports:
        - protocol: TCP
          port: 8080
```

Confirm the gateway pod's actual labels before trusting `app: agentless-mcpgw`:

```bash
kubectl --context us -n ping-devops-cmuir get pods -l app=agentless-mcpgw \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.metadata.labels}{"\n"}{end}'
```

If that returns nothing, list the gateway pod and read its labels — a NetworkPolicy with a selector matching nothing silently blocks all ingress, which looks exactly like the server being broken.

- [ ] **Step 3: Add the two secret keys**

`PINGONE_MCP_WORKER_CLIENT_ID` and `PINGONE_MCP_WORKER_CLIENT_SECRET` must exist in the namespace secret before deploying. Follow the existing `create-secrets.sh` path rather than `kubectl create secret` by hand.

- [ ] **Step 4: Apply and verify the pod is genuinely serving**

```bash
sed 's/namespace: ai-demo/namespace: ping-devops-cmuir/' k8s/aws/pingone-mcp.yaml \
  | kubectl --context us apply -n ping-devops-cmuir -f -
kubectl --context us -n ping-devops-cmuir rollout status deploy/pingone-mcp --timeout=120s
```

Then prove it serves, rather than trusting Ready:

```bash
kubectl --context us -n ping-devops-cmuir exec deploy/pingone-mcp -- \
  sh -c "curl -sN -H 'Accept: text/event-stream' --max-time 5 http://localhost:8080/sse | head -3"
```

Expected: an `event: endpoint` line. A pod can be Ready with no probe configured and still be failing every request.

- [ ] **Step 5: Commit**

```bash
git add k8s/aws/pingone-mcp.yaml
git commit -m "feat(k8s): deploy pingone-mcp for the Privilege gateway

NetworkPolicy restricts ingress to the gateway pod. It is the only control in
front of a worker credential with PingOne admin rights."
```

---

## Task 6: Register as an Agentic App and prove the chain

**Repo:** AI-DEMO2 (documentation only)

**Files:**
- Modify: `REGRESSION_PLAN.md`

**Interfaces:**
- Consumes: the running Service from Task 4.
- Produces: a registered Agentic App whose tools populate in the Privilege console; the end-to-end evidence this whole plan exists to produce.

- [ ] **Step 1: Register the backend in the Privilege console**

Register with entry path **`/sse`** — not `/mcp`. Follow `.claude/skills/privilege-mcpgw-agent-k8s/SKILL.md` for the Gateways wizard.

- [ ] **Step 2: Confirm discovery succeeded**

In the console, check that the app's **tool list is populated**. Tools stay empty and policy creation stays disabled until discovery succeeds, so a populated list is a real assertion, not a cosmetic one.

If tools are empty, read the gateway log before changing anything:

```bash
kubectl --context us -n ping-devops-cmuir logs deploy/agentless-mcpgw --tail=50 | grep -iE "discover|initialize|entry path"
```

`outside entry path "/sse"` means the backend was registered with the wrong path.

- [ ] **Step 3: Author a permit policy and call a tool**

Author a policy permitting one read-only tool. From an MCP client through the gateway, call it. Expected: a real PingOne result.

- [ ] **Step 4: Prove the gateway decides, not just forwards**

Author a deny for a second tool and call it. Expected: a policy denial, not a result. Without this step the demo shows a proxy, not a policy layer.

- [ ] **Step 5: Record the security posture in `REGRESSION_PLAN.md` §1**

Add an entry stating: the `pingone-mcp` service is unauthenticated on the wire by design; the NetworkPolicy restricting ingress to the gateway pod is load-bearing; the service must never be published to the host or given a cluster ingress; and the worker's PingOne roles bound the blast radius.

- [ ] **Step 6: Commit**

```bash
git add REGRESSION_PLAN.md
git commit -m "docs(regression): record pingone-mcp security posture

The NetworkPolicy is the only control in front of a worker credential with
PingOne admin rights, so it belongs in the do-not-break contract rather than
in a commit message."
```

---

## Worker roles — settled

**Read-only to start** (decided 2026-09-07). The worker application gets
configuration read plus identity-data read, and **no write roles**.

Consequences for the tasks below:

- Task 4 Step 3 and Task 5 Step 4 will succeed: startup, SSE discovery and
  `tools/list` need no write permission.
- Task 6 Step 3 should pick a **read-only** tool for the permit case.
- Task 6 Step 4's deny case still proves the gateway decides, because the denial
  happens at the gateway before PingOne is reached.
- A write tool called through a permit will fail at PingOne, not at the gateway.
  That is expected, not a defect — do not "fix" it by widening roles without a
  deliberate decision recorded in the spec.
