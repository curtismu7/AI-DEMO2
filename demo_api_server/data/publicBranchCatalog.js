// demo_api_server/data/publicBranchCatalog.js
/**
 * Static public location catalog — no PII, no auth required.
 * Used by Act 1 of the progressive trust demo (UC24).
 *
 * Vertical-aware since UC24 was promoted onto the presenter stepper: the same
 * step now runs in every vertical, and a bank branch on Congress Ave is the
 * wrong answer to "What clinics are near me?" or "What airports are near me?".
 * Every list reuses the same five cities (Austin, Dallas, Houston, Miami,
 * Denver) so UC24's hint stays true everywhere.
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

const HEALTHCARE = Object.freeze([
  { id: 'clinic-austin', name: 'Wellspring Health Austin Clinic', city: 'Austin', state: 'TX', address: '1201 W 38th St, Austin, TX 78705', hours: 'Mon–Fri 8:00–18:00, Sat 9:00–13:00', atm: false },
  { id: 'clinic-dallas', name: 'Wellspring Health Dallas Medical Center', city: 'Dallas', state: 'TX', address: '3500 Gaston Ave, Dallas, TX 75246', hours: 'Mon–Fri 7:00–19:00', atm: false },
  { id: 'clinic-houston', name: 'Wellspring Health Houston Clinic', city: 'Houston', state: 'TX', address: '6560 Fannin St, Houston, TX 77030', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'clinic-denver', name: 'Wellspring Health Denver Clinic', city: 'Denver', state: 'CO', address: '1400 Jackson St, Denver, CO 80206', hours: 'Mon–Fri 8:00–17:00', atm: false },
]);

const RETAIL = Object.freeze([
  { id: 'store-austin', name: 'Super Retail Austin Store', city: 'Austin', state: 'TX', address: '2901 S Capital of Texas Hwy, Austin, TX 78746', hours: 'Daily 10:00–21:00', atm: true },
  { id: 'store-dallas', name: 'Super Retail Dallas Store', city: 'Dallas', state: 'TX', address: '13350 Dallas Pkwy, Dallas, TX 75240', hours: 'Daily 10:00–21:00', atm: true },
  { id: 'store-miami', name: 'Super Retail Miami Store', city: 'Miami', state: 'FL', address: '701 S Miami Ave, Miami, FL 33130', hours: 'Daily 10:00–22:00', atm: true },
  { id: 'store-denver', name: 'Super Retail Denver Store', city: 'Denver', state: 'CO', address: '3000 E 1st Ave, Denver, CO 80206', hours: 'Daily 10:00–20:00', atm: true },
]);

const ABERCROMBIE_FITCH = Object.freeze([
  { id: 'anf-austin', name: 'Abercrombie & Fitch at Domain NORTHSIDE', city: 'Austin', state: 'TX', address: '11700 Domain Blvd, Austin, TX 78758', hours: 'Daily 10:00–21:00', atm: false },
  { id: 'anf-dallas', name: 'Abercrombie & Fitch at NorthPark Center', city: 'Dallas', state: 'TX', address: '8687 N Central Expy, Dallas, TX 75225', hours: 'Daily 10:00–20:00', atm: false },
  { id: 'anf-miami', name: 'Abercrombie & Fitch at Aventura Mall', city: 'Miami', state: 'FL', address: '19501 Biscayne Blvd, Aventura, FL 33180', hours: 'Daily 10:00–21:00', atm: false },
  { id: 'anf-denver', name: 'Abercrombie & Fitch at Cherry Creek', city: 'Denver', state: 'CO', address: '3000 E 1st Ave, Denver, CO 80206', hours: 'Daily 10:00–20:00', atm: false },
]);

const GOVERNMENT = Object.freeze([
  { id: 'gov-austin', name: 'Austin City Permits Office', city: 'Austin', state: 'TX', address: '6310 Wilhelmina Delco Dr, Austin, TX 78752', hours: 'Mon–Fri 8:00–16:00', atm: false },
  { id: 'gov-dallas', name: 'Dallas County Records Office', city: 'Dallas', state: 'TX', address: '509 Main St, Dallas, TX 75202', hours: 'Mon–Fri 8:00–16:30', atm: false },
  { id: 'gov-houston', name: 'Houston City Services Office', city: 'Houston', state: 'TX', address: '900 Bagby St, Houston, TX 77002', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'gov-denver', name: 'Denver County Clerk Office', city: 'Denver', state: 'CO', address: '201 W Colfax Ave, Denver, CO 80202', hours: 'Mon–Fri 8:00–16:30', atm: false },
]);

const UNIVERSITY = Object.freeze([
  { id: 'campus-austin', name: 'Riverbend University Austin Campus', city: 'Austin', state: 'TX', address: '2100 Speedway, Austin, TX 78712', hours: 'Mon–Fri 7:00–22:00, Sat 9:00–17:00', atm: true },
  { id: 'campus-dallas', name: 'Riverbend University Dallas Hall', city: 'Dallas', state: 'TX', address: '6425 Boaz Ln, Dallas, TX 75205', hours: 'Mon–Fri 8:00–20:00', atm: true },
  { id: 'campus-houston', name: 'Riverbend University Houston Library', city: 'Houston', state: 'TX', address: '4333 University Dr, Houston, TX 77204', hours: 'Daily 8:00–24:00', atm: false },
  { id: 'campus-denver', name: 'Riverbend University Denver Campus', city: 'Denver', state: 'CO', address: '2199 S University Blvd, Denver, CO 80208', hours: 'Mon–Fri 7:30–21:00', atm: true },
]);

const WORKFORCE = Object.freeze([
  { id: 'wf-austin', name: 'Northwind People Operations Office — Austin', city: 'Austin', state: 'TX', address: '500 W 2nd St, Austin, TX 78701', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'wf-dallas', name: 'Northwind People Operations Office — Dallas', city: 'Dallas', state: 'TX', address: '2200 Ross Ave, Dallas, TX 75201', hours: 'Mon–Fri 8:00–17:00', atm: false },
  { id: 'wf-miami', name: 'Northwind People Operations Office — Miami', city: 'Miami', state: 'FL', address: '78 SW 7th St, Miami, FL 33130', hours: 'Mon–Fri 9:00–18:00', atm: false },
  { id: 'wf-denver', name: 'Northwind People Operations Office — Denver', city: 'Denver', state: 'CO', address: '1144 15th St, Denver, CO 80202', hours: 'Mon–Fri 8:00–17:00', atm: false },
]);

const SPORTING_GOODS = Object.freeze([
  { id: 'sg-austin', name: 'Super Sports Austin Outfitter', city: 'Austin', state: 'TX', address: '9607 Research Blvd, Austin, TX 78759', hours: 'Mon–Sat 9:00–21:00, Sun 10:00–19:00', atm: true },
  { id: 'sg-dallas', name: 'Super Sports Dallas Store', city: 'Dallas', state: 'TX', address: '7700 W Northwest Hwy, Dallas, TX 75225', hours: 'Mon–Sat 9:00–21:00', atm: true },
  { id: 'sg-houston', name: 'Super Sports Houston Store', city: 'Houston', state: 'TX', address: '5000 Westheimer Rd, Houston, TX 77056', hours: 'Daily 10:00–20:00', atm: true },
  { id: 'sg-denver', name: 'Super Sports Denver Outfitter', city: 'Denver', state: 'CO', address: '1000 Broadway, Denver, CO 80203', hours: 'Mon–Sat 9:00–20:00', atm: true },
]);

const MANUFACTURING = Object.freeze([
  { id: 'plant-austin', name: 'Ironline Austin Assembly Plant', city: 'Austin', state: 'TX', address: '9500 Johnny Morris Rd, Austin, TX 78724', hours: 'Mon–Fri 6:00–18:00', atm: false },
  { id: 'plant-dallas', name: 'Ironline Dallas Fabrication Plant', city: 'Dallas', state: 'TX', address: '4200 S Lamar St, Dallas, TX 75215', hours: 'Mon–Fri 6:00–18:00', atm: false },
  { id: 'plant-houston', name: 'Ironline Houston Distribution Facility', city: 'Houston', state: 'TX', address: '8600 Market St, Houston, TX 77029', hours: 'Mon–Sat 5:00–20:00', atm: false },
  { id: 'plant-denver', name: 'Ironline Denver Components Plant', city: 'Denver', state: 'CO', address: '5000 E 39th Ave, Denver, CO 80207', hours: 'Mon–Fri 6:00–17:00', atm: false },
]);

const INVESTMENT = Object.freeze([
  { id: 'inv-austin', name: 'Meridian Wealth Austin Branch', city: 'Austin', state: 'TX', address: '300 W 6th St, Austin, TX 78701', hours: 'Mon–Fri 8:30–17:30', atm: false },
  { id: 'inv-dallas', name: 'Meridian Wealth Dallas Office', city: 'Dallas', state: 'TX', address: '2100 McKinney Ave, Dallas, TX 75201', hours: 'Mon–Fri 8:30–17:30', atm: false },
  { id: 'inv-miami', name: 'Meridian Wealth Miami Office', city: 'Miami', state: 'FL', address: '1450 Brickell Ave, Miami, FL 33131', hours: 'Mon–Fri 9:00–18:00', atm: false },
  { id: 'inv-denver', name: 'Meridian Wealth Denver Branch', city: 'Denver', state: 'CO', address: '1670 Broadway, Denver, CO 80202', hours: 'Mon–Fri 8:30–17:00', atm: false },
]);

const AIRLINES = Object.freeze([
  { id: 'airport-austin', name: 'Austin-Bergstrom International Airport — United Terminal', city: 'Austin', state: 'TX', address: '3600 Presidential Blvd, Austin, TX 78719', hours: 'Ticket counter daily 4:00–20:00', atm: true },
  { id: 'airport-dallas', name: 'Dallas/Fort Worth International Airport — United Terminal E', city: 'Dallas', state: 'TX', address: '2400 Aviation Dr, DFW Airport, TX 75261', hours: 'Ticket counter daily 4:00–22:00', atm: true },
  { id: 'airport-houston', name: 'George Bush Intercontinental Airport — United Terminal C', city: 'Houston', state: 'TX', address: '2800 N Terminal Rd, Houston, TX 77032', hours: 'Ticket counter daily 4:00–23:00', atm: true },
  { id: 'airport-denver', name: 'Denver International Airport — United Concourse B', city: 'Denver', state: 'CO', address: '8500 Peña Blvd, Denver, CO 80249', hours: 'Ticket counter daily 4:00–22:00', atm: true },
  { id: 'airport-miami', name: 'Miami International Airport — United Terminal E', city: 'Miami', state: 'FL', address: '2100 NW 42nd Ave, Miami, FL 33126', hours: 'Ticket counter daily 5:00–21:00', atm: true },
]);

const CATALOG_BY_VERTICAL = Object.freeze({
  banking: BRANCHES,
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
});

/** Noun each vertical calls its locations, for headings and no-match replies. */
const LABEL_BY_VERTICAL = Object.freeze({
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
});

