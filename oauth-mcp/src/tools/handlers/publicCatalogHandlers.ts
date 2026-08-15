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
  image: string;
}

const BANKING: CatalogEntry[] = [
  { id: 'branch-austin-main', name: 'Super Banking Main Branch', city: 'Austin', state: 'TX', address: '100 Congress Ave, Austin, TX 78701', hours: 'Mon–Fri 9:00–17:00, Sat 10:00–14:00', atm: true, image: 'https://images.unsplash.com/photo-1760555960699-dc19c4104301?w=400&h=300&fit=crop' },
  { id: 'branch-austin-north', name: 'Super Banking North Branch', city: 'Austin', state: 'TX', address: '4500 N Lamar Blvd, Austin, TX 78756', hours: 'Mon–Fri 9:00–18:00', atm: true, image: 'https://images.unsplash.com/photo-1785220299728-b4e28272616b?w=400&h=300&fit=crop' },
  { id: 'branch-dallas', name: 'Super Banking Dallas Branch', city: 'Dallas', state: 'TX', address: '2000 Ross Ave, Dallas, TX 75201', hours: 'Mon–Fri 9:00–17:00', atm: true, image: 'https://images.unsplash.com/photo-1773051009159-b9449bec12c4?w=400&h=300&fit=crop' },
  { id: 'branch-houston', name: 'Super Banking Houston Branch', city: 'Houston', state: 'TX', address: '910 Louisiana St, Houston, TX 77002', hours: 'Mon–Fri 9:00–17:00, Sat 9:00–13:00', atm: true, image: 'https://images.unsplash.com/photo-1759751587897-71627e7d8281?w=400&h=300&fit=crop' },
  { id: 'branch-dallas-uptown', name: 'Super Banking Uptown Dallas Branch', city: 'Dallas', state: 'TX', address: '1445 Ross Ave, Dallas, TX 75202', hours: 'Mon–Fri 9:00–18:00', atm: true, image: 'https://images.unsplash.com/photo-1642864259232-48286450e127?w=400&h=300&fit=crop' },
  { id: 'branch-miami', name: 'Super Banking Miami Branch', city: 'Miami', state: 'FL', address: '200 S Biscayne Blvd, Miami, FL 33131', hours: 'Mon–Fri 9:00–17:00', atm: true, image: 'https://images.unsplash.com/photo-1752243210943-5c3d74a1152d?w=400&h=300&fit=crop' },
  { id: 'branch-denver', name: 'Super Banking Denver Branch', city: 'Denver', state: 'CO', address: '1700 Lincoln St, Denver, CO 80203', hours: 'Mon–Fri 9:00–17:00, Sat 10:00–14:00', atm: true, image: 'https://images.unsplash.com/photo-1774557936872-12370e90c769?w=400&h=300&fit=crop' },
];

const HEALTHCARE: CatalogEntry[] = [
  { id: 'clinic-austin', name: 'Wellspring Health Austin Clinic', city: 'Austin', state: 'TX', address: '1201 W 38th St, Austin, TX 78705', hours: 'Mon–Fri 8:00–18:00, Sat 9:00–13:00', atm: false, image: 'https://images.unsplash.com/photo-1769698678497-c41f0ab47c3e?w=400&h=300&fit=crop' },
  { id: 'clinic-dallas', name: 'Wellspring Health Dallas Medical Center', city: 'Dallas', state: 'TX', address: '3500 Gaston Ave, Dallas, TX 75246', hours: 'Mon–Fri 7:00–19:00', atm: false, image: 'https://images.unsplash.com/photo-1586773860418-d37222d8fce3?w=400&h=300&fit=crop' },
  { id: 'clinic-houston', name: 'Wellspring Health Houston Clinic', city: 'Houston', state: 'TX', address: '6560 Fannin St, Houston, TX 77030', hours: 'Mon–Fri 8:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1766454919271-aedfdfcb1861?w=400&h=300&fit=crop' },
  { id: 'clinic-denver', name: 'Wellspring Health Denver Clinic', city: 'Denver', state: 'CO', address: '1400 Jackson St, Denver, CO 80206', hours: 'Mon–Fri 8:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1764727291644-5dcb0b1a0375?w=400&h=300&fit=crop' },
];

