import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import agent as agent_mod

app = FastAPI(title="llamaindex-agent")


@app.get("/health")
def health():
    return {"status": "ok"}


class AskRequest(BaseModel):
    question: str
    codebase_id: str
    limit: int | None = None


@app.post("/ask")
def ask(req: AskRequest):
    try:
        return agent_mod.run_agent(
            req.question, req.codebase_id, limit=req.limit or 8
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"assistant unavailable: {e}")
