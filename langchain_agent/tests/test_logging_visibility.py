import base64
import json
import logging
import importlib
from io import StringIO


def test_sensitive_data_filter_not_attached():
    """Teaching demo: tokens/claims must appear verbatim in logs."""
    from src.log_utils import structured_logger
    importlib.reload(structured_logger)

    structured_logger.setup_logging(level="DEBUG", format_type="structured")
    root = logging.getLogger()
    for h in root.handlers:
        names = [type(f).__name__ for f in h.filters]
        assert "SensitiveDataFilter" not in names
    root_filter_names = [type(f).__name__ for f in root.filters]
    assert "SensitiveDataFilter" not in root_filter_names

    # And a JWT-looking string passes through unmodified.
    for h in list(root.handlers):
        root.removeHandler(h)
    buf = StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)
    def _b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    jwt_like = f"{_b64({'alg': 'RS256'})}.{_b64({'sub': 'u1'})}.sig"
    logging.getLogger("t").debug(f"token={jwt_like}")
    assert jwt_like in buf.getvalue()