const RETAIL: CatalogEntry[] = [
  { id: 'store-austin', name: 'Super Retail Austin Store', city: 'Austin', state: 'TX', address: '2901 S Capital of Texas Hwy, Austin, TX 78746', hours: 'Daily 10:00–21:00', atm: true, image: 'https://images.unsplash.com/photo-1516274626895-055a99214f08?w=400&h=300&fit=crop' },
  { id: 'store-dallas', name: 'Super Retail Dallas Store', city: 'Dallas', state: 'TX', address: '13350 Dallas Pkwy, Dallas, TX 75240', hours: 'Daily 10:00–21:00', atm: true, image: 'https://images.unsplash.com/photo-1705951504397-9fe0c883b57e?w=400&h=300&fit=crop' },
  { id: 'store-miami', name: 'Super Retail Miami Store', city: 'Miami', state: 'FL', address: '701 S Miami Ave, Miami, FL 33130', hours: 'Daily 10:00–22:00', atm: true, image: 'https://images.unsplash.com/photo-1654490960639-4170f6583da7?w=400&h=300&fit=crop' },
  { id: 'store-denver', name: 'Super Retail Denver Store', city: 'Denver', state: 'CO', address: '3000 E 1st Ave, Denver, CO 80206', hours: 'Daily 10:00–20:00', atm: true, image: 'https://images.unsplash.com/photo-1576354998198-99dc1d2c3d36?w=400&h=300&fit=crop' },
];

const ABERCROMBIE_FITCH: CatalogEntry[] = [
  { id: 'anf-austin', name: 'Abercrombie & Fitch at Domain NORTHSIDE', city: 'Austin', state: 'TX', address: '11700 Domain Blvd, Austin, TX 78758', hours: 'Daily 10:00–21:00', atm: false, image: 'https://images.unsplash.com/photo-1603400521630-9f2de124b33b?w=400&h=300&fit=crop' },
  { id: 'anf-dallas', name: 'Abercrombie & Fitch at NorthPark Center', city: 'Dallas', state: 'TX', address: '8687 N Central Expy, Dallas, TX 75225', hours: 'Daily 10:00–20:00', atm: false, image: 'https://images.unsplash.com/photo-1729487151777-b4be9098ecbb?w=400&h=300&fit=crop' },
  { id: 'anf-miami', name: 'Abercrombie & Fitch at Aventura Mall', city: 'Miami', state: 'FL', address: '19501 Biscayne Blvd, Aventura, FL 33180', hours: 'Daily 10:00–21:00', atm: false, image: 'https://images.unsplash.com/photo-1621261027519-a71ac66d5a68?w=400&h=300&fit=crop' },
  { id: 'anf-denver', name: 'Abercrombie & Fitch at Cherry Creek', city: 'Denver', state: 'CO', address: '3000 E 1st Ave, Denver, CO 80206', hours: 'Daily 10:00–20:00', atm: false, image: 'https://images.unsplash.com/photo-1769107805465-bfd41863f1a0?w=400&h=300&fit=crop' },
];

const GOVERNMENT: CatalogEntry[] = [
  { id: 'gov-austin', name: 'Austin City Permits Office', city: 'Austin', state: 'TX', address: '6310 Wilhelmina Delco Dr, Austin, TX 78752', hours: 'Mon–Fri 8:00–16:00', atm: false, image: 'https://images.unsplash.com/photo-1760872645824-0ba29c51950a?w=400&h=300&fit=crop' },
  { id: 'gov-dallas', name: 'Dallas County Records Office', city: 'Dallas', state: 'TX', address: '509 Main St, Dallas, TX 75202', hours: 'Mon–Fri 8:00–16:30', atm: false, image: 'https://images.unsplash.com/photo-1760872645824-49f21b002e61?w=400&h=300&fit=crop' },
  { id: 'gov-houston', name: 'Houston City Services Office', city: 'Houston', state: 'TX', address: '900 Bagby St, Houston, TX 77002', hours: 'Mon–Fri 8:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1771607500173-c87fcddc5fcf?w=400&h=300&fit=crop' },
  { id: 'gov-denver', name: 'Denver County Clerk Office', city: 'Denver', state: 'CO', address: '201 W Colfax Ave, Denver, CO 80202', hours: 'Mon–Fri 8:00–16:30', atm: false, image: 'https://images.unsplash.com/photo-1780688999553-0180bd938220?w=400&h=300&fit=crop' },
];

const UNIVERSITY: CatalogEntry[] = [
  { id: 'campus-austin', name: 'Riverbend University Austin Campus', city: 'Austin', state: 'TX', address: '2100 Speedway, Austin, TX 78712', hours: 'Mon–Fri 7:00–22:00, Sat 9:00–17:00', atm: true, image: 'https://images.unsplash.com/photo-1731349219592-60ca16964631?w=400&h=300&fit=crop' },
  { id: 'campus-dallas', name: 'Riverbend University Dallas Hall', city: 'Dallas', state: 'TX', address: '6425 Boaz Ln, Dallas, TX 75205', hours: 'Mon–Fri 8:00–20:00', atm: true, image: 'https://images.unsplash.com/photo-1641160616553-a9d21a846e49?w=400&h=300&fit=crop' },
  { id: 'campus-houston', name: 'Riverbend University Houston Library', city: 'Houston', state: 'TX', address: '4333 University Dr, Houston, TX 77204', hours: 'Daily 8:00–24:00', atm: false, image: 'https://images.unsplash.com/photo-1632988663082-4bac2c1847a0?w=400&h=300&fit=crop' },
  { id: 'campus-denver', name: 'Riverbend University Denver Campus', city: 'Denver', state: 'CO', address: '2199 S University Blvd, Denver, CO 80208', hours: 'Mon–Fri 7:30–21:00', atm: true, image: 'https://images.unsplash.com/photo-1728206313441-281ef4ea5d62?w=400&h=300&fit=crop' },
];

