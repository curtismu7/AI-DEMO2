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
  overview:
    'Demo Engineering hosts an always-on shared Privilege multi-tenant environment. Full workstation setup, PingOne onboarding, MFA, and the live presenter script (AWS AppRole, four-eyes approve, S3, VPC bundle, kill switch/sudo, Kubernetes) live in the SE1 shared-demo guide.',
  se1GuidePath: 'privilege/SE1-Privilege-Shared-Demo.md',
  se1GuideUrl:
    'https://github.com/curtismu7/AI-DEMO2/blob/main/privilege/SE1-Privilege-Shared-Demo.md',
  agentEnvId: 'a32ebaed-d454-4f5a-9575-697cfcb6f822',
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
};

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
