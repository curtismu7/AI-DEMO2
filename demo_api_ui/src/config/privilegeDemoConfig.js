// demo_api_ui/src/config/privilegeDemoConfig.js
// SE presenter hub for the shared PingOne Privilege demo environment.

/** @typedef {'endUser' | 'admin' | 'both'} PersonaId */

/**
 * Build a PingOne console URL for the given environment id.
 * @param {string} envId
 * @returns {string}
 */
export function privilegeConsoleUrl(envId) {
  return `https://console.pingone.com/?env=${envId}`;
}

export const PRIVILEGE_DEMO = {
  title: 'PingOne Privilege — SE Demo Hub',
  subtitle: 'Shared environment presenter resource. Requires local EndUser and Admin VMs with the Privilege Agent installed.',
  adminEnvId: '88d79a9c-0dfe-4817-97aa-905bad9ca502',
  agentEnvId: 'a32ebaed-d454-4f5a-9575-697cfcb6f822',
  emailPattern: '{seemail}+role@pingone.com',
  personas: {
    platformAdmin: {
      id: 'platformAdmin',
      label: 'Platform Admin',
      email: '{seemail}+p1privilege@pingone.com',
      vm: 'Your Mac (browser)',
      envId: '88d79a9c-0dfe-4817-97aa-905bad9ca502',
      description: 'PingOne MT administrator — password reset, MFA enrollment, onboarding link generation.',
    },
    agentAdmin: {
      id: 'agentAdmin',
      label: 'Privilege Admin',
      email: '{seemail}+AgentAdmin@pingone.com',
      vm: 'Admin VM',
      envId: 'a32ebaed-d454-4f5a-9575-697cfcb6f822',
      description: 'Privilege Administrator role — approves access requests, manages policies, reviews session logs.',
    },
    endUser: {
      id: 'endUser',
      label: 'Privilege End User',
      email: '{seemail}+AgentEndUser@pingone.com',
      vm: 'EndUser VM',
      envId: 'a32ebaed-d454-4f5a-9575-697cfcb6f822',
      description: 'AgentPrivilege + Approvers groups — requests access, signs into targets, uses CLI and gateway ports.',
    },
  },
  groups: ['AgentPrivilege', 'Approver'],
  resources: {
    s3Bucket: 'bx-494915080669-us-east-1-bucket',
    s3BucketDenied: 'bx-494915080669-us-east-1-bucket-1',
    linuxServer: 'bxLinux',
    sudoPrinciple: 'david_lee_agentenduser',
  },
  warnings: [
    'Sync VM clock before every demo — Privilege sessions fail when time drifts.',
    'DO NOT click Close after creating an auto-approve policy — it cancels the policy.',
    'Guacamole RDP paste: Ctrl+Shift+Cmd to open and close the clipboard panel.',
    'Shared demo — do not run destructive kubectl commands or leave imported YAML behind.',
    'Use a dedicated Chrome profile for passkey/MFA — credentials are profile-bound.',
  ],
  setupSteps: [
    {
      id: 'reset-password',
      title: 'Reset Platform Admin password',
      description: 'Open the Admin environment console, click Forgot Password, and set a password you will remember.',
      linkEnv: 'adminEnvId',
      persona: 'platformAdmin',
    },
    {
      id: 'mfa-enroll',
      title: 'Enroll MFA for Platform Admin',
      description: 'Complete MFA enrollment (email recommended for cross-browser consistency).',
      persona: 'platformAdmin',
    },
    {
      id: 'open-agent-env',
      title: 'Open the Agent environment',
      description: 'Switch to the Agent environment where PingOne Privilege is installed.',
      linkEnv: 'agentEnvId',
      persona: 'platformAdmin',
    },
    {
      id: 'onboard-admin-vm',
      title: 'Generate onboarding link — AgentAdmin',
      description: 'Services → Privilege → Generate Onboarding Link. Launch from the Admin VM after installing the agent (do not open Privilege in browser until agent is installed).',
      persona: 'agentAdmin',
    },
    {
      id: 'onboard-enduser-vm',
      title: 'Generate onboarding link — AgentEndUser',
      description: 'Repeat onboarding link generation for the EndUser persona on the EndUser VM.',
      persona: 'endUser',
    },
    {
      id: 'install-agents',
      title: 'Install Privilege Agent on both VMs',
      description: 'Download for Windows or macOS (Arm64). Elevate to Administrator on Windows. Wait for Key Store to show Key Ring (Windows) or Secure Enclave (Mac).',
      persona: 'both',
    },
    {
      id: 'launch-agents',
      title: 'Launch agent in browser',
      description: 'Back in the browser, click Launch Agent → Always Allow → Open. Confirm "User Onboarded Successfully" on both VMs.',
      persona: 'both',
    },
    {
      id: 'persona-mfa',
      title: 'MFA for AgentAdmin and AgentEndUser',
      description: 'Reset password in Agent env, self-service login, enroll PingID Mobile app. Set Issuer: BXShared, Account Name: BX.',
      persona: 'both',
    },
    {
      id: 'snapshot',
      title: 'Sync clock and snapshot VMs',
      description: 'Adjust date/time → Sync now on each VM. Shut down and take a snapshot so you can revert quickly before demos.',
      persona: 'both',
    },
  ],
  acts: [
    {
      id: 'connect-mfa',
      actNumber: 1,
      title: 'Connect + MFA + device trust',
      persona: 'endUser',
      vm: 'EndUser VM',
      todo: [
        'Open PingOne Privilege on the EndUser VM.',
        'Accept the MFA push when prompted.',
        'On the registered device dialog, click OK.',
        'Show Key Store using TPM (Windows) or Secure Enclave (Mac).',
        'Open Console once connected.',
      ],
      talkTrack: 'MFA on initial login for privileged users is a compliance mandate for PCI DSS, SOC 2, NIST, and more. TPM or Secure Enclave ties the verified user to an onboarded machine — a phished credential cannot compromise a privileged session even with spoofed MFA.',
      pmNotes: 'TPM is a differentiated capability: device-bound assurance that stolen credentials alone cannot establish a privileged session.',
      watchFor: ['MFA push confirmation', 'Key Store shows TPM or Secure Enclave', 'Agent status shows Connected'],
    },
    {
      id: 'request-approle',
      actNumber: 2,
      title: 'Request AWS AppRole (JIT federation)',
      persona: 'endUser',
      vm: 'EndUser VM',
      todo: [
        'In Console, open Targets and check an App Role.',
        'Click Continue (multiple items can be queued).',
        'Provide initials (e.g. DRL) and submit the request.',
      ],
      talkTrack: 'Instead of creating a user in AWS, we request an App Role the user is JIT granted via federation. Requests have start and end dates — extendable for months or years.',
      pmNotes: 'Lean into fast onboarding with JIT roles versus elevated or shared accounts. Contractors often queue multiple requests at the start of their day.',
      watchFor: ['Request queue before submit', 'Start/end date range on the form'],
    },
    {
      id: 'admin-approve',
      actNumber: 3,
      title: 'Admin approves (four-eyes)',
      persona: 'admin',
      vm: 'Admin VM',
      todo: [
        'On the Admin VM, open PingOne Privilege and complete MFA.',
        'Confirm you land on the Admin view.',
        'Go to Access Request → View details.',
        'Show Approvers — Level 1 (four-eyes approval).',
        'Optionally check Auto Approve, then Approve.',
        'DO NOT Close — show the new Policy in left navigation.',
        'Click More information to show user, request, and protected resource.',
      ],
      talkTrack: 'A request must be approved before access is granted. An admin cannot approve their own sessions. Multiple approval levels are supported — four-eyes approval in many markets.',
      pmNotes: 'Vital: admin cannot self-approve. Auto-approve creates a standing policy — uncheck after demonstrating.',
      watchFor: ['Admin view in top right', 'Auto Approve checkbox', 'DO NOT Close after approve'],
    },
    {
      id: 'aws-console',
      actNumber: 4,
      title: 'EndUser signs into AWS console',
      persona: 'endUser',
      vm: 'EndUser VM',
      todo: [
        'Back on the EndUser VM, sign in to the granted target.',
        'Show AWS Web Console opens with role privileges.',
        'Navigate to S3 — role has s3Full access.',
        'Show buckets and interact with them.',
      ],
      talkTrack: 'JIT access is now live — the user signs in and receives exactly the privileges the approved role carries.',
      pmNotes: 'Demonstrates federation without creating standing AWS IAM users.',
      watchFor: ['User@environment in top right', 'S3 bucket list visible'],
    },
    {
      id: 'fine-grained-s3',
      actNumber: 5,
      title: 'Fine-grained S3 bucket + CLI proof',
      persona: 'both',
      vm: 'EndUser VM → Admin VM',
      todo: [
        'EndUser: Targets → Resources → S3 Buckets → select bx-494915080669-us-east-1-bucket.',
        'Search s3f, select s3fullaccess, add to request queue, submit with initials.',
        'Admin: Access Requests → View Details → Approve (optional auto-approve).',
        'EndUser: Copy Profile Name from the granted target.',
        'CMD: aws s3 cp anewfile.txt s3://bx-494915080669-us-east-1-bucket/anewfile.txt --profile <profile>.',
        'Change bucket suffix to -1 to show fine-grained denial.',
      ],
      talkTrack: 'We can be more fine-grained than role level — request access to a single S3 bucket and prove it with the AWS CLI profile Privilege injects.',
      pmNotes: 'Resource-level requests complement role-level AppRole access.',
      watchFor: ['Profile name copy', 'CLI succeeds on allowed bucket', 'CLI fails on -1 bucket'],
    },
    {
      id: 'bundle-vpc',
      actNumber: 6,
      title: 'Bundle behind VPC (DBs, RDP, Linux)',
      persona: 'both',
      vm: 'EndUser VM → Admin VM',
      todo: [
        'EndUser: Bundles → More Info → Request (MySQL, PostgreSQL, Windows RDP, Linux).',
        'Submit the bundle request.',
        'Admin: Access Requests → Approve (no auto-approve for bundles).',
        'EndUser: Targets → RDP → Sign In as administrator via Guacamole.',
        'Edit afile on the desktop, save, sign out.',
        'Resources → enable Local Port for MySQL, Postgres, Linux.',
        'CMD: mysql, psql, and ssh sessions through gateway ports.',
        'sudo ls / on Linux — do not exit yet.',
      ],
      talkTrack: 'Bundles group pre-defined protected resources within one cloud provider. Console and CLI access go agent-to-resource directly; gateway local ports reach assets behind the VPC firewall. Privileged secrets are never exposed — injection is always safest.',
      pmNotes: 'Guacamole uses Ctrl+Shift+Cmd for clipboard. RDP uses a principle name the end user does not know the password for.',
      watchFor: ['Guacamole tab opens', 'Local port before/after toggle', 'sudo works on Linux'],
    },
    {
      id: 'kill-switch-sudo',
      actNumber: 7,
      title: 'Kill switch + sudo command filtering',
      persona: 'both',
      vm: 'Admin VM → EndUser VM',
      todo: [
        'Admin: Policies → delete the bundle policy to kill active gateway sessions.',
        'EndUser: confirm the kill switch activated in CMD.',
        'EndUser: request bxLinux only with principle david_lee_agentenduser.',
        'Admin: approve the sudo-filter request.',
        'Admin: Server Management → lsonly — show allowed sudo commands.',
        'EndUser: ssh with local port — ls works, sudo cat /etc/hosts prompts for unknown password.',
        'Admin: Activity Logs and Session Logs — show recordings and audit.',
      ],
      talkTrack: 'Deleting a policy is an immediate kill switch. Sudo command filtering controls exactly which elevated commands are allowed — essential for SSH governance.',
      pmNotes: 'Activity logs are searchable; RDP and Linux sessions can be recorded and marked audited. DB sessions record input but not output.',
      watchFor: ['Session dies after policy delete', 'lsonly sudo filter list', 'Blocked sudo command'],
    },
    {
      id: 'kube-optional',
      actNumber: 8,
      title: 'Kubernetes cluster (optional)',
      persona: 'both',
      vm: 'EndUser VM → Admin VM',
      optional: true,
      todo: [
        'Install kubectl if missing: winget install -e --id Kubernetes.kubectl',
        'EndUser: Targets → Kube Clusters → select Cluster Admin → submit.',
        'Admin: Access Requests → Approve.',
        'EndUser: copy kubectl context command, paste in CMD.',
        'Run: kubectl get pods -A',
      ],
      talkTrack: 'Privilege extends to Kubernetes — JIT cluster admin access with the same request-and-approve workflow.',
      pmNotes: 'Shared environment — no destructive commands. Export any YAML you import before leaving.',
      watchFor: ['kubectl context copied from Privilege', 'Pod list returns successfully'],
    },
  ],
};

/**
 * Resolve console URL for a setup step linkEnv key.
 * @param {'adminEnvId' | 'agentEnvId'} linkEnv
 * @returns {string | null}
 */
export function setupStepConsoleUrl(linkEnv) {
  if (!linkEnv) return null;
  const envId = PRIVILEGE_DEMO[linkEnv];
  return envId ? privilegeConsoleUrl(envId) : null;
}

/**
 * Resolve console URL for a persona.
 * @param {keyof typeof PRIVILEGE_DEMO.personas} personaKey
 * @returns {string}
 */
export function personaConsoleUrl(personaKey) {
  const persona = PRIVILEGE_DEMO.personas[personaKey];
  if (!persona) return privilegeConsoleUrl(PRIVILEGE_DEMO.agentEnvId);
  return privilegeConsoleUrl(persona.envId);
}

export const PRIVILEGE_SETUP_STORAGE_KEY = 'bx-privilege-demo-setup-v1';