const WORKFORCE: CatalogEntry[] = [
  { id: 'wf-austin', name: 'Northwind People Operations Office — Austin', city: 'Austin', state: 'TX', address: '500 W 2nd St, Austin, TX 78701', hours: 'Mon–Fri 8:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1718220268527-4477fd170775?w=400&h=300&fit=crop' },
  { id: 'wf-dallas', name: 'Northwind People Operations Office — Dallas', city: 'Dallas', state: 'TX', address: '2200 Ross Ave, Dallas, TX 75201', hours: 'Mon–Fri 8:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1556761175-4b46a572b786?w=400&h=300&fit=crop' },
  { id: 'wf-miami', name: 'Northwind People Operations Office — Miami', city: 'Miami', state: 'FL', address: '78 SW 7th St, Miami, FL 33130', hours: 'Mon–Fri 9:00–18:00', atm: false, image: 'https://images.unsplash.com/photo-1565262353342-6e919eab5b58?w=400&h=300&fit=crop' },
  { id: 'wf-denver', name: 'Northwind People Operations Office — Denver', city: 'Denver', state: 'CO', address: '1144 15th St, Denver, CO 80202', hours: 'Mon–Fri 8:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1758448656987-cfae6bf225e4?w=400&h=300&fit=crop' },
];

const SPORTING_GOODS: CatalogEntry[] = [
  { id: 'sg-austin', name: 'Super Sports Austin Outfitter', city: 'Austin', state: 'TX', address: '9607 Research Blvd, Austin, TX 78759', hours: 'Mon–Sat 9:00–21:00, Sun 10:00–19:00', atm: true, image: 'https://images.unsplash.com/photo-1779091188677-24c724eb7cd3?w=400&h=300&fit=crop' },
  { id: 'sg-dallas', name: 'Super Sports Dallas Store', city: 'Dallas', state: 'TX', address: '7700 W Northwest Hwy, Dallas, TX 75225', hours: 'Mon–Sat 9:00–21:00', atm: true, image: 'https://images.unsplash.com/photo-1781194533125-6306b9d6175f?w=400&h=300&fit=crop' },
  { id: 'sg-houston', name: 'Super Sports Houston Store', city: 'Houston', state: 'TX', address: '5000 Westheimer Rd, Houston, TX 77056', hours: 'Daily 10:00–20:00', atm: true, image: 'https://images.unsplash.com/photo-1762971812776-2d7c3911f876?w=400&h=300&fit=crop' },
  { id: 'sg-denver', name: 'Super Sports Denver Outfitter', city: 'Denver', state: 'CO', address: '1000 Broadway, Denver, CO 80203', hours: 'Mon–Sat 9:00–20:00', atm: true, image: 'https://images.unsplash.com/photo-1779598366072-93c7e5fb64d0?w=400&h=300&fit=crop' },
];

const MANUFACTURING: CatalogEntry[] = [
  { id: 'plant-austin', name: 'Ironline Austin Assembly Plant', city: 'Austin', state: 'TX', address: '9500 Johnny Morris Rd, Austin, TX 78724', hours: 'Mon–Fri 6:00–18:00', atm: false, image: 'https://images.unsplash.com/photo-1578776349090-de61da00ff1a?w=400&h=300&fit=crop' },
  { id: 'plant-dallas', name: 'Ironline Dallas Fabrication Plant', city: 'Dallas', state: 'TX', address: '4200 S Lamar St, Dallas, TX 75215', hours: 'Mon–Fri 6:00–18:00', atm: false, image: 'https://images.unsplash.com/photo-1547895749-888a559fc2a7?w=400&h=300&fit=crop' },
  { id: 'plant-houston', name: 'Ironline Houston Distribution Facility', city: 'Houston', state: 'TX', address: '8600 Market St, Houston, TX 77029', hours: 'Mon–Sat 5:00–20:00', atm: false, image: 'https://images.unsplash.com/photo-1627052428109-576e839d100a?w=400&h=300&fit=crop' },
  { id: 'plant-denver', name: 'Ironline Denver Components Plant', city: 'Denver', state: 'CO', address: '5000 E 39th Ave, Denver, CO 80207', hours: 'Mon–Fri 6:00–17:00', atm: false, image: 'https://images.unsplash.com/photo-1543304376-1ae7c2be5e59?w=400&h=300&fit=crop' },
];

