const { z } = require('zod');

const ChipSchema = z.object({
  id: z.string(),
  label: z.string(),
  message: z.string(),
  group: z.string().optional(),
  scope: z.string().optional(),
  mode: z.enum(['both', 'llm', 'direct']).optional().default('both'),
  hitlTrigger: z.boolean().optional(),
  // Chip challenge marker (REGRESSION_PLAN §0 markers): consent → 👤,
  // both → 👤🔑 (consent + step-up/MFA), step_up → 🔑 (MFA-spotlight chips).
  challenge: z.enum(['consent', 'both', 'step_up']).optional(),
  elicitationTrigger: z.boolean().optional(),
  // MCP tool this chip invokes. The UI joins it with the live Authorize-filtered
  // tool list: tool absent from the list → chip hidden (vertical-foreign); present
  // but denied → chip greyed (scope). Omit for freeform/LLM chips (no backing tool).
  tool: z.string().optional(),
  // Security Showcase fields (dashboard.securityShowcase chips). `showcase` is the
  // dispatch action key (e.g. "mfa_otp", "atk_confused_deputy"); `caption` is the
  // presenter outcome line; `stepUpMethod`/`denyTool` parameterize specific demos.
  showcase: z.string().optional(),
  caption: z.string().optional(),
  stepUpMethod: z.string().optional(),
  denyTool: z.string().optional(),
  queryPrompt: z.enum(['userFilter', 'appFilter']).optional(),
  // Proof-of-enforcement catalog identity (Task 1: config/verticals/*/manifest.json
  // chips10 entries). Threaded through onChipClick → callMcpTool/sendAgentMessage
  // request bodies (Task 2) so the BFF can stamp the run against a known use case.
  useCaseId: z.string().optional(),
});

const FormatEnum = z.enum(['money', 'count', 'date', 'text', 'percent']);

const ScopeLabelSchema = z.object({
  label: z.string(),
  description: z.string(),
});

const DelegationSchema = z.object({
  pageTitle: z.string(),
  pageDescription: z.string(),
  granteeLabel: z.string(),
  scopeLabels: z.object({
    view_accounts:     ScopeLabelSchema,
    view_balances:     ScopeLabelSchema,
    create_deposit:    ScopeLabelSchema,
    create_withdrawal: ScopeLabelSchema,
    create_transfer:   ScopeLabelSchema,
  }),
}).optional();

const RenderFieldSchema = z.object({
  label: z.string(),
  path: z.string(),
  format: FormatEnum.optional(),
  accent: z.boolean().optional(),
});

const RenderDescriptorSchema = z.object({
  type: z.enum(['card', 'fieldList', 'table', 'text', 'token', 'token-pair', 'productGrid', 'seatMap']),
  title: z.string().optional(),
  fields: z.array(RenderFieldSchema).optional(),
  columns: z.array(z.object({
    label: z.string(),
    path: z.string(),
    format: FormatEnum.optional(),
  })).optional(),
});

const TiersSchema = z.object({
  default: z.string(),
  definitions: z.record(z.string(), z.object({
    maxAmountUsd: z.number(),
    restrictedTools: z.array(z.string()),
  })),
  groupToTier: z.record(z.string(), z.string()).optional(),
}).optional();

// PingOne group categories — same keys across verticals, vertical-specific names.
const GroupCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const GroupsSchema = z.object({
  categories: z.record(z.string(), GroupCategorySchema),
  restrictedTools: z.record(z.string(), z.string()).optional(),
  userMemberships: z.record(z.string(), z.array(z.string())).optional(),
}).optional();

/**
 * A DECLARED, permanent exemption from the A2A parity gate
 * (tests/a2aVerticalParity.test.js).
 *
 * Absence is never an exemption — the gate reads this block, so a vertical in the
 * switcher that neither ships an A2A specialist nor declares this FAILS. That is
 * deliberate: an exception that is merely missing from a list is invisible, which
 * is the same defect as a chip nobody noticed was absent.
 *
 * Shaped so it cannot be earned by accident. `exempt` must be the literal `true`
 * (not any truthy value), and `reason` must be long enough that it has to say
 * something — a new vertical cannot inherit the exemption, it must argue for one.
 */
