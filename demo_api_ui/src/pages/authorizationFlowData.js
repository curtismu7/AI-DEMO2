// Authorization Flow: the six moments of the "Unmanaged Personal Assistants" reference demo, drawn on PingOne
// (PingOne signs the customer in, runs both token exchanges and the CIBA push) with amounts in US dollars.
// The story follows the active vertical: the business, what the assistant reads, what it pays for and which tool
// it calls all come from the vertical's profile, so an airline never talks about a bank.
// Each moment is an ordered list of messages between lanes; `block` marks a refusal, `ok` a commit.

const LANES_BASE = [
  { id: "ub", label: "User Browser", sub: "customer signs in, consents" },
  { id: "as", label: "Assistant", sub: "the customer's AI assistant" },
  { id: "ap", label: "AI Platform", sub: "hosts the connector" },
  { id: "cs", label: "Consent Service", sub: "records live delegation" },
  { id: "p1", label: "PingOne", sub: "sign-in, token exchange, CIBA" },
  { id: "ee", label: "Exchange Edge", sub: "Exchange 1 at the front door" },
  { id: "gw", label: "PingGateway", sub: "validates and audits" },
  { id: "az", label: "PingOne Authorize", sub: "policy: the $50 cap" },
  { id: "ms", label: "MCP Server", sub: "tool layer, Exchange 2" },
  { id: "bc", label: "System of record", sub: "the money authority" },
  { id: "ud", label: "User Device", sub: "phone: CIBA approval" },
];

const dollars = (n) => `$${n}.00`;
// Builds a payment profile from the vertical's real amount-gated tool and the phrase the live demo uses for it.
const pay = (tool, noun, ask, what, done) => ({
  tool,
  noun,
  ask: (n) => ask.replace("{n}", n),
  what: (n) => what.replace("{n}", dollars(n)),
  done: (n) => done.replace("{n}", dollars(n)),
});

// id, label, org (what the customer connects to), core (the system of record), read (what the assistant looks up), pay.
export const PROFILES = {
  banking: {
    label: "Banking", org: "Super Banking", core: { label: "Bank Core", sub: "the money authority" },
    read: { noun: "balance", ask: "What’s my balance?", tool: "get_account_balance", reply: "Your checking balance is $4,210.55." },
    pay: pay("create_transfer", "payment", "Transfer ${n} to Steven Blake", "{n} to Steven Blake", "Done. {n} sent to Steven Blake."),
  },
  healthcare: {
    label: "Healthcare", org: "CareConnect", core: { label: "Billing System", sub: "the billing authority" },
    read: { noun: "coverage", ask: "Check my coverage", tool: "view_coverage", reply: "Your plan is active. $320 of your $1,500 deductible is met." },
    pay: pay("pay_bill", "bill payment", "Pay my ${n} bill", "{n} to CareConnect Billing", "Done. {n} paid to CareConnect Billing."),
  },
  retail: {
    label: "Retail", org: "Great Buy", core: { label: "Order System", sub: "the order authority" },
    read: { noun: "orders", ask: "List my orders", tool: "list_orders", reply: "You have 3 recent orders. The latest shipped Tuesday." },
    pay: pay("checkout", "checkout", "Checkout headphones for ${n}", "{n} for headphones", "Order placed: headphones, {n}."),
  },
  walbuy: {
    label: "Walbuy", org: "Walbuy", core: { label: "Order System", sub: "the order authority" },
    read: { noun: "orders", ask: "Show my Walbuy orders", tool: "list_walbuy_orders", reply: "You have 2 open Walbuy orders. One arrives Friday." },
    pay: pay("checkout", "checkout", "Checkout Walbuy outerwear for ${n}", "{n} for outerwear", "Order placed: outerwear, {n}."),
  },
  government: {
    label: "Government", org: "CivicPermit", core: { label: "Permit Registry", sub: "the licensing authority" },
    read: { noun: "permits", ask: "Show my permits", tool: "view_permits", reply: "You hold 2 active permits: parking and food vendor." },
    pay: pay("pay_fee", "fee payment", "Pay the ${n} fee", "{n} permit fee", "Done. {n} permit fee paid."),
  },
  university: {
    label: "University", org: "Super University", core: { label: "Student Records", sub: "the registrar" },
    read: { noun: "courses", ask: "Show my enrolled courses", tool: "view_courses", reply: "You are enrolled in 4 courses this term." },
    pay: pay("pay_tuition_balance", "tuition payment", "Pay ${n} tuition", "{n} toward tuition", "Done. {n} applied to tuition."),
  },
  workforce: {
    label: "Workforce", org: "WX Workforce", core: { label: "HR System", sub: "the HR authority" },
    read: { noun: "benefits", ask: "Show my benefits", tool: "view_benefits", reply: "Your medical, dental and 401(k) benefits are active." },
    pay: pay("submit_expense", "expense", "Submit a ${n} expense", "a {n} expense", "Done. {n} expense submitted."),
  },
  "sporting-goods": {
    label: "Sporting goods", org: "Super Sports", core: { label: "Rental System", sub: "the rental authority" },
    read: { noun: "gear", ask: "Show my gear", tool: "list_gear", reply: "You have 2 items out: a road bike and a helmet." },
    pay: pay("extend_rental", "rental extension", "Extend my rental ${n}", "{n} rental extension", "Done. Rental extended, {n} charged."),
  },
  manufacturing: {
    label: "Manufacturing", org: "Precision Works", core: { label: "Production ERP", sub: "the production authority" },
    read: { noun: "work orders", ask: "Show my work orders", tool: "view_work_orders", reply: "3 work orders are open. WO-1042 is due Thursday." },
    pay: pay("approve_purchase_order", "purchase order", "Approve a ${n} purchase order", "a {n} purchase order", "Done. {n} purchase order approved."),
  },
  investment: {
    label: "Investment", org: "Meridian Wealth", core: { label: "Brokerage Core", sub: "the trading authority" },
    read: { noun: "portfolios", ask: "Show my portfolios", tool: "view_portfolios", reply: "You hold 2 portfolios worth $48,210 in total." },
    pay: pay("large_trade", "trade", "Execute a large trade of ${n}", "a {n} trade", "Done. {n} trade executed."),
  },
  airlines: {
    label: "Airlines", org: "the airline", core: { label: "Reservation System", sub: "the ticketing authority" },
    read: { noun: "reservations", ask: "Show my reservations", tool: "get_airline_bookings", reply: "You have 1 upcoming flight: UA328 to Denver on Friday." },
    pay: pay("pay_airline_fee", "change fee", "Pay a ${n} change fee", "a {n} change fee", "Done. {n} change fee paid."),
  },
};

