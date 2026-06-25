from dataclasses import dataclass


@dataclass
class BffDeps:
    bff_tool_url: str
    bff_internal_secret: str
    session_id: str
