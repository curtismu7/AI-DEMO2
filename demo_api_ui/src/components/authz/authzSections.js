const DOC = "https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize";

/**
 * Ordered learning sections for the P1AZ learning page. `demoType` selects the
 * backend path: 'transaction' reuses the existing amount/type engine; the four
 * others hit authorizeLearningDemos via the test-evaluate discriminator.
 * `demoType: null` sections are explainer-only (no runnable form).
 * `fields` drives the demo form in AuthzTestPage (rendered generically).
 */
export const AUTHZ_SECTIONS = [
  {
    id: "overview", number: 1, title: "Overview & Trust Framework",
    concept:
      "PingOne Authorize is a policy decision point (PDP): your app (the PEP) asks it 'may this subject do this action on this resource?' and it answers from centrally-managed policies. Inputs come from the Trust Framework — attributes and services (data resolvers) — so decisions are attribute-based (ABAC), not hard-coded in app code.",
    docHref: `${DOC}/p1az_introduction.html`,
    demoType: null, fields: [],
  },
  {
    id: "policies", number: 2, title: "Policies, Policy Sets & Combining Algorithms",
    concept:
      "Policies live in a hierarchical tree of policy sets. Each policy holds rules; a combining algorithm (e.g. deny-overrides) reduces the rules' effects to one decision. This demo runs the AI Demo transaction policy so you can watch amount thresholds resolve to PERMIT / STEP_UP / DENY.",
    docHref: `${DOC}/p1az_policies.html`,
    demoType: "transaction",
    fields: [
      { name: "amount", label: "Amount (USD)", type: "number", default: 1000 },
      { name: "type", label: "Transaction type", type: "select", options: ["transfer", "withdrawal", "deposit"], default: "transfer" },
      { name: "acr", label: "ACR (e.g. Multi_Factor)", type: "text", default: "" },
    ],
  },
  {
    id: "effects", number: 3, title: "Rules, Conditions & Effects",
    concept:
      "A rule's condition compares attributes and evaluates true/false, producing an effect: PERMIT, DENY, or INDETERMINATE. INDETERMINATE means the policy could not be evaluated (e.g. an attribute would not resolve) — a PEP must treat it as DENY (fail closed). Toggle whether the risk attribute resolves to see it.",
    docHref: `${DOC}/p1az_conditions.html`,
    demoType: "indeterminate",
    fields: [
      { name: "attributeResolves", label: "Risk attribute resolves?", type: "select", options: ["true", "false"], default: "true", coerce: "boolean" },
    ],
  },
  {
    id: "abac", number: 4, title: "Attributes & ABAC",
    concept:
      "The same request yields different decisions based on attributes, not just amount. Here a data-residency rule requires user.region == resource.region, and write actions require a manager role. Change the attributes and watch which rule fires.",
    docHref: `${DOC}/p1az_introduction.html`,
    demoType: "abac",
    fields: [
      { name: "role", label: "User role", type: "select", options: ["manager", "clerk"], default: "manager" },
      { name: "userRegion", label: "User region", type: "select", options: ["EU", "US"], default: "EU" },
      { name: "resourceRegion", label: "Resource region", type: "select", options: ["EU", "US"], default: "EU" },
      { name: "action", label: "Action", type: "select", options: ["read", "write"], default: "read" },
    ],
  },
  {
    id: "obligations", number: 5, title: "Statements: Obligations & Advice",
    concept:
      "A decision can carry statements. An obligation MUST be enforced by the PEP (e.g. STEP_UP: perform MFA before releasing the resource); advice is advisory (e.g. write an audit-log record). A high-value read PERMITs but attaches a step-up obligation unless MFA is already satisfied.",
    docHref: `${DOC}/p1az_policies.html`,
    demoType: "obligations",
    fields: [
      { name: "amount", label: "Amount (USD)", type: "number", default: 25000 },
      { name: "acr", label: "ACR (blank = no MFA)", type: "text", default: "" },
    ],
  },
  {
    id: "payload", number: 6, title: "Statements: Payload Filtering",
    concept:
      "Statements can transform the API payload on a PERMIT — redacting or dropping fields by attribute. A teller sees a masked SSN and no balance; an auditor sees the full record. The decision is PERMIT in both cases; the difference is the returned data.",
    docHref: `${DOC}/p1az_policies.html`,
    demoType: "payloadFilter",
    fields: [
      { name: "role", label: "Caller role", type: "select", options: ["teller", "auditor"], default: "teller" },
    ],
    // Fixed sample payload injected by the runner; not user-edited in v1.
    fixedInput: { payload: { name: "Ada Lovelace", ssn: "123-45-6789", balance: 9000, accountId: "acct-001" } },
  },
  {
    id: "apiaccess", number: 7, title: "API Access Management",
    concept:
      "Beyond raw decision calls, P1AZ can govern which API operations a token may invoke (scope/operation-level authorization). In this demo the environment's scope topology maps a caller to the tools/operations it is permitted — the same least-privilege model the banking agent enforces at runtime.",
    docHref: `${DOC}/p1az_introduction.html`,
    demoType: null, fields: [],
  },
];

/**
 * Build the `input` payload for a runnable section from its current form
 * `values`, applying each field's declared coercion (`coerce: "boolean"`,
 * `type: "number"`) and merging any `section.fixedInput` constants. Kept here,
 * next to the field descriptors it interprets, so the coercion rules and their
 * declarations live in one place rather than split across the component.
 */
export function buildDemoInput(section, values) {
  const input = { ...(section.fixedInput || {}) };
  for (const f of section.fields) {
    const raw = values[f.name];
    input[f.name] = f.coerce === "boolean" ? raw === "true" : f.type === "number" ? Number(raw) : raw;
  }
  return input;
}
