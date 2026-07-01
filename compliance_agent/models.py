"""
Pydantic models for Compliance Agent
Type-safe structured outputs for compliance checking
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class Flag(BaseModel):
    """A compliance flag or concern"""
    code: str = Field(description="Flag code (e.g., HIGH_AMOUNT, UNKNOWN_RECIPIENT)")
    description: str = Field(description="Human-readable description of the flag")
    severity: str = Field(description="Severity level: low, medium, high")


class ComplianceCheck(BaseModel):
    """Complete compliance assessment result"""
    risk_level: str = Field(
        description="Overall risk level: low, medium, high, critical",
        pattern="^(low|medium|high|critical)$"
    )
    aml_score: float = Field(
        description="AML (Anti-Money Laundering) risk score 0-100",
        ge=0.0,
        le=100.0
    )
    flags: List[Flag] = Field(
        description="List of compliance concerns found",
        default_factory=list
    )
    requires_review: bool = Field(
        description="Whether this transaction requires human review"
    )
    recommended_action: str = Field(
        description="Recommended action: ALLOW, REVIEW, BLOCK"
    )
    reasoning: str = Field(
        description="Explanation of the compliance assessment"
    )


class TransactionInput(BaseModel):
    """Transaction details to check for compliance"""
    amount: float = Field(description="Transaction amount in USD")
    recipient: str = Field(description="Recipient name or account")
    recipient_account_type: Optional[str] = Field(
        default=None,
        description="Type of recipient account: domestic, international, unknown"
    )
    user_account_age_days: int = Field(description="Age of user's account in days")
    user_recent_activity_score: float = Field(
        description="Normalized activity score (0-100)",
        ge=0.0,
        le=100.0
    )
    is_recurring: bool = Field(default=False, description="Whether this is a recurring transaction")
    time_of_day_utc: str = Field(description="Time transaction initiated (HH:MM in UTC)")


class ComplianceRequest(BaseModel):
    """Request to check transaction compliance"""
    transaction: TransactionInput = Field(description="Transaction details")
    user_id: str = Field(description="User ID for context")
    run_id: Optional[str] = Field(default=None, description="Request trace ID")
