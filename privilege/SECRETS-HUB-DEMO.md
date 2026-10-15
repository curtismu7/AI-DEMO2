# Secrets Hub: demo runbook

October 13, 2026 · SE demo script · **partly verified live on 2026-10-13** (the
"State on our tenant" section below, read through the console API); the rest is
from the measured guide only — no repo code touches the Secrets Hub (it is
console-only). Source: [SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER](SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER.md)
(4 Oct 2026), taken from the console and Google's own audit log — Ping's
published docs did not cover the Secrets Hub at that time.

## The story in one sentence

Privilege connects to a secret store you already run, lets an admin see what's in
it, and turns "who may read this secret, for how long" into a **time-boxed,
audited grant** through a policy.

Master index row: [feature 20](../docs/privilege-agent-features.md).

## State on our tenant (verified live 2026-10-13)

A hub is **already connected — you do not need to add one to demo.**

| Item | Value |
|---|---|
| Hub (SecretStoreAccount) | `GCP-hub-secrets`, type GCP, account type **Project** |
| Google project | `privilege-hub-test-643070` ("Privilege Hub Test"), billing on, Secret Manager + Cloud Resource Manager APIs enabled |
| Service account | `privilege-secrets-hub@privilege-hub-test-643070.iam.gserviceaccount.com`, one user-managed key (no expiry) |
| Sync status | **Synced**, last sync `2026-10-13T05:23Z` |
| Secrets visible in Privilege | 2 — `groq-key` and `privilege-hub-test` |

- `GET /api/<tenant>/v1/secretstoreaccounts` and `/secrets` return these. The
  hub object carries the service-account key in its spec (`GcpSpec.GcpJsonCreds`):
  redact it before pasting any API output.
- **`groq-key` is a real-looking secret name — don't click View on it live.**
  Use `privilege-hub-test` for the View step.
