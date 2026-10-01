#!/usr/bin/env python3
"""Add the local demo recovery link to a PingFederate login template."""

from __future__ import annotations

import argparse
from pathlib import Path


MARKER = "<!-- ai-demo: local password recovery link -->"
DEFAULT_RECOVERY_URL = "https://local.ping-devops.com:4000/pf-password-help.html"


def patch_login_template(template: str, recovery_url: str = DEFAULT_RECOVERY_URL) -> str:
    """Return an idempotently patched PF template.

    The stock template only renders its native reset action when PF has a
    reset-capable validator and notification publisher.  The local demo does
    not, so the link points to a same-origin operator recovery page and never
    invokes PF's unsupported ``passwordReset`` form action.
    """
    if MARKER in template:
        return template
    anchor = f'''\n                        {MARKER}\n                        <div class="ping-input-link ping-pass-change account-actions">\n                            <a id="aiDemoForgotPasswordLink" class="forgot-password" href="{recovery_url}">Forgot password?</a>\n                        </div>\n'''
    close_form = "</form>"
    if close_form not in template:
        raise ValueError("PingFederate login template has no form closing tag")
    return template.replace(close_form, anchor + "                    " + close_form, 1)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", type=Path)
    parser.add_argument("--url", default=DEFAULT_RECOVERY_URL)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    original = args.template.read_text()
    patched = patch_login_template(original, args.url)
    if patched != original:
        args.template.write_text(patched)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
