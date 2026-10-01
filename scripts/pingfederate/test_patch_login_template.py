#!/usr/bin/env python3
"""Tests for the local PF recovery-link template patch."""

import unittest

from patch_login_template import DEFAULT_RECOVERY_URL, MARKER, patch_login_template


class PatchLoginTemplateTests(unittest.TestCase):
    def test_adds_external_recovery_link_without_native_reset_handler(self):
        template = '<form method="POST"><input name="username"></form>'
        patched = patch_login_template(template)

        self.assertIn(MARKER, patched)
        self.assertIn(f'href="{DEFAULT_RECOVERY_URL}"', patched)
        self.assertIn('id="aiDemoForgotPasswordLink"', patched)
        self.assertNotIn('name="$passwordReset"', patched)

    def test_is_idempotent(self):
        template = '<form method="POST"></form>'
        once = patch_login_template(template)
        self.assertEqual(patch_login_template(once), once)

    def test_requires_form(self):
        with self.assertRaises(ValueError):
            patch_login_template('<html></html>')


if __name__ == "__main__":
    unittest.main()