/** Brand each vertical's headings carry — never "Super Banking" outside banking. */
const BRAND_BY_VERTICAL = Object.freeze({
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
});

/**
 * Search locations by optional city substring (case-insensitive), scoped to a
 * vertical.
 * @param {{ city?: string, vertical?: string }} [params]
 * @returns {{ branches: typeof BRANCHES[number][], query: string|null, vertical: string }}
 */
function searchPublicBranches(params = {}) {
  const vertical = typeof params.vertical === 'string' ? params.vertical : 'banking';
  // Unknown verticals fall back to banking rather than returning an empty list:
  // an empty Act 1 reads as a broken demo, and the point of UC24 is that the
  // anonymous call succeeded. But fall back LOUDLY — silent banking data
  // masquerades as a correct answer (2026-08-04: a month of banking branches
  // in every vertical passed every status-level check).
  if (vertical !== 'banking' && !CATALOG_BY_VERTICAL[vertical]) {
    console.warn(`[publicBranchCatalog] unknown vertical '${vertical}' — serving banking fallback`);
  }
  const list = CATALOG_BY_VERTICAL[vertical] || CATALOG_BY_VERTICAL.banking;
  const raw = typeof params.city === 'string' ? params.city.trim() : '';
  if (!raw) return { branches: [...list], query: null, vertical };
  const needle = raw.toLowerCase();
  const branches = list.filter(
    (b) => b.city.toLowerCase().includes(needle) || b.name.toLowerCase().includes(needle),
  );
  return { branches, query: raw, vertical };
}

