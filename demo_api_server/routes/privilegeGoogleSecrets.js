'use strict';

/**
 * Secrets Hub — Google Secret Manager demo route (2026-11 rework).
 *
 * The Secrets Hub is a console feature, not a gateway-brokered agent flow:
 * Privilege inventories an external secret store (sync), grants named users
 * time-boxed access through a policy, and reads a secret's value from Google
 * only when someone views it. Two independent audit trails result: Google's
 * own audit log and Privilege's audit feed. It does NOT feed the gateway's
 * User Token auth mode and did not supply a secret to an agent in anything
 * tested (privilege/SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER.md, 2026-10-04).
 *
 * This route serves the measured tenant snapshot (data/secrets-hub-snapshot.json,
 * exported 2026-11-17 via the console API) — read-only, no live console call,
 * no secret values, no service-account credentials. Source of the runbook
 * text: privilege/SECRETS-HUB-DEMO.md (partly verified live 2026-10-13/14).
 */

const express = require('express');
const { requireSession } = require('../middleware/auth');
const snapshot = require('../data/secrets-hub-snapshot.json');

const router = express.Router();

// GET /api/privilege-google-secrets/hub — the tenant's hub state + grant + runbook facts.
router.get('/hub', requireSession, (req, res) => {
  res.json({
    ...snapshot,
    source: 'console-export-snapshot',
    // The runbook's honesty list, served as data so the page and the facts stay in sync.
    doesNot: [
      'The hub does not feed the gateway\'s User Token auth mode — verified live: with a hub and a user policy in place, User Token still forwarded nothing.',
      'It did not supply a secret to an app or an agent in anything tested — the flow seen is for people: sync, grant, view.',
      'It does not copy secret values into Privilege on sync — a sync reads names and versions only; a view reads the value from Google at that moment.',
    ],
    auditTrail: [
      { side: 'Google', event: 'AccessSecretVersion', where: 'Google Cloud audit log (project privilege-hub-test-643070), when Secret Manager read logging is on' },
      { side: 'Privilege', event: 'Secret Vault Secret value accessed', where: 'the Privilege console audit feed' },
    ],
    uncomfortable: {
      fact: 'Saving the hub wrote the service-account key — private key and all — into the console\'s audit feed in clear text.',
      why: 'The key carries Secret Manager Admin: anyone who can read the SIEM index can use it against every secret the hub reaches.',
      remediation: [
        'Scope the hub to one project, not the organisation.',
        'Restrict who can read the SIEM index.',
        'Remove that audit record or rotate the key after adding/editing a hub.',
        'Turn on Secret Manager read logging so every hub read is recorded on Google\'s side.',
      ],
    },
    run: [
      { step: 1, title: 'Add the hub', say: 'Console → Secrets Hub → Add Hubs → Integrate on the GCP card → Project → paste the key JSON.', detail: 'Project type needs Secret Manager Admin, Viewer and Secret Accessor on the project. The form omits one requirement: sync also needs the Cloud Resource Manager API.' },
      { step: 2, title: 'Sync', say: 'Three calls — search projects, list secrets, list versions. None reads a secret\'s contents.', detail: 'A sync once on creation; Resync after that. If the count stays at 0 the hub status carries the error (usually the Cloud Resource Manager API being off).' },
      { step: 3, title: 'View a secret', say: 'That read happens now, from Google, using the hub\'s service account — the value doesn\'t sit in Privilege.', detail: 'Two independent records result: Google\'s audit log and a Privilege audit event. Don\'t click the circular arrow beside View — it may rotate the secret.' },
      { step: 4, title: 'Grant access with a policy', say: 'Access is a grant with an end date, not a shared credential.', detail: 'Policy → pick a secret → users, permission (Read = view values, Write = view and update), expiry. Creating the policy makes no call to Google. What a granted user then sees was not tested — don\'t demo that part.' },
    ],
  });
});

module.exports = { router };
