from __future__ import annotations
import os
import uvicorn
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .run_handler import handle_run
from . import config as cfg

app = FastAPI(title="Pydantic AI Agent Service")

# Restrict CORS to only trusted origins (agent service should be called from BFF only)
allowed_origins = []
if bff_origin := os.getenv("BFF_ORIGIN"):
    allowed_origins.append(bff_origin)
if not allowed_origins:
    allowed_origins = ["http://localhost:3001"]  # Default for dev; MUST be overridden in prod

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
)


# Auth middleware: validate BFF_INTERNAL_SECRET in Authorization header for /run endpoint
from starlette.middleware.base import BaseHTTPMiddleware


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/run":
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
            token = auth_header[7:]
            if token != cfg.BFF_INTERNAL_SECRET:
                raise HTTPException(status_code=403, detail="Invalid credentials")
        return await call_next(request)


app.add_middleware(AuthMiddleware)


app.post("/run")(handle_run)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pydantic_ai", "port": cfg.AGENT_HTTP_PORT}


if __name__ == "__main__":
    uvicorn.run("src.main:app", host=cfg.AGENT_HTTP_HOST, port=cfg.AGENT_HTTP_PORT, reload=False)