/**
 * Format the location list for agent chat replies. The vertical rides on the
 * result object, so no caller's signature changes.
 * @param {ReturnType<typeof searchPublicBranches>} result
 * @param {{ short?: boolean }} [options] - short: heading only, no per-branch
 *   detail — for callers (e.g. branch_hours) that also render `result.branches`
 *   as cards, so the full address/hours/ATM list isn't shown twice.
 */
function formatBranchCatalogReply(result, { short = false } = {}) {
  const { branches, query, vertical } = result;
  const key = LABEL_BY_VERTICAL[vertical] ? vertical : 'banking';
  const label = LABEL_BY_VERTICAL[key];
  const brand = BRAND_BY_VERTICAL[key];
  if (!branches.length) {
    return query
      ? `No ${brand} ${label}s matched "${query}". Try Austin, Dallas, or Houston.`
      : `No ${label} locations are available right now.`;
  }
  const heading = query
    ? `${brand} ${label}s near **${query}**`
    : `${brand} ${label} locations`;
  if (short) {
    return `${heading} — found ${branches.length}:`;
  }
  const lines = branches.map((b) => {
    const atm = b.atm ? ' · ATM available' : '';
    return `• **${b.name}** (${b.city}, ${b.state})\n  ${b.address}\n  Hours: ${b.hours}${atm}`;
  });
  return `${heading}:\n\n${lines.join('\n\n')}`;
}

module.exports = { BRANCHES, CATALOG_BY_VERTICAL, searchPublicBranches, formatBranchCatalogReply };
