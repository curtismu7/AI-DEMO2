import { getToolAnnotations } from '../src/utils/toolAnnotations';

describe('getToolAnnotations', () => {
  it('marks a read-only tool correctly', () => {
    const ann = getToolAnnotations('get_my_accounts');
    expect(ann.readOnly).toBe(true);
    expect(ann.destructive).toBe(false);
    expect(ann.idempotent).toBe(true);
  });

  it('marks a write tool as destructive', () => {
    const ann = getToolAnnotations('create_withdrawal');
    expect(ann.readOnly).toBe(false);
    expect(ann.destructive).toBe(true);
    expect(ann.idempotent).toBe(false);
  });

  it('returns false/false for unknown tools', () => {
    const ann = getToolAnnotations('nonexistent_tool');
    expect(ann.readOnly).toBe(false);
    expect(ann.destructive).toBe(false);
    expect(ann.idempotent).toBe(false);
  });
});
