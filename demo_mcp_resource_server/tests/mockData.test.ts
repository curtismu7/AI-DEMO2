'use strict';
import { loadMockData } from '../src/shared/mockData';

describe('loadMockData', () => {
  it('loads healthcare mock data and returns patientRecords array', () => {
    const data = loadMockData('healthcare');
    expect(Array.isArray((data as any).patientRecords)).toBe(true);
    expect((data as any).patientRecords.length).toBeGreaterThan(0);
  });

  it('throws for an unknown vertical', () => {
    expect(() => loadMockData('does-not-exist')).toThrow(/not found/i);
  });
});
