/**
 * Public catalog handlers — read-only, no user auth or banking API token.
 *
 * Vertical-aware: UC24 (progressive trust Act 1) runs in every vertical, so a
 * Super Banking branch is the wrong answer to "What clinics are near me?" or
 * "What city offices are near me?". The catalog mirrors the BFF's local
 * fallback (demo_api_server/data/publicBranchCatalog.js) — keep the two in
 * sync so the gateway path and the local path give the same answer. The
 * vertical arrives as an optional `vertical` tool param (injected by the BFF
 * from the session's active vertical); unknown or missing verticals fall back
 * to banking rather than an empty list, because an empty Act 1 reads as a
 * broken demo.
 */
import type { HandlerFn } from './types';
import { createSuccessResult } from './results';

interface CatalogEntry {
  id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  hours: string;
  atm: boolean;
}

const BANKING: CatalogEntry[] = [
  { id: 'branch-austin-main', name: 'Super Banking Main Branch', city: 'Austin', state: 'TX', address: '100 Congress Ave, Austin, TX 78701', hours: 'Mon–Fri 9:00–17:00, Sat 10:00–14:00', atm: true },
  { id: 'branch-austin-north', name: 'Super Banking North Branch', city: 'Austin', state: 'TX', address: '4500 N Lamar Blvd, Austin, TX 78756', hours: 'Mon–Fri 9:00–18:00', atm: true },
  { id: 'branch-dallas', name: 'Super Banking Dallas Branch', city: 'Dallas', state: 'TX', address: '2000 Ross Ave, Dallas, TX 75201', hours: 'Mon–Fri 9:00–17:00', atm: true },
  { id: 'branch-houston', name: 'Super Banking Houston Branch', city: 'Houston', state: 'TX', address: '910 Louisiana St, Houston, TX 77002', hours: 'Mon–Fri 9:00–17:00, Sat 9:00–13:00', atm: true },
  { id: 'branch-dallas-uptown', name: 'Super Banking Uptown Dallas Branch', city: 'Dallas', state: 'TX', address: '1445 Ross Ave, Dallas, TX 75202', hours: 'Mon–Fri 9:00–18:00', atm: true },
  { id: 'branch-miami', name: 'Super Banking Miami Branch', city: 'Miami', state: 'FL', address: '200 S Biscayne Blvd, Miami, FL 33131', hours: 'Mon–Fri 9:00–17:00', atm: true },
  { id: 'branch-denver', name: 'Super Banking Denver Branch', city: 'Denver', state: 'CO', address: '1700 Lincoln St, Denver, CO 80203', hours: 'Mon–Fri 9:00–17:00, Sat 10:00–14:00', atm: true },
];

const HEALTHCARE: CatalogEntry[] = [
  { id: 'clinic-austin', name: 'Wellspring Health Austin Clinic', city: 'Austin', state: 'TX', address: '1201 W 38th St, Austin, TX 78705', hours: 'Mon–Fri 8:00–18:00, Sat 9:00–13:00', atm: false },
  { id: 'clinic-dallas', name: 'Wellspring Health Dallas Medical Center', city: 'Dallas', state: 'TX', address: '3500 Gaston Ave, Dallas, TX 75246', hours: 'Mon–Fri 7:00–19:00', atm: false },
  { id: 'clinic-houston', name: 'Wellspring Health Houston Clinic', city: 'Houston', state: 'TX', address: '6560 Fannin St, Houston, TX 77030', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'clinic-denver', name: 'Wellspring Health Denver Clinic', city: 'Denver', state: 'CO', address: '1400 Jackson St, Denver, CO 80206', hours: 'Mon–Fri 8:00–17:00', atm: false },
];

const RETAIL: CatalogEntry[] = [
  { id: 'store-austin', name: 'Super Retail Austin Store', city: 'Austin', state: 'TX', address: '2901 S Capital of Texas Hwy, Austin, TX 78746', hours: 'Daily 10:00–21:00', atm: true },
  { id: 'store-dallas', name: 'Super Retail Dallas Store', city: 'Dallas', state: 'TX', address: '13350 Dallas Pkwy, Dallas, TX 75240', hours: 'Daily 10:00–21:00', atm: true },
  { id: 'store-miami', name: 'Super Retail Miami Store', city: 'Miami', state: 'FL', address: '701 S Miami Ave, Miami, FL 33130', hours: 'Daily 10:00–22:00', atm: true },
  { id: 'store-denver', name: 'Super Retail Denver Store', city: 'Denver', state: 'CO', address: '3000 E 1st Ave, Denver, CO 80206', hours: 'Daily 10:00–20:00', atm: true },
];

