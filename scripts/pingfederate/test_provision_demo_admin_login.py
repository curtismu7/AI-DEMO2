#!/usr/bin/env python3
"""Unit tests for the PF demo-admin login provisioning helpers."""

import copy
import unittest

from provision_demo_admin_login import (
    build_pcv_update,
    find_user_row,
)


class ProvisionDemoAdminLoginTests(unittest.TestCase):
    def setUp(self):
        self.pcv = {
            "id": "aiDemoPfSimplePcv",
            "name": "AI Demo PF Browser Users",
            "pluginDescriptorRef": {"id": "org.sourceid.saml20.domain.SimpleUsernamePasswordCredentialValidator"},
            "configuration": {
                "tables": [{
                    "name": "Users",
                    "rows": [{
                        "fields": [
                            {"name": "Username", "value": "demouser"},
                            {"name": "Relax Password Requirements", "value": "true"},
                            {"name": "Password", "encryptedValue": "OBF:old"},
                            {"name": "Confirm Password", "encryptedValue": "OBF:old-confirm"},
                        ],
                        "defaultRow": False,
                    }],
                }],
                "fields": [],
            },
        }

    def test_adds_demo_admin_without_touching_existing_users(self):
        original = copy.deepcopy(self.pcv)
        updated = build_pcv_update(self.pcv, "demoadmin", "ConfiguredPassword!")

        self.assertIsNot(updated, self.pcv)
        self.assertEqual(find_user_row(updated, "demoadmin")["username"], "demoadmin")
        row = find_user_row(updated, "demoadmin")["row"]
        fields = {field["name"]: field for field in row["fields"]}
        self.assertEqual(fields["Password"]["value"], "ConfiguredPassword!")
        self.assertEqual(fields["Confirm Password"]["value"], "ConfiguredPassword!")
        self.assertNotIn("encryptedValue", fields["Password"])
        self.assertEqual(updated["configuration"]["tables"][0]["rows"][0], original["configuration"]["tables"][0]["rows"][0])

    def test_updates_existing_demo_admin_and_preserves_unrelated_fields(self):
        self.pcv["configuration"]["tables"][0]["rows"].append({
            "fields": [
                {"name": "Username", "value": "demoadmin"},
                {"name": "Relax Password Requirements", "value": "false"},
                {"name": "Password", "encryptedValue": "OBF:old-admin"},
                {"name": "Confirm Password", "encryptedValue": "OBF:old-admin-confirm"},
            ],
            "defaultRow": False,
        })
        updated = build_pcv_update(self.pcv, "demoadmin", "NewConfiguredPassword!")
        row = find_user_row(updated, "demoadmin")["row"]
        fields = {field["name"]: field for field in row["fields"]}
        self.assertEqual(fields["Password"]["value"], "NewConfiguredPassword!")
        self.assertEqual(fields["Confirm Password"]["value"], "NewConfiguredPassword!")
        self.assertEqual(fields["Relax Password Requirements"]["value"], "true")
        self.assertNotIn("encryptedValue", fields["Password"])

if __name__ == "__main__":
    unittest.main()
