/**
 * Public catalog handlers — read-only, no user auth or banking API token.
 */
import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

const PUBLIC_BRANCHES = [
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
] as const;

function searchBranches(city?: string) {
  const raw = typeof city === 'string' ? city.trim() : '';
  if (!raw) return { branches: [...PUBLIC_BRANCHES], query: null as string | null };
  const needle = raw.toLowerCase();
  const branches = PUBLIC_BRANCHES.filter(
    (b) => b.city.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle),
  );
  return { branches, query: raw };
}

function formatReply(result: ReturnType<typeof searchBranches>): string {
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

/** Return static branch / ATM hours (progressive trust Act 1). */
export const executeGetBranchHours: HandlerFn = async (_deps, _token, params) => {
  const city = typeof params?.city === 'string' ? params.city : undefined;
  const result = searchBranches(city);
  const data = {
    branches: result.branches,
    query: result.query,
    message: formatReply(result),
  };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
