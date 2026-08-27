#!/usr/bin/env python3
"""Extract the teaching-relevant code from every sample app, for all 5 stacks.

Anchors on the PingOne API call itself rather than on step-number comments,
because those are inconsistent across stacks (m2m/angular has one, mfa-demo
has three, user-registration repeats 1 and 2 for its two flows).

Emits demo_api_ui/src/data/sampleCode.json.
"""
import json, pathlib, re, sys

SRC = pathlib.Path.home() / "Development/devdocs-sample-apps-main"
OUT = pathlib.Path(sys.argv[1])

STACK_FILES = {
    "go":      ("go/main.go", "go"),
    "js":      ("js/index.js", "javascript"),
    "python":  ("python/app.py", "python"),
    "react":   ("react/server/index.js", "javascript"),
    "angular": ("angular/server/index.js", "javascript"),
}

COMMENT = {"go": "//", "javascript": "//", "python": "#"}

# Per use case: the sections a reader needs, each anchored on a distinctive
# string present in every stack. `note` is our teaching annotation.
SECTIONS = {
    "m2m-credentials": [
        dict(id="token", title="The client credentials request",
             anchor=r"grant_type=client_credentials",
             per_stack={"go": r'form\.Set\("grant_type"'},
             note="The entire grant, in one HTTP call. The client authenticates with its own "
                  "ID and secret over HTTP Basic — no user, no browser redirect, no authorization "
                  "code, no PKCE. This is the right grant whenever there is no human in the loop."),
        dict(id="jwks", title="Fetching PingOne's signing keys",
             anchor=r"/as/jwks",
             note="The access token is a JWT. To trust it you need PingOne's public signing keys. "
                  "Cache this in production and re-fetch only when you meet a `kid` you have not "
                  "seen — not on every request."),
        dict(id="verify", title="Verifying the signature",
             anchor=r"(createVerify|PKCS1v15|verify_signature|rsa\.VerifyPKCS1v15)",
             note="The signed input is exactly `base64url(header).base64url(payload)` as transmitted. "
                  "Any change to the token — even reordering JSON keys — invalidates it. Match the "
                  "key by the `kid` in the JWT header."),
        dict(id="claims", title="Validating the claims",
             anchor=r"(expectedIssuer|expected_issuer|client_id.*want|iss.*!=)",
             note="A cryptographically valid token can still be the wrong token. Check `iss`, `exp`, "
                  "`iat` — and critically `client_id`, because PingOne worker tokens have no `sub`. "
                  "Validating `sub` here would silently pass for any client."),
        dict(id="risk", title="Gating the call on a Protect risk score",
             anchor=r"riskEvaluations",
             note="PingOne Protect scores the event and returns LOW / MEDIUM / HIGH. The sample runs "
                  "this twice — once from the real caller IP, once from a known Tor exit node — and "
                  "blocks the downstream management call when the score comes back HIGH."),
    ],
    "custom-admin-role": [
        dict(id="token", title="Getting a management token",
             anchor=r"grant_type=client_credentials|client_credentials",
             note="Same client_credentials grant as the M2M sample. The worker app must already hold "
                  "the Environment Admin role — without it the role-creation calls below return 403."),
        dict(id="create-role", title="Creating the custom role",
             anchor=r"customRolePayload|/environments/\$?\{?envID\}?/roles|environments/%s/roles|environments/\{env_id\}/roles",
             note="A custom admin role bundles a narrow set of permissions. `canBeAssignedBy` names "
                  "which platform role is allowed to hand it out — this is what makes delegated "
                  "administration safe."),
        dict(id="role-id", title="Why the role ID is hardcoded",
             anchor=r"ENV_ADMIN_ROLE_ID|29ddce68",
             note="Environment Admin has a fixed, global ID across every PingOne tenant. Referencing "
                  "it directly avoids a `GET /roles` lookup that an Environment Admin worker cannot "
                  "perform anyway — listing platform roles needs Organization Admin. This is a "
                  "deliberate least-privilege choice."),
        dict(id="assign", title="Assigning the role to an application",
             anchor=r"roleAssignments",
             note="The assignment is scoped: `scope.type=ENVIRONMENT` grants the role only inside one "
                  "environment, not across the organization. Scope is what keeps a delegated admin "
                  "role from becoming a global one."),
    ],
    "user-registration": [
        dict(id="authorize", title="Starting a native flow",
             anchor=r"response_mode=pi\.flow",
             note="`response_mode=pi.flow` makes PingOne return JSON with a flow ID instead of "
                  "redirecting the browser. Your server drives the flow directly. Note the "
                  "`redirect_uri` in this URL is never actually visited — there is no callback "
                  "handler anywhere in this sample."),
        dict(id="register", title="Submitting the registration",
             anchor=r"vnd\.pingidentity\.user\.register",
             note="The vendor content type is what tells the flow engine which action to perform. "
                  "Sending `application/json` here returns 415. This is the single most common "
                  "mistake when hand-rolling these calls."),
        dict(id="verify", title="Checking the emailed OTP",
             anchor=r"vnd\.pingidentity\.user\.verify|otp\.check",
             note="PingOne emails a one-time code and the flow waits for it. There is no mock — this "
                  "step cannot be completed without a real, reachable mailbox."),
        dict(id="resume", title="Resuming to get the authorization code",
             anchor=r"/as/resume",
             note="`/as/resume` ends the native flow and hands back an authorization code, either in "
                  "JSON or via a 302 Location header. Both shapes are handled."),
        dict(id="token", title="Exchanging the code for tokens",
             anchor=r"grant_type.*authorization_code|authorization_code",
             note="From here it is an ordinary OAuth 2.0 code exchange. The `redirect_uri` must match "
                  "the one sent to `/as/authorize` exactly, even though no redirect ever happened."),
    ],
    "mfa-demo": [
        dict(id="authorize", title="Starting a native flow",
             anchor=r"response_mode=pi\.flow",
             note="Same native-flow start as user-registration: JSON, not a redirect. PingOne sets "
                  "`ST` and `ST-NO-SS` session cookies here that must be captured and replayed on "
                  "every later call."),
        dict(id="credentials", title="Submitting username and password",
             anchor=r"vnd\.pingidentity\.usernamePassword\.check",
             note="The response `status` drives everything next: `COMPLETED` means no MFA was "
                  "required, while `OTP_REQUIRED` / `DEVICE_SELECTION_REQUIRED` / "
                  "`MULTI_FACTOR_AUTHENTICATION_REQUIRED` mean PingOne has sent a challenge."),
        dict(id="otp", title="Checking the MFA one-time passcode",
             anchor=r"vnd\.pingidentity\.otp\.check",
             note="A different vendor content type for the OTP step. Note the dual authentication: "
                  "these `/flows/{id}` calls need BOTH an admin worker bearer token AND the replayed "
                  "session cookies. Omit either and you get a 401."),
        dict(id="cookies", title="Replaying the flow session cookies",
             anchor=r"(captureCookies|cookieHeader|set-cookie|Set-Cookie)",
             per_stack={"go": r"resp\.Cookies\(\)", "python": r"def capture_cookies"},
             note="Node's fetch has no cookie jar, and path scoping would drop PingOne's cookies "
                  "anyway. The sample captures the raw name=value pairs and rebuilds the Cookie "
                  "header by hand — a detail that costs hours if you miss it."),
        dict(id="resume", title="Resuming to get the authorization code",
             anchor=r"/as/resume",
             note="Signals the native flow is done. PingOne returns either JSON containing "
                  "`authorizeResponse.code` or a 302 to the registered redirect_uri."),
    ],
}

