'use strict';
import { ALL_TOOLS, findTool, dispatch } from '../src/tools/registry';

describe('ALL_TOOLS registry', () => {
  it('contains tools from all 11 verticals', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    // Pre-existing
    expect(names).toContain('get_investment_accounts');
    expect(names).toContain('get_airline_bookings');
    // New verticals
    expect(names).toContain('list_banking_accounts');
    expect(names).toContain('list_patient_records');
    expect(names).toContain('list_permits');
    expect(names).toContain('list_work_orders');
    expect(names).toContain('list_orders');
    expect(names).toContain('list_gear_orders');
    expect(names).toContain('list_courses');
    expect(names).toContain('list_expenses');
    expect(names).toContain('list_anf_orders');
  });

  it('every tool in ALL_TOOLS has intentHints or is a pre-existing tool', () => {
    const preExisting = new Set([
      'get_investment_accounts', 'get_investment_balance', 'get_portfolio_summary',
      'get_investment_transactions', 'pay_airline_fee', 'cancel_airline_reservation',
      'sensitive_airline_bookings', 'get_airline_bookings', 'get_flight_status',
      'check_seat_availability', 'sensitive_passenger_record',
    ]);
    for (const t of ALL_TOOLS) {
      if (!preExisting.has(t.name)) {
        expect(Array.isArray(t.intentHints)).toBe(true);
      }
    }
  });

  it('dispatch routes banking tool correctly', async () => {
    const result = await dispatch('list_banking_accounts', {}, '', '') as any;
    expect(Array.isArray(result.accounts)).toBe(true);
  });

  it('dispatch routes healthcare tool correctly', async () => {
    const result = await dispatch('list_patient_records', {}, '', '') as any;
    expect(Array.isArray(result.records)).toBe(true);
  });
});
