"""JWT Verifier MCP Server — Python/FastMCP port of jwt-verifier-mcp-server.

Tool names, params, and output shapes mirror jwt-verifier-mcp-server/src/actions/*.ts
and src/services/jwtVerifierService.ts so this is a drop-in equivalent behind
demo_mcp_gateway, not a new tool design.
"""

import base64
import json
import os
import time
from typing import Optional, Union

import httpx
import jwt
from dotenv import load_dotenv
from jwt import PyJWKClient
from jwt.algorithms import ECAlgorithm, RSAAlgorithm
from starlette.responses import JSONResponse

from fastmcp import FastMCP
from fastmcp.server.auth.providers.jwt import JWTVerifier

load_dotenv()

HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT_SECONDS", "10"))
MAX_JWKS_BYTES = int(os.environ.get("MAX_JWKS_RESPONSE_BYTES", "1048576"))

auth = JWTVerifier(
    jwks_uri=os.environ["PINGONE_JWKS_URI"],
    issuer=os.environ["PINGONE_ISSUER"],
    audience=os.environ["MCP_JWTVERIFIER_RESOURCE_URI"],
)

mcp = FastMCP(name="JWT Verifier", auth=auth)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request):
    return JSONResponse({"status": "healthy", "service": "demo_mcp_jwt_verifier"})


def _b64url_decode(segment: str) -> bytes:
    padded = segment + "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(padded)


def _decode_unverified(token: str) -> tuple[dict, dict]:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Token must have 3 parts (header.payload.signature)")
    header = json.loads(_b64url_decode(parts[0]))
    payload = json.loads(_b64url_decode(parts[1]))
    return header, payload


def _iso(ts) -> Optional[str]:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts is not None else None


@mcp.tool
def jwt_decode_full(token: str) -> dict:
    """Decode a JWT and return header, payload, and metadata. No verification performed."""
    header, payload = _decode_unverified(token)
    has_signature = bool(token.split(".")[2])

    now = int(time.time())
    exp = payload.get("exp") if isinstance(payload.get("exp"), (int, float)) else None
    iat = payload.get("iat") if isinstance(payload.get("iat"), (int, float)) else None
    is_expired = exp is not None and exp < now

    summary = {
        "algorithm": header.get("alg"),
        "type": header.get("typ"),
        "keyId": header.get("kid"),
        "issuedAt": _iso(iat),
        "expiresAt": _iso(exp),
        "subject": payload.get("sub"),
        "issuer": payload.get("iss"),
    }

    return {
        "header": header,
        "payload": payload,
        "hasSignature": has_signature,
        "summary": summary,
        "isExpired": is_expired,
    }


@mcp.tool
def jwt_verify_signature(
    token: str,
    jwksUri: str,
    algorithms: Optional[list] = None,
    issuer: Optional[str] = None,
    audience: Optional[str] = None,
) -> dict:
    """Verify a JWT signature using a JWKS endpoint. Validates signature, algorithm, issuer, and audience."""
    header, _ = _decode_unverified(token)
    try:
        signing_key = PyJWKClient(jwksUri, cache_keys=True, lifespan=30).get_signing_key_from_jwt(token)

        decode_kwargs = {}
        decode_options = {}
        if issuer:
            decode_kwargs["issuer"] = issuer
        if audience:
            decode_kwargs["audience"] = audience
        else:
            decode_options["verify_aud"] = False

        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=algorithms or [header.get("alg")],
            options=decode_options,
            **decode_kwargs,
        )

        return {
            "valid": True,
            "payload": payload,
            "header": header,
            "algorithm": header.get("alg"),
            "kid": header.get("kid"),
        }
    except Exception as err:
        return {"valid": False, "error": str(err)}