const GOVERNMENT: CatalogEntry[] = [
  { id: 'gov-austin', name: 'Austin City Permits Office', city: 'Austin', state: 'TX', address: '6310 Wilhelmina Delco Dr, Austin, TX 78752', hours: 'Mon–Fri 8:00–16:00', atm: false },
  { id: 'gov-dallas', name: 'Dallas County Records Office', city: 'Dallas', state: 'TX', address: '509 Main St, Dallas, TX 75202', hours: 'Mon–Fri 8:00–16:30', atm: false },
  { id: 'gov-houston', name: 'Houston City Services Office', city: 'Houston', state: 'TX', address: '900 Bagby St, Houston, TX 77002', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'gov-denver', name: 'Denver County Clerk Office', city: 'Denver', state: 'CO', address: '201 W Colfax Ave, Denver, CO 80202', hours: 'Mon–Fri 8:00–16:30', atm: false },
];

const UNIVERSITY: CatalogEntry[] = [
  { id: 'campus-austin', name: 'Riverbend University Austin Campus', city: 'Austin', state: 'TX', address: '2100 Speedway, Austin, TX 78712', hours: 'Mon–Fri 7:00–22:00, Sat 9:00–17:00', atm: true },
  { id: 'campus-dallas', name: 'Riverbend University Dallas Hall', city: 'Dallas', state: 'TX', address: '6425 Boaz Ln, Dallas, TX 75205', hours: 'Mon–Fri 8:00–20:00', atm: true },
  { id: 'campus-houston', name: 'Riverbend University Houston Library', city: 'Houston', state: 'TX', address: '4333 University Dr, Houston, TX 77204', hours: 'Daily 8:00–24:00', atm: false },
  { id: 'campus-denver', name: 'Riverbend University Denver Campus', city: 'Denver', state: 'CO', address: '2199 S University Blvd, Denver, CO 80208', hours: 'Mon–Fri 7:30–21:00', atm: true },
];

const WORKFORCE: CatalogEntry[] = [
  { id: 'wf-austin', name: 'Northwind People Operations Office — Austin', city: 'Austin', state: 'TX', address: '500 W 2nd St, Austin, TX 78701', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'wf-dallas', name: 'Northwind People Operations Office — Dallas', city: 'Dallas', state: 'TX', address: '2200 Ross Ave, Dallas, TX 75201', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'wf-miami', name: 'Northwind People Operations Office — Miami', city: 'Miami', state: 'FL', address: '78 SW 7th St, Miami, FL 33130', hours: 'Mon–Fri 9:00–18:00', atm: false },
  { id: 'wf-denver', name: 'Northwind People Operations Office — Denver', city: 'Denver', state: 'CO', address: '1144 15th St, Denver, CO 80202', hours: 'Mon–Fri 8:00–17:00', atm: false },
];

const SPORTING_GOODS: CatalogEntry[] = [
  { id: 'sg-austin', name: 'Super Sports Austin Outfitter', city: 'Austin', state: 'TX', address: '9607 Research Blvd, Austin, TX 78759', hours: 'Mon–Sat 9:00–21:00, Sun 10:00–19:00', atm: true },
  { id: 'sg-dallas', name: 'Super Sports Dallas Store', city: 'Dallas', state: 'TX', address: '7700 W Northwest Hwy, Dallas, TX 75225', hours: 'Mon–Sat 9:00–21:00', atm: true },
  { id: 'sg-houston', name: 'Super Sports Houston Store', city: 'Houston', state: 'TX', address: '5000 Westheimer Rd, Houston, TX 77056', hours: 'Daily 10:00–20:00', atm: true },
  { id: 'sg-denver', name: 'Super Sports Denver Outfitter', city: 'Denver', state: 'CO', address: '1000 Broadway, Denver, CO 80203', hours: 'Mon–Sat 9:00–20:00', atm: true },
];

const MANUFACTURING: CatalogEntry[] = [
  { id: 'plant-austin', name: 'Ironline Austin Assembly Plant', city: 'Austin', state: 'TX', address: '9500 Johnny Morris Rd, Austin, TX 78724', hours: 'Mon–Fri 6:00–18:00', atm: false },
  { id: 'plant-dallas', name: 'Ironline Dallas Fabrication Plant', city: 'Dallas', state: 'TX', address: '4200 S Lamar St, Dallas, TX 75215', hours: 'Mon–Fri 6:00–18:00', atm: false },
  { id: 'plant-houston', name: 'Ironline Houston Distribution Facility', city: 'Houston', state: 'TX', address: '8600 Market St, Houston, TX 77029', hours: 'Mon–Sat 5:00–20:00', atm: false },
  { id: 'plant-denver', name: 'Ironline Denver Components Plant', city: 'Denver', state: 'CO', address: '5000 E 39th Ave, Denver, CO 80207', hours: 'Mon–Fri 6:00–17:00', atm: false },
];

const INVESTMENT: CatalogEntry[] = [
  { id: 'inv-austin', name: 'Meridian Wealth Austin Branch', city: 'Austin', state: 'TX', address: '300 W 6th St, Austin, TX 78701', hours: 'Mon–Fri 8:30–17:30', atm: false },
  { id: 'inv-dallas', name: 'Meridian Wealth Dallas Office', city: 'Dallas', state: 'TX', address: '2100 McKinney Ave, Dallas, TX 75201', hours: 'Mon–Fri 8:30–17:30', atm: false },
  { id: 'inv-miami', name: 'Meridian Wealth Miami Office', city: 'Miami', state: 'FL', address: '1450 Brickell Ave, Miami, FL 33131', hours: 'Mon–Fri 9:00–18:00', atm: false },
  { id: 'inv-denver', name: 'Meridian Wealth Denver Branch', city: 'Denver', state: 'CO', address: '1670 Broadway, Denver, CO 80202', hours: 'Mon–Fri 8:30–17:00', atm: false },
];