const INVESTMENT: CatalogEntry[] = [
  { id: 'inv-austin', name: 'Meridian Wealth Austin Branch', city: 'Austin', state: 'TX', address: '300 W 6th St, Austin, TX 78701', hours: 'Mon–Fri 8:30–17:30', atm: false, image: 'https://images.unsplash.com/photo-1501324682324-0d8d7c4b9706?w=400&h=300&fit=crop' },
  { id: 'inv-dallas', name: 'Meridian Wealth Dallas Office', city: 'Dallas', state: 'TX', address: '2100 McKinney Ave, Dallas, TX 75201', hours: 'Mon–Fri 8:30–17:30', atm: false, image: 'https://images.unsplash.com/photo-1623051786552-e46ef84e6c07?w=400&h=300&fit=crop' },
  { id: 'inv-miami', name: 'Meridian Wealth Miami Office', city: 'Miami', state: 'FL', address: '1450 Brickell Ave, Miami, FL 33131', hours: 'Mon–Fri 9:00–18:00', atm: false, image: 'https://images.unsplash.com/photo-1594007336248-95440e3fde6d?w=400&h=300&fit=crop' },
  { id: 'inv-denver', name: 'Meridian Wealth Denver Branch', city: 'Denver', state: 'CO', address: '1670 Broadway, Denver, CO 80202', hours: 'Mon–Fri 8:30–17:00', atm: false, image: 'https://images.unsplash.com/photo-1704423846283-f92ff6badea3?w=400&h=300&fit=crop' },
];

const AIRLINES: CatalogEntry[] = [
  { id: 'airport-austin', name: 'Austin-Bergstrom International Airport — United Terminal', city: 'Austin', state: 'TX', address: '3600 Presidential Blvd, Austin, TX 78719', hours: 'Ticket counter daily 4:00–20:00', atm: true, image: 'https://images.unsplash.com/photo-1542296332-2e4473faf563?w=400&h=300&fit=crop' },
  { id: 'airport-dallas', name: 'Dallas/Fort Worth International Airport — United Terminal E', city: 'Dallas', state: 'TX', address: '2400 Aviation Dr, DFW Airport, TX 75261', hours: 'Ticket counter daily 4:00–22:00', atm: true, image: 'https://images.unsplash.com/photo-1561101904-da649fcbf03f?w=400&h=300&fit=crop' },
  { id: 'airport-houston', name: 'George Bush Intercontinental Airport — United Terminal C', city: 'Houston', state: 'TX', address: '2800 N Terminal Rd, Houston, TX 77032', hours: 'Ticket counter daily 4:00–23:00', atm: true, image: 'https://images.unsplash.com/photo-1549897411-b06572cdf806?w=400&h=300&fit=crop' },
  { id: 'airport-denver', name: 'Denver International Airport — United Concourse B', city: 'Denver', state: 'CO', address: '8500 Peña Blvd, Denver, CO 80249', hours: 'Ticket counter daily 4:00–22:00', atm: true, image: 'https://images.unsplash.com/photo-1530521954074-e64f6810b32d?w=400&h=300&fit=crop' },
  { id: 'airport-miami', name: 'Miami International Airport — United Terminal E', city: 'Miami', state: 'FL', address: '2100 NW 42nd Ave, Miami, FL 33126', hours: 'Ticket counter daily 5:00–21:00', atm: true, image: 'https://images.unsplash.com/photo-1580285198593-af9f402c676a?w=400&h=300&fit=crop' },
];

export const CATALOG_BY_VERTICAL: Record<string, CatalogEntry[]> = {
  banking: BANKING,
  healthcare: HEALTHCARE,
  retail: RETAIL,
  'abercrombie-fitch': ABERCROMBIE_FITCH,
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
  'abercrombie-fitch': 'store',
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
  'abercrombie-fitch': 'Abercrombie & Fitch',
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
export const executeGetBranchHours: HandlerFn = async (deps, _token, params) => {
  const city = typeof params?.city === 'string' ? params.city : undefined;
  const vertical = typeof params?.vertical === 'string' && CATALOG_BY_VERTICAL[params.vertical]
    ? params.vertical
    : 'banking';
  // Loud fallback: an UNKNOWN vertical id means a caller drifted (renamed or
  // new vertical not added here). Silent banking data masqueraded as a correct
  // answer for a month — warn so drift is visible in logs, not just on screen.
  if (typeof params?.vertical === 'string' && !CATALOG_BY_VERTICAL[params.vertical]) {
    deps?.logger?.warn?.(`[publicCatalog] unknown vertical '${params.vertical}' — serving banking fallback`);
  }
  const result = searchBranches(city, vertical);
  const data = {
    branches: result.branches,
    query: result.query,
    message: formatReply(result, vertical),
  };
  return createSuccessResult(JSON.stringify(data, null, 2), data);
};
