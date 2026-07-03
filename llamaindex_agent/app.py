import os
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="llamaindex-agent")


@app.get("/health")
def health():
    return {"status": "ok"}


class AskRequest(BaseModel):
    question: str
    codebase_id: str
    limit: int | None = None


# POST /ask is implemented in Task C3 (needs the agent from C2).