const A2aExemptionSchema = z.object({
  exempt: z.literal(true),
  reason: z.string().min(120),
  declaredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).optional();

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  schemaVersion: z.literal(3),

  identity: z.object({
    displayName: z.string().min(1),
    headerTitle: z.string().optional(),
    documentTitle: z.string().optional(),
    logoAlt: z.string().optional(),
    tagline: z.string().optional(),
    logoPath: z.string().optional(),
    // Optional react-icons/md name (e.g. "MdLocalHospital") for the header brand
    // icon. Falls back to the default bank icon in the UI when absent/unknown.
    icon: z.string().optional(),
  }),

  theme: z.object({
    cssVars: z.record(z.string(), z.string())
      .refine((v) => Object.keys(v).length > 0, { message: 'at least one cssVar required' }),
  }),

  terminology: z.object({
    account: z.string().optional(),
    accounts: z.string().optional(),
    accountTypes: z.array(z.string()).optional(),
    transaction: z.string().optional(),
    transactions: z.string().optional(),
    transactionTypes: z.array(z.string()).optional(),
    balance: z.string().optional(),
    agent: z.string().optional(),
    dashboard: z.string().optional(),
    highValueAction: z.string().optional(),
    highValueLabel: z.string().optional(),
  }).optional(),

  agent: z.object({
    persona: z.string().min(1),
    greeting: z.string().optional(),
    systemPromptFlavor: z.string().optional(),
  }),

  dashboard: z.object({
    kind: z.string(),
    chips: z.array(z.object({ key: z.string(), label: z.string() })),
    hero: z.object({
      cards: z.array(z.object({
        label: z.string(),
        dataKey: z.string(),
        format: FormatEnum,
      })),
    }).optional(),
    llmChipGroups: z.record(z.string(), z.array(ChipSchema)).optional(),
    chips10: z.array(ChipSchema).optional(),
    userChips: z.array(ChipSchema).optional(),
    // Security Showcase — tabbed panel (Defenses / AI / Attacks / PingOne Admin).
    securityShowcase: z.object({
      tabs: z.array(z.object({
        id: z.string(),
        label: z.string(),
        adminOnly: z.boolean().optional(),
        badge: z.string().optional(),
        chips: z.array(ChipSchema),
      })),
    }).optional(),
  }).optional(),

  tiers: TiersSchema,

  groups: GroupsSchema,

  a2aExemption: A2aExemptionSchema,

  scopes: z.object({
    read: z.string().default('read'),
    write: z.string().default('write'),
    transfer: z.string().default('transfer'),
    featureScope: z.string().optional(),
  }).optional().default({}),

  delegation: DelegationSchema,

  featurePage: z.object({
    mcpTool: z.string(),
    pageTitle: z.string(),
    badgeLabel: z.string().optional(),
    accentColor: z.string().optional(),
    dataKey: z.string(),
    fields: z.array(z.object({
      label: z.string(),
      path: z.string(),
      format: FormatEnum.optional(),
      accent: z.boolean().optional(),
    })),
    sectionTitle: z.string().optional(),
    emptyPrompt: z.string().optional(),
    scopeError: z.string().optional(),
  }).optional(),

  render: z.record(z.string(), RenderDescriptorSchema).optional(),

  demoUsers: z.object({
    customer: z.object({ hint: z.string(), passwordHint: z.string() }).optional(),
    admin: z.object({ hint: z.string(), passwordHint: z.string() }).optional(),
  }).optional(),
});

const MockDataSchema = z.record(z.string(), z.unknown());

module.exports = { ManifestSchema, MockDataSchema, ChipSchema, FormatEnum };
