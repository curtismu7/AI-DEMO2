'use strict';

/**
 * The airlines vertical's catalog bindings. Before this, `airlines` was absent
 * from VERTICALS, so /api/use-cases 400'd with unknown_vertical and the Demo
 * Steps dropdown rendered "No demo steps for this vertical".
 */

const fs = require('fs');
const path = require('path');

const { VERTICALS, listUseCases, resolveUseCase } = require('../config/useCases');

// demoUseCaseSteps.js is an ES module in the UI package — jest here is CommonJS,
// so read the list out of the source rather than require()ing it. Same technique
// airlinesVertical.test.js uses to reach the resource server's TypeScript.
function demoPrimaryUseCaseIds() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'demo_api_ui', 'src', 'config', 'demoUseCaseSteps.js'),
    'utf8',
  );
  const block = src.match(/export const DEMO_PRIMARY_USE_CASE_IDS = \[([\s\S]*?)\];/);
  if (!block) throw new Error('DEMO_PRIMARY_USE_CASE_IDS not found in demoUseCaseSteps.js');
  return block[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
}

describe('airlines use-case catalog', () => {
  test('airlines is a known vertical', () => {
    expect(VERTICALS).toContain('airlines');
  });

  test('every step in the presenter ladder resolves', () => {
    const catalog = listUseCases('airlines');
    for (const id of demoPrimaryUseCaseIds()) {
      expect(catalog.find((u) => u.id === id)).toBeDefined();
    }
  });

  test('UC1 reads reservations, not balances', () => {
    const uc = resolveUseCase('UC1', 'airlines');
    expect(uc.primaryTool).toBe('get_airline_bookings');
    expect(uc.trigger.text).toBe('show my reservations');
  });

  test.each([
    ['UC6', 2500],
    ['UC7', 600],
    ['UC8', 300],
    ['UC22', 150],
  ])('%s binds the amount ladder to pay_airline_fee at $%d', (id, amount) => {
    const uc = resolveUseCase(id, 'airlines');
    expect(uc.primaryTool).toBe('pay_airline_fee');
    expect(uc.trigger.text).toBe(`pay a $${amount} change fee`);
  });

  // The A2A-delegated record, not the consent-gated reservation lookup — the
  // specialist's Exchange #2 scope is pnr:read, which no session token holds.
  test('UC2 routes to the A2A passenger record, not the plain lookup', () => {
    const uc = resolveUseCase('UC2', 'airlines');
    expect(uc.primaryTool).toBe('sensitive_passenger_record');
  });

  test('UC24 asks about airports, not bank branches', () => {
    const uc = resolveUseCase('UC24', 'airlines');
    expect(uc.trigger.text).toMatch(/airport/i);
  });

  test('no airlines chip leaks a banking phrase', () => {
    const banned = /balance|account|transfer|bill|portfolio/i;
    for (const uc of listUseCases('airlines')) {
      if (uc.trigger && uc.trigger.type === 'chip') {
        expect(uc.trigger.text).not.toMatch(banned);
      }
    }
  });
});
