import logging
import uvicorn
from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from .run_handler import router
from .config import get_config
from . import metrics as _metrics  # noqa: F401 — import registers the meter provider

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="OpenAI Agent", docs_url=None, redoc_url=None)
app.include_router(router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "openai_agent"}


# Prometheus scrape target — unauthenticated, same posture as the Node MCP
# services' /metrics routes (monitoring/prometheus.yml already trusts the
# internal network for scraping).
@app.get("/metrics")
async def metrics_endpoint() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    cfg = get_config()
    uvicorn.run("src.main:app", host=cfg.host, port=cfg.port, log_level="info")
