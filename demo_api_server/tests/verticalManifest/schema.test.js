const { ManifestSchema, MockDataSchema } = require('../../services/verticalManifest/schema');

const MIN_VALID = {
  id: 'demo',
  schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--theme-accent': '#000' } },
  agent: { persona: 'Demo Assistant' },
};

describe('ManifestSchema', () => {
  test('minimum valid manifest passes', () => {
    expect(() => ManifestSchema.parse(MIN_VALID)).not.toThrow();
  });

  test('missing identity.displayName rejected with path', () => {
    const bad = { ...MIN_VALID, identity: {} };
    const res = ManifestSchema.safeParse(bad);
    expect(res.success).toBe(false);
    expect(res.error.issues[0].path).toEqual(['identity', 'displayName']);
  });

  test('schemaVersion: 2 rejected', () => {
    const bad = { ...MIN_VALID, schemaVersion: 2 };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('empty cssVars rejected', () => {
    const bad = { ...MIN_VALID, theme: { cssVars: {} } };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('id regex enforced (lowercase, hyphens, digits)', () => {
    expect(ManifestSchema.safeParse({ ...MIN_VALID, id: 'Bad_ID' }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...MIN_VALID, id: 'good-id-1' }).success).toBe(true);
  });

  test('chip schema requires id, label, message', () => {
    const withChips = {
      ...MIN_VALID,
      dashboard: {
        kind: 'banking',
        chips: [{ key: 'a', label: 'A' }],
        hero: { cards: [] },
        llmChipGroups: { Group1: [{ id: 'c1', label: 'C1', message: 'go' }] },
      },
    };
    expect(ManifestSchema.safeParse(withChips).success).toBe(true);

    const badGroup = JSON.parse(JSON.stringify(withChips));
    badGroup.dashboard.llmChipGroups.Group1[0] = { id: 'c1', label: 'C1' }; // missing message
    expect(ManifestSchema.safeParse(badGroup).success).toBe(false);
  });

  test('format enum: money accepted, currency rejected', () => {
    const withFP = {
      ...MIN_VALID,
      featurePage: {
        mcpTool: 't', pageTitle: 'P', dataKey: 'd',
        fields: [{ label: 'L', path: 'p', format: 'currency' }],
      },
    };
    expect(ManifestSchema.safeParse(withFP).success).toBe(false);
    withFP.featurePage.fields[0].format = 'money';
    expect(ManifestSchema.safeParse(withFP).success).toBe(true);
  });

  test('scopes defaults applied after parse', () => {
    const parsed = ManifestSchema.parse({ ...MIN_VALID, scopes: {} });
    expect(parsed.scopes.read).toBe('read');
    expect(parsed.scopes.write).toBe('write');
    expect(parsed.scopes.transfer).toBe('transfer');
  });
});

describe('delegation block', () => {
  const withDelegation = {
    ...MIN_VALID,
    delegation: {
      pageTitle: 'Family Delegation',
      pageDescription: 'Grant access',
      granteeLabel: 'family member',
      scopeLabels: {
        view_accounts:     { label: 'View Accounts',    description: 'See accounts' },
        view_balances:     { label: 'View Balances',    description: 'See balances' },
        create_deposit:    { label: 'Make Deposits',    description: 'Deposit funds' },
        create_withdrawal: { label: 'Make Withdrawals', description: 'Withdraw funds' },
        create_transfer:   { label: 'Transfer Funds',   description: 'Transfer funds' },
      },
    },
  };

  test('valid delegation block accepted', () => {
    expect(() => ManifestSchema.parse(withDelegation)).not.toThrow();
  });

  test('delegation block is optional — manifest without it still passes', () => {
    expect(() => ManifestSchema.parse(MIN_VALID)).not.toThrow();
  });

  test('missing pageTitle rejected', () => {
    const bad = JSON.parse(JSON.stringify(withDelegation));
    delete bad.delegation.pageTitle;
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('missing scopeLabels.view_accounts rejected', () => {
    const bad = JSON.parse(JSON.stringify(withDelegation));
    delete bad.delegation.scopeLabels.view_accounts;
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('scope label missing description rejected', () => {
    const bad = JSON.parse(JSON.stringify(withDelegation));
    delete bad.delegation.scopeLabels.view_accounts.description;
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('MockDataSchema', () => {
  test('any object passes', () => {
    expect(MockDataSchema.safeParse({}).success).toBe(true);
    expect(MockDataSchema.safeParse({ a: 1, b: [1, 2], c: { nested: true } }).success).toBe(true);
  });

  test('non-object rejected', () => {
    expect(MockDataSchema.safeParse([]).success).toBe(false);
    expect(MockDataSchema.safeParse('x').success).toBe(false);
  });
});

describe('ChipSchema challenge', () => {
  const { ChipSchema } = require('../../services/verticalManifest/schema');
  test('accepts a valid challenge value', () => {
    expect(ChipSchema.parse({ id: 'x', label: 'X', message: 'x', challenge: 'both' }).challenge).toBe('both');
  });
  test('rejects an invalid challenge value', () => {
    expect(() => ChipSchema.parse({ id: 'x', label: 'X', message: 'x', challenge: 'nope' })).toThrow();
  });
});
