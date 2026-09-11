from dataclasses import dataclass


@dataclass
class BffDeps:
    bff_tool_url: str
    bff_internal_secret: str
    session_id: str
    # Named on every callback: the BFF keys each run's context by it.
    run_id: str = ""