- **Run live 2026-10-14 through the console UI** (a headless browser against
  `https://local.procyon.ai:8643/ui/admin/secrets`; the hub's overview is
  `/ui/admin/secrets/hub/gcp/GCP-hub-secrets/overview`, with tabs Overview / Secrets /
  Access Summary and buttons Resync / Policy / Edit / Delete):
  - **Resync: works.** The status changed to "Sync In Progress" / "Scanning", the Secrets
    tab read 0 while it ran, then returned to **Synced with both secrets** (last sync
    2026-10-14 06:19:34). Expect the count to drop to 0 briefly during a resync.
  - **View: ran on `privilege-hub-test`.** The details panel names the secret before View
    is clicked (the page auto-selects `groq-key` first — switch to `privilege-hub-test`).
    After View, 7 new text lines appeared in the panel; the value was deliberately **not**
    displayed here. The matching `Secret Vault Secret value accessed` audit event was
    **not located** (the console has no activity-log route I could find headless).
  - **Policy wizard, steps found:** (1) pick a secret → "Selected Secret" panel;
    (2) **Select Permission: Read** ("View secret values") **or Write** ("View and update
    secret values"); (3) **Users and Groups in this Policy** — two panes, Existing and
    Added; the Existing pane **lazy-loads** the four tenant users (`cmuir+4@pingidentity.com`,
    `cmuir+agent@pingone.com`, `cmuir+demo-user@pingone.com`, `AI Agent DemoAdmin /
    cmuir+demoadmin@pingone.com`) only after you click its "Show: All" dropdown, and the
    search box returned nothing. The wizard was **not completed**: adding a user to the
    policy was blocked as a permission grant and needs the user's explicit approval.
  - **Grant shape (read from an existing policy, not created):** `Type: SecretResources`;
    `Spec.ActionMap` has `SecretRead` and `SecretWrite`, each with `PolicyRule[]` whose
    `ObjectRef.RefKind` is `Secret`; `IssuedTo` lists the users; `NotBefore`/`NotAfter`
    bound it. **A grant of this kind already exists:** `YukonRiver-416146713043`
    (`GivenName: gogolehub`, 5 users, Read + Write, valid until **2027-06-04**), made on
    2026-10-04 — a long-lived grant, not time-boxed.
  - **Which secret that grant covers:** `privilege-hub-test` itself (the rule's `RefID` equals
    the secret object's `ObjectMeta.ID`). Policy `YukonRiver-416146713043` grants **Read + Write
    on `privilege-hub-test`** to four users (`demoadmin`, `demouser`, `cmuir+agent@pingone.com`,
    `demoUser-new`) and one group, until **2027-06-04**. So a new Read grant for `demoadmin`
    on that secret would change nothing — it already has Read + Write. To demonstrate a grant
    taking effect, use a user who is **not** in that list (for example `cmuir+4@pingidentity.com`)
    or a secret with no grant (`groq-key`).
  - **Created via API instead of the wizard?** Not done. The API shape is: `Type: SecretResources`,
    `ActionMap.SecretRead.PolicyRule[]` (and `SecretWrite`), each rule's
    `ObjectRef = {RefKind: "Secret", RefID: <secret ObjectMeta.ID>}`, `IssuedTo` = user/group refs
    (user `RefID` is base64 of `tenant@@default@@<user-uuid>`, the user's `ObjectMeta.ID`).
  - **Correction (2026-10-14):** `cmuir+4@pingidentity.com` is **also** in `YukonRiver-416146713043`
    (it is the user listed above as `demoUser-new`). All four tenant users already have Read + Write
    on `privilege-hub-test`; the only secret with no grant is `groq-key`, which may be a real key, so
    it was not used.
  - **New grant created and shown, 2026-10-14 (evening):** a `SecretResources` policy
    `tmp-f20-read-grant` — `SecretRead` only, on `privilege-hub-test`, issued to
    `cmuir+4@pingidentity.com`, `NotBefore` now / `NotAfter` +2 h — created through the API (cloned
    from the Yukon rule shape). The hub's **Access Summary** tab listed it at once:
    `tmp-f20-read-grant · privilege-hub-test · Read · 1 user · expiry`. Deleted straight after
    (the grant added no access the user did not already have). To show a grant changing what someone
    can do, add a dummy secret to the Google project first and grant that.
  - **Still not run:** the audit event for View.

## Read this before you connect anything

Three facts that change whether you should demo it live:

1. **The hub needs more than read access.** It asks for **Secret Manager Admin**,
   which can create, change and delete *every* secret in scope.
2. **The setup form omits a requirement.** Sync also needs the **Cloud Resource
   Manager API**; without it the secret count stays at 0.
3. **The service-account key you paste is written to the audit log in clear text.**
   Scope the key as narrowly as you can, and treat the demo project as burned
   afterwards (rotate/delete the key).

Use a **throwaway Google project** with no real secrets. Do not connect a project
that holds anything you care about.

Five stores can be connected: AWS Secrets Manager, Google Cloud Secret Manager,
Azure Key Vault, Delinea Secret Server, CyberArk (beta). Only Google is covered
here.

## Prepare the Google project

Billing must be enabled (Secret Manager can't be turned on without it).

```bash
gcloud services enable secretmanager.googleapis.com --project <project-id>
gcloud services enable cloudresourcemanager.googleapis.com --project <project-id>
gcloud iam service-accounts create privilege-secrets-hub --project <project-id>
for role in roles/secretmanager.admin roles/secretmanager.viewer roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding <project-id> \
    --member "serviceAccount:<service-account>" --role "$role"
done
gcloud iam service-accounts keys create <key-file> --iam-account <service-account>
chmod 600 <key-file>
```

Grant roles on the **project**, not the organisation. An org policy may block key
creation; the error names the policy. Create one or two dummy secrets
(`gcloud secrets create demo-secret --project <project-id>`).

## The run

1. **Add the hub.** Console → **Secrets Hub** → **Add Hubs** → **Integrate** on the
   GCP card → name it → account type **Project** → paste the key JSON
   (`pbcopy < <key-file>` avoids printing it) → summary → save.
2. **Sync.** It syncs once on creation; **Resync** after that. If the secret count
   stays at 0, the hub status carries the error — the usual one is
   `syncHierarchyFlat: GetProjects failed: … Cloud Resource Manager API has not
   been used … or it is disabled.` *Say:* "Three calls — search projects, list
   secrets, list versions. None reads a secret's contents."
3. **View a secret.** Secret details → **Secret Value** → **View**. *Say:* "That
   read happens now, from Google, using the hub's service account — the value
   doesn't sit in Privilege." Two independent records result: Google's audit log
   (if Secret Manager read logging is on) and a Privilege audit event,
   `Secret Vault Secret value accessed`. Don't click the circular arrow beside
   View — it may rotate the secret.
4. **Grant access with a policy.** **Policy** button on the hub page → pick a
   secret → name the users, the permission, and an expiry. The **Access Summary**
   tab then lists it (Policy / Secret / Permission / Users / Expiry). *Say:*
   "Access is a grant with an end date, not a shared credential." Creating the
   policy makes no call to Google. What a granted user then sees was **not
   tested** — don't demo that part.
5. **Show the audit trail, including the uncomfortable line.** Show the two view
   records from step 3. Then, to be transparent, show that saving the hub put the
   service-account key into the console's audit feed in clear text (visible in a
   SIEM index if the feed is shipped there). Remediation: remove that record or
   replace the key, scope the hub to one project, restrict who can read the index.

## What not to claim

- **User Token auth mode is not fed by this.** Connecting a hub and granting a
  user a secret through a policy did **not** populate the per-user vault that the
  User Token auth mode reads (see [auth modes runbook](AUTH-MODES-DEMO.md)).
  Don't present the hub as the answer to "how does the user vault get filled."
- It does **not** copy secret values into Privilege on sync, and it did **not**
  supply a secret to an app or an agent in anything tested — the flow seen is for
  people: sync, grant, view.

## What this proves, and what it does not

- **Proves:** Privilege can inventory an external secret store and gate access to
  a secret by a time-boxed, audited policy grant.
- **Does not prove:** anything about the other four stores, or that the broad
  Admin role is necessary — that is what the form requests, and it is the main
  objection a security reviewer will raise.
