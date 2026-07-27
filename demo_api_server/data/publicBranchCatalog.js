// demo_api_server/data/publicBranchCatalog.js
/**
 * Static public branch / ATM catalog — no PII, no auth required.
 * Used by Act 1 of the progressive trust demo (UC24).
 */
'use strict';

const BRANCHES = Object.freeze([
  {
    id: 'branch-austin-main',
    name: 'Super Banking Main Branch',
    city: 'Austin',
    state: 'TX',
    address: '100 Congress Ave, Austin, TX 78701',
    hours: 'Mon–Fri 9:00–17:00, Sat 10:00–14:00',
    atm: true,
  },
  {
    id: 'branch-austin-north',
    name: 'Super Banking North Branch',
    city: 'Austin',
    state: 'TX',
    address: '4500 N Lamar Blvd, Austin, TX 78756',
    hours: 'Mon–Fri 9:00–18:00',
    atm: true,
  },
  {
    id: 'branch-dallas',
    name: 'Super Banking Dallas Branch',
    city: 'Dallas',
    state: 'TX',
    address: '2000 Ross Ave, Dallas, TX 75201',
    hours: 'Mon–Fri 9:00–17:00',
    atm: true,
  },
  {
    id: 'branch-houston',
    name: 'Super Banking Houston Branch',
    city: 'Houston',
    state: 'TX',
    address: '910 Louisiana St, Houston, TX 77002',
    hours: 'Mon–Fri 9:00–17:00, Sat 9:00–13:00',
    atm: true,
  },
  {
    id: 'branch-dallas-uptown',
    name: 'Super Banking Uptown Dallas Branch',
    city: 'Dallas',
    state: 'TX',
    address: '1445 Ross Ave, Dallas, TX 75202',
    hours: 'Mon–Fri 9:00–18:00',
    atm: true,
  },
  {
    id: 'branch-miami',
    name: 'Super Banking Miami Branch',
    city: 'Miami',
    state: 'FL',
    address: '200 S Biscayne Blvd, Miami, FL 33131',
    hours: 'Mon–Fri 9:00–17:00',
    atm: true,
  },
  {
    id: 'branch-denver',
    name: 'Super Banking Denver Branch',
    city: 'Denver',
    state: 'CO',
    address: '1700 Lincoln St, Denver, CO 80203',
    hours: 'Mon–Fri 9:00–17:00, Sat 10:00–14:00',
    atm: true,
  },
]);

/**
 * Search branches by optional city substring (case-insensitive).
 * @param {{ city?: string }} [params]
 * @returns {{ branches: typeof BRANCHES[number][], query: string|null }}
 */
function searchPublicBranches(params = {}) {
  const raw = typeof params.city === 'string' ? params.city.trim() : '';
  if (!raw) {
    return { branches: [...BRANCHES], query: null };
  }
  const needle = raw.toLowerCase();
  const branches = BRANCHES.filter(
    (b) => b.city.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle),
  );
  return { branches, query: raw };
}

/**
 * Format branch list for agent chat replies.
 * @param {ReturnType<typeof searchPublicBranches>} result
 */
function formatBranchCatalogReply(result) {
  const { branches, query } = result;
  if (!branches.length) {
    return query
      ? `No Super Banking branches matched "${query}". Try Austin, Dallas, or Houston.`
      : 'No branch locations are available right now.';
  }
  const heading = query
    ? `Super Banking branches near **${query}**`
    : 'Super Banking branch locations';
  const lines = branches.map((b) => {
    const atm = b.atm ? ' · ATM available' : '';
    return `• **${b.name}** (${b.city}, ${b.state})\n  ${b.address}\n  Hours: ${b.hours}${atm}`;
  });
  return `${heading}:\n\n${lines.join('\n\n')}`;
}

module.exports = { BRANCHES, searchPublicBranches, formatBranchCatalogReply };
