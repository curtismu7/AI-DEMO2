from __future__ import annotations
import hmac
import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from .run_handler import handle_run
from . import config as cfg

app = FastAPI(title="Pydantic AI Agent Service")

# Restrict CORS to only trusted origins (agent service should be called from BFF only)
allowed_origins = []
if cors_origins := os.getenv("CORS_ORIGINS"):
    allowed_origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
elif bff_origin := os.getenv("BFF_ORIGIN"):
    allowed_origins.append(bff_origin)
if not allowed_origins:
    allowed_origins = ["http://localhost:3001"]  # Default for dev; overridden via CORS_ORIGINS in prod

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_credentials=True,
    allow_headers=["Content-Type", "x-internal-gateway-secret"],
)


# Auth middleware: validate the internal gateway secret on /run. The BFF calls
# agents with `x-internal-gateway-secret: <BFF_INTERNAL_SECRET>` (see the BFF's
# routes/agentRun.js getInternalSecret()) — the same header the sibling agent
# frameworks expect. All services share BFF_INTERNAL_SECRET, so this
# authenticates the BFF→agent hop. (The old code checked `Authorization: Bearer`,
# which nothing sends, so every real /run — including the BFF's — was rejected.)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/run":
            # Return a Response directly rather than raising HTTPException:
            # exceptions raised inside a BaseHTTPMiddleware bypass FastAPI's
            # handlers and surface as a bare 500 instead of the intended 401/403.
            secret = request.headers.get("x-internal-gateway-secret", "")
            if not secret:
                return JSONResponse(
                    {"detail": "Missing x-internal-gateway-secret header"}, status_code=401
                )
            # Constant-time compare so a timing side channel can't be used to
            # recover the shared secret byte-by-byte.
            if not hmac.compare_digest(secret, cfg.BFF_INTERNAL_SECRET):
                return JSONResponse({"detail": "Invalid gateway secret"}, status_code=403)
        return await call_next(request)


app.add_middleware(AuthMiddleware)


app.post("/run")(handle_run)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pydantic_ai", "port": cfg.AGENT_HTTP_PORT}


if __name__ == "__main__":
    uvicorn.run("src.main:app", host=cfg.AGENT_HTTP_HOST, port=cfg.AGENT_HTTP_PORT, reload=False)
