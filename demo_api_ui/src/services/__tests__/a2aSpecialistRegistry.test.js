import {
  fetchA2aSpecialistRegistry,
  normalizeA2aSpecialists,
  specialistOptionLabel,
  specialistRoleLabel,
} from '../a2aSpecialistRegistry';

describe('a2aSpecialistRegistry', () => {
  const payload = {
    specialists: [
      {
        vertical: 'abercrombie-fitch',
        canonicalVertical: 'retail',
        appKey: 'purchase',
        appName: 'Super Banking Purchase Specialist Agent',
        specialistName: 'Purchase History Specialist',
        tools: ['sensitive_order_history'],
        subtaskHint: 'review the sensitive order / purchase history',
        clientSecret: 'must never reach the UI',
      },
    ],
  };

  it('normalizes server metadata and keeps aliases intact', () => {
    expect(normalizeA2aSpecialists(payload)).toEqual([{
      vertical: 'abercrombie-fitch',
      canonicalVertical: 'retail',
      appKey: 'purchase',
      appName: 'Super Banking Purchase Specialist Agent',
      specialistName: 'Purchase History Specialist',
      tools: ['sensitive_order_history'],
      subtaskHint: 'review the sensitive order / purchase history',
    }]);
  });

  it('uses the canonical role language for display', () => {
    const specialist = normalizeA2aSpecialists(payload)[0];
    expect(specialistRoleLabel(specialist)).toBe('Purchase History Specialist · Specialist agent');
    expect(specialistOptionLabel(specialist)).toBe(
      'Super Banking Purchase Specialist Agent · Specialist agent',
    );
  });

  it('fetches the public registry as JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });

    await expect(fetchA2aSpecialistRegistry(fetchImpl)).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith('/a2a/specialists/registry', {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  });
});
