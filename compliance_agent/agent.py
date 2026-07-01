"""
Compliance Checker Agent - Pydantic AI
Type-safe transaction compliance assessment with structured outputs
"""

from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage
from models import ComplianceRequest, ComplianceCheck, TransactionInput, Flag
from rules import (
    check_amount_rules,
    check_account_age_rules,
    check_recipient_rules,
    check_timing_rules,
    check_activity_rules,
    calculate_aml_score,
    determine_risk_level,
    recommend_action
)
import anthropic
import os


# Initialize Anthropic client
anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


# System prompt for compliance reasoning
SYSTEM_PROMPT = """You are a compliance and AML (Anti-Money Laundering) expert agent.
Your role is to assess transaction risk using available tools and structured rules.

You evaluate transactions across multiple dimensions:
1. Transaction amount and velocity
2. Account age and user history
3. Recipient identification and OFAC screening
4. Timing patterns and anomalies
5. User activity baselines

Provide clear reasoning for your risk assessment. Be conservative—flag uncertainties.
Always recommend BLOCK for critical risk, REVIEW for high risk, ALLOW for low/medium.
"""


async def assess_transaction(
    ctx: RunContext[None],
    transaction: TransactionInput,
    user_id: str
) -> ComplianceCheck:
    """
    Main compliance assessment function.
    Runs heuristic checks and returns structured ComplianceCheck result.
    """

    # Run all heuristic checks
    all_flags: list[Flag] = []

    all_flags.extend(check_amount_rules(transaction.amount))
    all_flags.extend(check_account_age_rules(transaction.user_account_age_days))
    all_flags.extend(check_recipient_rules(
        transaction.recipient,
        transaction.recipient_account_type or "unknown"
    ))
    all_flags.extend(check_timing_rules(transaction.time_of_day_utc))
    all_flags.extend(check_activity_rules(
        transaction.user_recent_activity_score,
        transaction.is_recurring
    ))

    # Calculate AML score
    aml_score = calculate_aml_score(all_flags)

    # Determine risk level
    risk_level = determine_risk_level(aml_score)

    # Recommend action
    recommended_action = recommend_action(risk_level, aml_score)

    # Build reasoning statement
    reasoning = build_reasoning(transaction, all_flags, aml_score, recommended_action)

    # Determine if review is required
    requires_review = recommended_action in ("BLOCK", "REVIEW")

    return ComplianceCheck(
        risk_level=risk_level,
        aml_score=aml_score,
        flags=all_flags,
        requires_review=requires_review,
        recommended_action=recommended_action,
        reasoning=reasoning
    )


def build_reasoning(
    transaction: TransactionInput,
    flags: list[Flag],
    aml_score: float,
    action: str
) -> str:
    """Build human-readable reasoning for compliance assessment"""

    parts = []
    parts.append(f"Transaction: ${transaction.amount:,.2f} to {transaction.recipient}")

    if flags:
        parts.append(f"Flags raised: {len(flags)}")
        for flag in flags[:3]:  # Top 3 flags
            parts.append(f"  • {flag.code}: {flag.description}")
        if len(flags) > 3:
            parts.append(f"  ... and {len(flags) - 3} more")
    else:
        parts.append("No compliance flags detected")

    parts.append(f"AML Risk Score: {aml_score:.1f}/100")
    parts.append(f"Recommended Action: {action}")

    return "; ".join(parts)


# Create agent with Pydantic AI
agent = Agent(
    model="claude-3-5-sonnet-20241022",
    system_prompt=SYSTEM_PROMPT,
    result_type=ComplianceCheck,
)


@agent.tool
async def run_compliance_checks(
    ctx: RunContext[None],
    amount: float,
    recipient: str,
    account_age_days: int,
    activity_score: float,
    is_recurring: bool,
    time_utc: str
) -> dict:
    """
    Execute all compliance checks for a transaction.
    Returns structured assessment with flags, AML score, and recommendation.
    """

    transaction = TransactionInput(
        amount=amount,
        recipient=recipient,
        user_account_age_days=account_age_days,
        user_recent_activity_score=activity_score,
        is_recurring=is_recurring,
        time_of_day_utc=time_utc
    )

    result = await assess_transaction(ctx, transaction, "")
    return result.model_dump()


async def process_compliance_request(
    request: ComplianceRequest
) -> ComplianceCheck:
    """
    Main entry point: accept a compliance request, run agent, return structured result.
    """

    prompt = f"""
    Assess this transaction for compliance risk:

    Amount: ${request.transaction.amount:,.2f}
    Recipient: {request.transaction.recipient}
    Recipient Type: {request.transaction.recipient_account_type or 'unknown'}
    Account Age: {request.transaction.user_account_age_days} days
    Activity Score: {request.transaction.user_recent_activity_score}/100
    Is Recurring: {request.transaction.is_recurring}
    Time (UTC): {request.transaction.time_of_day_utc}

    Use the compliance_checks tool to evaluate this transaction.
    Provide your risk assessment and recommendation.
    """

    # Run the agent
    result = await agent.run(
        prompt,
        tools=[run_compliance_checks],
    )

    # The agent returns a ComplianceCheck in result.data
    return result.data
