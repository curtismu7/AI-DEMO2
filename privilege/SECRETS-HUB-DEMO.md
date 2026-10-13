# Secrets Hub: demo runbook

October 13, 2026 · SE demo script · **written from the measured guide only — no
repo code touches the Secrets Hub (it is console-only), and the steps were not
re-run on this date.** Source: [SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER](SECRETS-HUB-WITH-GOOGLE-SECRET-MANAGER.md)
(4 Oct 2026), taken from the console and Google's own audit log — Ping's
published docs did not cover the Secrets Hub at that time.

## The story in one sentence

Privilege connects to a secret store you already run, lets an admin see what's in
it, and turns "who may read this secret, for how long" into a **time-boxed,
audited grant** through a policy.

Master index row: [feature 20](../docs/privilege-agent-features.md).

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
