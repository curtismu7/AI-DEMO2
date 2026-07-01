"""
Compliance rules and heuristics for transaction assessment
"""

from models import Flag


# Thresholds
HIGH_AMOUNT_THRESHOLD = 10000  # $10k
MEDIUM_AMOUNT_THRESHOLD = 5000  # $5k
BRAND_NEW_ACCOUNT_DAYS = 30
SUSPICIOUS_HOUR_START = 2  # 2 AM UTC
SUSPICIOUS_HOUR_END = 5    # 5 AM UTC


def check_amount_rules(amount: float) -> list[Flag]:
    """Check transaction amount rules"""
    flags = []
    if amount > HIGH_AMOUNT_THRESHOLD:
        flags.append(Flag(
            code="HIGH_AMOUNT",
            description=f"Transaction amount ${amount:,.2f} exceeds high-risk threshold",
            severity="high"
        ))
    elif amount > MEDIUM_AMOUNT_THRESHOLD:
        flags.append(Flag(
            code="MEDIUM_AMOUNT",
            description=f"Transaction amount ${amount:,.2f} warrants monitoring",
            severity="medium"
        ))
    return flags


def check_account_age_rules(account_age_days: int) -> list[Flag]:
    """Check account age and velocity rules"""
    flags = []
    if account_age_days < BRAND_NEW_ACCOUNT_DAYS:
        flags.append(Flag(
            code="NEW_ACCOUNT",
            description=f"Account is brand new ({account_age_days} days old)",
            severity="high"
        ))
    return flags


def check_recipient_rules(recipient: str, recipient_type: str) -> list[Flag]:
    """Check recipient and destination rules"""
    flags = []

    # Simulate OFAC/sanctions list check
    suspicious_names = ["blocked", "embargo", "sanctioned"]
    if any(word in recipient.lower() for word in suspicious_names):
        flags.append(Flag(
            code="SANCTIONED_RECIPIENT",
            description="Recipient name matches OFAC sanctions screening",
            severity="high"
        ))

    if recipient_type == "international":
        flags.append(Flag(
            code="INTERNATIONAL_TRANSFER",
            description="Transfer to international recipient requires additional scrutiny",
            severity="medium"
        ))

    if recipient_type == "unknown":
        flags.append(Flag(
            code="UNKNOWN_RECIPIENT_TYPE",
            description="Recipient type could not be determined",
            severity="medium"
        ))

    return flags


def check_timing_rules(time_utc: str) -> list[Flag]:
    """Check transaction timing anomalies"""
    flags = []
    try:
        hour = int(time_utc.split(":")[0])
        if SUSPICIOUS_HOUR_START <= hour < SUSPICIOUS_HOUR_END:
            flags.append(Flag(
                code="OFF_HOURS_TRANSACTION",
                description=f"Transaction initiated during off-business hours ({time_utc} UTC)",
                severity="low"
            ))
    except (ValueError, IndexError):
        pass
    return flags


def check_activity_rules(activity_score: float, is_recurring: bool) -> list[Flag]:
    """Check user activity and pattern rules"""
    flags = []

    if activity_score < 30:
        flags.append(Flag(
            code="LOW_ACTIVITY",
            description="User has minimal recent transaction activity",
            severity="medium"
        ))

    if not is_recurring:
        flags.append(Flag(
            code="NEW_RECIPIENT",
            description="This is not a recurring transaction (first-time recipient)",
            severity="low"
        ))

    return flags


def calculate_aml_score(flags: list[Flag]) -> float:
    """
    Calculate AML (Anti-Money Laundering) risk score 0-100 based on flags.
    Score reflects cumulative risk from all flags.
    """
    severity_weights = {
        "high": 25,
        "medium": 12,
        "low": 5
    }

    score = 0
    for flag in flags:
        score += severity_weights.get(flag.severity, 0)

    # Cap at 100
    return min(100.0, float(score))


def determine_risk_level(aml_score: float) -> str:
    """Determine overall risk level based on AML score"""
    if aml_score >= 75:
        return "critical"
    elif aml_score >= 50:
        return "high"
    elif aml_score >= 25:
        return "medium"
    else:
        return "low"


def recommend_action(risk_level: str, aml_score: float) -> str:
    """Recommend action based on risk assessment"""
    if risk_level == "critical" or aml_score >= 80:
        return "BLOCK"
    elif risk_level == "high" or aml_score >= 50:
        return "REVIEW"
    else:
        return "ALLOW"
