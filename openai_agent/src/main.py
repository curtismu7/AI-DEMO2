import logging
import uvicorn
from fastapi import FastAPI
from .run_handler import router
from .config import get_config

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="OpenAI Agent", docs_url=None, redoc_url=None)
app.include_router(router)


if __name__ == "__main__":
    cfg = get_config()
    uvicorn.run("src.main:app", host=cfg.host, port=cfg.port, log_level="info")
