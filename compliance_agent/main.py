"""
Compliance Agent FastAPI Server
Python microservice for transaction compliance checking using Pydantic AI
"""

import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from models import ComplianceRequest, ComplianceCheck, TransactionInput
from agent import process_compliance_request

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = Field(description="Service status")
    service: str = Field(description="Service name")
    version: str = Field(description="Service version")


class ComplianceResponse(BaseModel):
    """Compliance check response"""
    success: bool = Field(description="Whether the compliance check succeeded")
    data: ComplianceCheck = Field(description="Compliance assessment result")
    error: str | None = Field(default=None, description="Error message if failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context for startup and shutdown"""
    logger.info("Compliance Agent service starting...")
    yield
    logger.info("Compliance Agent service shutting down...")


# Create FastAPI app
app = FastAPI(
    title="Compliance Agent",
    description="Transaction compliance and AML checking service",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        service="compliance-agent",
        version="1.0.0"
    )


@app.post("/assess", response_model=ComplianceResponse)
async def assess_transaction(
    request: ComplianceRequest = Body(..., description="Transaction to assess")
):
    """
    Assess a transaction for compliance risk.

    Evaluates the transaction across multiple compliance dimensions:
    - Transaction amount and velocity rules
    - Account age and user history
    - Recipient identification and OFAC screening
    - Timing pattern anomalies
    - User activity baselines

    Returns structured compliance assessment with risk level, AML score,
    flags, and recommended action (ALLOW, REVIEW, or BLOCK).
    """
    try:
        logger.info(f"Processing compliance request for user {request.user_id}")

        # Run the compliance check via Pydantic AI agent
        result = await process_compliance_request(request)

        logger.info(
            f"Compliance check completed for user {request.user_id}: "
            f"risk_level={result.risk_level}, aml_score={result.aml_score:.1f}"
        )

        return ComplianceResponse(success=True, data=result)

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Compliance check failed: {str(e)}", exc_info=True)
        return ComplianceResponse(
            success=False,
            data=None,
            error=str(e)
        )


@app.post("/init")
async def init_session(user_id: str = Body(..., description="User ID")):
    """
    Initialize a compliance checking session.
    Simple session init for consistency with other agents.
    """
    return {
        "success": True,
        "session_id": f"compliance-{user_id}",
        "agent_type": "compliance-checker",
        "framework": "pydantic-ai"
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("COMPLIANCE_PORT", 3007))
    host = os.getenv("COMPLIANCE_HOST", "0.0.0.0")

    logger.info(f"Starting Compliance Agent on {host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=os.getenv("ENVIRONMENT") == "development"
    )