const AIRLINES: CatalogEntry[] = [
  { id: 'airport-austin', name: 'Austin-Bergstrom International Airport — United Terminal', city: 'Austin', state: 'TX', address: '3600 Presidential Blvd, Austin, TX 78719', hours: 'Ticket counter daily 4:00–20:00', atm: true },
  { id: 'airport-dallas', name: 'Dallas/Fort Worth International Airport — United Terminal E', city: 'Dallas', state: 'TX', address: '2400 Aviation Dr, DFW Airport, TX 75261', hours: 'Ticket counter daily 4:00–22:00', atm: true },
  { id: 'airport-houston', name: 'George Bush Intercontinental Airport — United Terminal C', city: 'Houston', state: 'TX', address: '2800 N Terminal Rd, Houston, TX 77032', hours: 'Ticket counter daily 4:00–23:00', atm: true },
  { id: 'airport-denver', name: 'Denver International Airport — United Concourse B', city: 'Denver', state: 'CO', address: '8500 Peña Blvd, Denver, CO 80249', hours: 'Ticket counter daily 4:00–22:00', atm: true },
  { id: 'airport-miami', name: 'Miami International Airport — United Terminal E', city: 'Miami', state: 'FL', address: '2100 NW 42nd Ave, Miami, FL 33126', hours: 'Ticket counter daily 5:00–21:00', atm: true },
];

const CATALOG_BY_VERTICAL: Record<string, CatalogEntry[]> = {
  banking: BANKING,
  healthcare: HEALTHCARE,
  retail: RETAIL,
  government: GOVERNMENT,
  university: UNIVERSITY,
  workforce: WORKFORCE,
  'sporting-goods': SPORTING_GOODS,
  manufacturing: MANUFACTURING,
  investment: INVESTMENT,
  airlines: AIRLINES,
};

/** Noun each vertical calls its locations, for headings and no-match replies. */
const LABEL_BY_VERTICAL: Record<string, string> = {
  banking: 'branch',
  healthcare: 'clinic',
  retail: 'store',
  government: 'office',
  university: 'campus location',
  workforce: 'office',
  'sporting-goods': 'store',
  manufacturing: 'plant',
  investment: 'branch',
  airlines: 'airport',
};

/** Brand each vertical's headings carry — never "Super Banking" outside banking. */
const BRAND_BY_VERTICAL: Record<string, string> = {
  banking: 'Super Banking',
  healthcare: 'Wellspring Health',
  retail: 'Super Retail',
  government: 'City & County',
  university: 'Riverbend University',
  workforce: 'Northwind',
  'sporting-goods': 'Super Sports',
  manufacturing: 'Ironline',
  investment: 'Meridian Wealth',
  airlines: 'United',
};

function searchBranches(city: string | undefined, vertical: string) {
  const list = CATALOG_BY_VERTICAL[vertical] || CATALOG_BY_VERTICAL.banking;
  const raw = typeof city === 'string' ? city.trim() : '';
  if (!raw) return { branches: [...list], query: null as string | null };
  const needle = raw.toLowerCase();
  const branches = list.filter(
    (b) => b.city.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle),
  );
  return { branches, query: raw };
}

function formatReply(result: ReturnType<typeof searchBranches>, vertical: string): string {
  const key = LABEL_BY_VERTICAL[vertical] ? vertical : 'banking';
  const label = LABEL_BY_VERTICAL[key];
  const brand = BRAND_BY_VERTICAL[key];
  const { branches, query } = result;
  if (!branches.length) {
    return query
      ? `No ${brand} ${label}s matched "${query}". Try Austin, Dallas, or Houston.`
      : `No ${label} locations are available right now.`;
  }
  const heading = query
    ? `${brand} ${label}s near **${query}**`
    : `${brand} ${label} locations`;
  const lines = branches.map((b) => {
    const atm = b.atm ? ' · ATM available' : '';
    return `• **${b.name}** (${b.city}, ${b.state})\n  ${b.address}\n  Hours: ${b.hours}${atm}`;
  });
  return `${heading}:\n\n${lines.join('\n\n')}`;
}

/** Return static location catalog with hours (progressive trust Act 1). */
export const executeGetBranchHours: HandlerFn = async (_deps, _token, params) => {
  const city = typeof params?.city === 'string' ? params.city : undefined;
  const vertical = typeof params?.vertical === 'string' && CATALOG_BY_VERTICAL[params.vertical]
    ? params.vertical
    : 'banking';
  const result = searchBranches(city, vertical);
  const data = {
    branches: result.branches,
    query: result.query,
    message: formatReply(result, vertical),
  };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