@mcp.tool
def jwt_validate_claims(
    token: str,
    expectedIss: Optional[str] = None,
    expectedAud: Optional[Union[str, list]] = None,
    expectedNonce: Optional[str] = None,
    clockToleranceSeconds: int = 0,
) -> dict:
    """Validate JWT standard claims (exp, nbf, iss, aud, nonce) without verifying signature."""
    _, payload = _decode_unverified(token)
    now = int(time.time())
    tolerance = clockToleranceSeconds or 0

    claims_checked: list = []
    failures: list = []
    warnings: list = []

    claims_checked.append("exp")
    exp = payload.get("exp")
    if isinstance(exp, (int, float)):
        if exp < now - tolerance:
            failures.append(f"Token expired at {_iso(exp)}")
    elif exp:
        warnings.append("exp claim present but not a number")

    claims_checked.append("nbf")
    nbf = payload.get("nbf")
    if isinstance(nbf, (int, float)) and nbf > now + tolerance:
        failures.append(f"Token not yet valid, starts at {_iso(nbf)}")

    if expectedIss:
        claims_checked.append("iss")
        if payload.get("iss") != expectedIss:
            failures.append(f'Issuer mismatch: expected "{expectedIss}", got "{payload.get("iss")}"')

    if expectedAud:
        claims_checked.append("aud")
        expected_list = expectedAud if isinstance(expectedAud, list) else [expectedAud]
        token_aud = payload.get("aud")
        if isinstance(token_aud, list):
            if not any(a in token_aud for a in expected_list):
                failures.append(
                    f"Audience mismatch: expected one of {json.dumps(expected_list)}, got {json.dumps(token_aud)}"
                )
        elif isinstance(token_aud, str):
            if token_aud not in expected_list:
                failures.append(
                    f'Audience mismatch: expected one of {json.dumps(expected_list)}, got "{token_aud}"'
                )

    if expectedNonce:
        claims_checked.append("nonce")
        if payload.get("nonce") != expectedNonce:
            failures.append(f'Nonce mismatch: expected "{expectedNonce}", got "{payload.get("nonce")}"')

    return {
        "valid": len(failures) == 0,
        "claimsChecked": claims_checked,
        "failures": failures,
        "warnings": warnings,
    }


@mcp.tool
def jwt_fetch_jwks(uri: str) -> dict:
    """Fetch and analyze a JWKS endpoint. Returns all keys with metadata (kty, alg, use, kid) and summary of algorithms and key usages."""
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        response = client.get(uri)
        response.raise_for_status()
        if len(response.content) > MAX_JWKS_BYTES:
            raise ValueError(f"JWKS response exceeds {MAX_JWKS_BYTES} bytes")
        jwks_data = response.json()

    keys_raw = jwks_data.get("keys")
    if not isinstance(keys_raw, list):
        raise ValueError("JWKS response missing 'keys' array")

    algorithms: set = set()
    key_usages: set = set()
    keys = []
    for key in keys_raw:
        if isinstance(key.get("alg"), str):
            algorithms.add(key["alg"])
        if isinstance(key.get("use"), str):
            key_usages.add(key["use"])
        keys.append(
            {
                "kid": key.get("kid"),
                "kty": key.get("kty"),
                "use": key.get("use"),
                "alg": key.get("alg"),
                "hasPublicKey": bool(key.get("n") or key.get("x")),
            }
        )

    return {
        "keyCount": len(keys),
        "keys": keys,
        "analysis": {
            "algorithms": sorted(algorithms),
            "keyUsages": sorted(key_usages),
        },
    }


@mcp.tool
def jwt_inspect_key(key: dict) -> dict:
    """Validate and analyze a single JWKS key. Checks key type, required components, and importability."""
    issues: list = []
    kty = key.get("kty")

    if not kty:
        issues.append("Missing 'kty' (key type)")
    elif kty == "RSA":
        if not key.get("n") or not key.get("e"):
            issues.append("RSA key missing required components (n, e)")
    elif kty == "EC":
        if not key.get("crv") or not key.get("x") or not key.get("y"):
            issues.append("EC key missing required components (crv, x, y)")
    elif kty == "oct":
        if not key.get("k"):
            issues.append("Symmetric key missing 'k' component")

    can_import = len(issues) == 0
    if can_import and kty in ("RSA", "EC"):
        try:
            key_json = json.dumps(key)
            (RSAAlgorithm if kty == "RSA" else ECAlgorithm).from_jwk(key_json)
        except Exception as err:
            can_import = False
            issues.append(f"Cannot import key: {err}")

    return {
        "keyType": str(kty),
        "algorithm": key.get("alg"),
        "use": key.get("use"),
        "kid": key.get("kid"),
        "isValid": can_import and len(issues) == 0,
        "issues": issues,
    }


if __name__ == "__main__":
    mcp.run(
        transport="http",
        host=os.environ.get("MCP_JWT_VERIFIER_HOST", "0.0.0.0"),
        port=int(os.environ.get("MCP_JWT_VERIFIER_PORT", "8083")),
        path="/mcp",
        host_origin_protection=False,
    )