MAX_LINES = 42


def is_comment(line, cm):
    t = line.strip()
    return (not t) or t.startswith(cm) or t.startswith("*") or t.startswith("/*") or t.startswith('"""')


def extract(text, anchor, lang):
    """Return a readable window around the first anchor match that is real code.

    Matches inside the file's header doc-comment are skipped — every sample
    documents its API calls at the top, so the first textual match is almost
    always prose, not the call itself.
    """
    lines = text.split("\n")
    cm = COMMENT[lang]

    idx = None
    for m in re.finditer(anchor, text):
        cand = text[:m.start()].count("\n")
        if not is_comment(lines[cand], cm):
            idx = cand
            break
    if idx is None:
        return None

    # walk back over at most a few lines of attached comment
    start = idx
    budget = 8
    while start > 0 and budget > 0:
        prev = lines[start - 1].strip()
        if prev.startswith(cm) or prev.startswith("*") or prev.startswith("/*"):
            start -= 1; budget -= 1
        else:
            break

    # forward until the statement looks closed and a blank line follows, but
    # never stop before we have a useful amount of actual code — a one-line
    # snippet teaches nothing.
    MIN_CODE = 6
    end = idx
    limit = min(len(lines), start + MAX_LINES)
    while end < limit - 1:
        end += 1
        code_lines = sum(1 for l in lines[start:end] if l.strip() and not is_comment(l, cm))
        if code_lines < MIN_CODE:
            continue
        if lines[end].strip() == "" and lines[end - 1].strip().endswith((")", "}", ";", ":", "']", '")')):
            break
    snippet = "\n".join(lines[start:end]).rstrip()
    # trim common leading indentation
    body = [l for l in snippet.split("\n") if l.strip()]
    if body:
        pad = min(len(l) - len(l.lstrip()) for l in body)
        snippet = "\n".join(l[pad:] if len(l) >= pad else l for l in snippet.split("\n"))
    return dict(code=snippet, line=start + 1)


out = {}
missing = []
for uc, sections in SECTIONS.items():
    out[uc] = {"sections": []}
    for sec in sections:
        entry = dict(id=sec["id"], title=sec["title"], note=sec["note"], code={})
        for stack, (rel, lang) in STACK_FILES.items():
            p = SRC / uc / rel
            if not p.exists():
                missing.append(f"{uc}/{rel}"); continue
            anchor = sec.get("per_stack", {}).get(stack, sec["anchor"])
            got = extract(p.read_text(), anchor, lang)
            if got:
                entry["code"][stack] = dict(lang=lang, file=rel, **got)
            else:
                missing.append(f"{uc}/{stack}/{sec['id']}")
        out[uc]["sections"].append(entry)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, indent=2) + "\n")

total = sum(len(s["code"]) for uc in out.values() for s in uc["sections"])
want = sum(len(v) * 5 for v in SECTIONS.values())
print(f"wrote {OUT}")
print(f"extracted {total}/{want} snippets")
if missing:
    print(f"\nMISSING ({len(missing)}):")
    for m in missing:
        print("  ", m)