export const VERTICAL_OPTIONS = Object.entries(PROFILES).map(([id, p]) => ({ id, label: p.label }));
export const DEFAULT_VERTICAL = "banking";
export const profileFor = (id) => PROFILES[id] || PROFILES[DEFAULT_VERTICAL];

export function lanesFor(id) {
  const { core } = profileFor(id);
  return LANES_BASE.map((l) => (l.id === "bc" ? { ...l, label: core.label, sub: core.sub } : l));
}

const m = (from, to, label, extra = {}) => ({ from, to, label, ...extra });
const say = (role, text) => ({ role, text });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function momentsFor(id) {
  const p = profileFor(id);
  const { org, read, pay: payP } = p;
  const orgCap = cap(org);
  const sys = "the system of record";
  const paySteps = (n, tail) => [
    m("ub", "as", `Prepare ${payP.what(n)}`, { chat: say("user", payP.ask(n)) }),
    m("as", "ee", `tools/call ${payP.tool}`),
    m("ee", "p1", "Exchange 1: delegation live?"),
    m("p1", "ee", "Delegated token: sub, act"),
    m("ee", "gw", "Fresh delegated token only"),
    ...tail,
  ];

  return [
    {
      id: "no-connection", num: "01", chip: "No connection",
      prompt: `“${read.ask}” at ${org}`,
      proves: "No connection → no data. Permission must come first.",
      outcome: { kind: "block", text: `Refused at the edge: the assistant holds no connector token, so nothing reaches ${org}.` },
      steps: [
        m("ub", "as", read.ask, { chat: say("user", read.ask) }),
        m("as", "ap", `Call ${read.tool}`),
        m("ap", "ee", "tools/call, no token"),
        m("ee", "as", "401: connect first", { block: true, chat: say("assistant", `I can’t see your ${read.noun} yet. Connect me to ${org} first.`) }),
      ],
    },
    {
      id: "connect", num: "02", chip: "Connect",
      prompt: `Connect to ${org}`,
      proves: "Customer signs in; the consent service records live delegation.",
      outcome: { kind: "ok", text: "The assistant holds a connect token that cannot call the business. Its only job is to be exchanged." },
      steps: [
        m("ub", "as", `Connect to ${org}`, { chat: say("user", `Connect to ${org}`) }),
        m("as", "ap", "Start connector sign-in"),
        m("ap", "p1", "Authorize request (PKCE)"),
        m("p1", "ub", "Customer signs in"),
        m("ub", "cs", `Consent: read ${read.noun}, act up to $50`),
        m("cs", "p1", "Record live delegation"),
        m("p1", "ap", "Connect token", { ok: true, chat: say("assistant", `Connected to ${org}. I can read your ${read.noun}, and act for you up to $50 with your approval.`) }),
      ],
    },
    {
      id: "read", num: "03", chip: `Read ${read.noun}`,
      prompt: `“${read.ask}”`,
      proves: "Two exchanges; actor, audience and scope enforced on the read.",
      outcome: { kind: "ok", text: "Read served with an audience-bound token: read scope only, five-minute life, no onward delegation." },
      steps: [
        m("ub", "as", read.ask, { chat: say("user", read.ask) }),
        m("as", "ap", `Call ${read.tool}`),
        m("ap", "ee", "Connect token"),
        m("ee", "p1", "Exchange 1: delegation live?"),
        m("p1", "ee", "Delegated token: sub, act"),
        m("ee", "gw", "Fresh delegated token only"),
        m("gw", "az", "Decide: read allowed?"),
        m("az", "gw", "PERMIT"),
        m("gw", "ms", `tools/call ${read.tool}`),
        m("ms", "p1", "Exchange 2: audience token"),
        m("p1", "ms", "Read scope, 5 min"),
        m("ms", "bc", "Read, own audience"),
        m("bc", "as", cap(read.noun), { ok: true, chat: say("assistant", read.reply) }),
      ],
    },
    {
      id: "pay-25", num: "04", chip: `Pay $25`,
      prompt: `“${payP.ask(25)}” · confirm`,
      proves: `${orgCap} proposal → phone approval → signed binding → ${sys}.`,
      outcome: { kind: "ok", text: `Committed. ${cap(sys)} changed because the human approved on their own device and the binding matched.` },
      steps: [
        ...paySteps(25, [
          m("gw", "az", "Decide: $25 within $50 cap"),
          m("az", "gw", "PERMIT"),
          m("gw", "ms", "PREPARE"),
          m("ms", "as", "Proposal: $25, terms digest", { chat: say("assistant", `Proposal from ${org}: ${payP.what(25)}. Reply “confirm” to approve it on your phone.`) }),
          m("ub", "as", "confirm", { chat: say("user", "confirm") }),
          m("as", "ms", "CONFIRM, same terms"),
          m("ms", "p1", "CIBA: ask the customer"),
          m("p1", "ud", `Approve ${payP.what(25)}?`),
          m("ud", "p1", "Approved (biometric)"),
          m("ms", "bc", "Exchange 2 + signed binding"),
          m("bc", "as", "Committed $25.00", { ok: true, chat: say("assistant", payP.done(25)) }),
        ]),
      ],
    },
    {
      id: "pay-60", num: "05", chip: "Pay $60 (refused)",
      prompt: `“${payP.ask(60)}” · confirm`,
      proves: "The $50 policy stops confirmation before the CIBA phone push.",
      outcome: { kind: "block", text: "Denied by Authorize before the phone rang. The cap is policy, not code, and no device push was sent." },
      steps: paySteps(60, [
        m("gw", "az", "Decide: $60 over $50 cap"),
        m("az", "gw", "DENY", { block: true }),
        m("gw", "as", "Refused at the gateway", { block: true, chat: say("assistant", `${orgCap} won’t allow a $60 ${payP.noun} from an assistant. The limit is $50. Nothing was sent to your phone.`) }),
      ]),
    },
    {
      id: "revoke", num: "06", chip: "Revoke · read",
      prompt: `Revoke permission · “${read.ask}”`,
      proves: "Existing connector session, but the next delegated call is refused.",
      outcome: { kind: "block", text: "Refused at Exchange 1: the session outlived the consent, but the authority did not." },
      steps: [
        m("ub", "cs", "Revoke permission", { chat: say("user", "Revoke permission") }),
        m("cs", "p1", "Delegation removed"),
        m("ub", "as", read.ask, { chat: say("user", read.ask) }),
        m("as", "ap", `Call ${read.tool}`),
        m("ap", "ee", "Connect token (still valid)"),
        m("ee", "p1", "Exchange 1: delegation live?"),
        m("p1", "ee", "No live delegation", { block: true }),
        m("ee", "as", "Refused, nothing forwarded", { block: true, chat: say("assistant", `Your permission was revoked, so I can’t read your ${read.noun}.`) }),
      ],
    },
  ];
}

export const SLOTS = Math.max(...VERTICAL_OPTIONS.flatMap((v) => momentsFor(v.id).map((x) => x.steps.length)));
