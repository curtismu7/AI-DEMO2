'use strict';

/**
 * The auth-requirement SoT and the catalog surface that carries it to the UI.
 *
 * UC24 (Act 1 — public catalog) is the reason this exists: the client had no
 * way to tell a public use case from a protected one, so it gated every demo
 * step on `isLoggedIn` and raised a "please sign in" banner over a step that
 * had already answered.
 */

const request = require('supertest');
const express = require('express');

const {
  AUTH_REQUIREMENTS, authLevelForUseCase, authLevelForRoute, isPublicUseCase, compareLevels,
} = require('../config/authRequirements');
const { USE_CASES } = require('../config/useCases');
const useCasesRouter = require('../routes/useCases');

function makeApp() {
  const app = express();
  app.use('/api/use-cases', useCasesRouter);
  return app;
}

describe('auth-requirements SoT', () => {
  test('UC24 is public — Act 1 is defined as needing no session', () => {
    expect(authLevelForUseCase('UC24')).toBe('public');
    expect(isPublicUseCase('UC24')).toBe(true);
  });

  test('money-moving and delegation use cases require a session', () => {
    for (const id of ['UC1', 'UC6', 'UC7', 'UC8', 'UC22']) {
      expect(authLevelForUseCase(id)).toBe('user');
      expect(isPublicUseCase(id)).toBe(false);
    }
  });

  test('admin demo steps require an admin token', () => {
    expect(authLevelForUseCase('ADMIN1')).toBe('admin');
  });

  // Omission must not open a door: an id nobody listed is treated as protected.
  test('an unknown id falls back to the default level, not public', () => {
    expect(authLevelForUseCase('UC-DOES-NOT-EXIST')).toBe('user');
    expect(isPublicUseCase('UC-DOES-NOT-EXIST')).toBe(false);
    expect(authLevelForRoute('/no/such/route')).toBe('user');
  });

  test('levels rank public < user < admin', () => {
    expect(compareLevels('public', 'user')).toBeLessThan(0);
    expect(compareLevels('admin', 'user')).toBeGreaterThan(0);
    expect(compareLevels('user', 'user')).toBe(0);
  });

  test('every use case in the catalog has a level', () => {
    const missing = USE_CASES.map((u) => u.id).filter((id) => !AUTH_REQUIREMENTS.useCases[id]);
    expect(missing).toEqual([]);
  });

  test('branch_hours is the declared public agent action', () => {
    expect(AUTH_REQUIREMENTS.publicAgentActions).toEqual(['branch_hours']);
  });
});

describe('GET /api/use-cases carries the level to the UI', () => {
  test('stamps auth on every entry and ships the public action list', async () => {
    const res = await request(makeApp()).get('/api/use-cases?vertical=banking');
    expect(res.status).toBe(200);
    expect(res.body.publicAgentActions).toEqual(['branch_hours']);

    const withoutAuth = res.body.useCases.filter((uc) => !uc.auth);
    expect(withoutAuth).toEqual([]);

    const uc24 = res.body.useCases.find((uc) => uc.id === 'UC24');
    expect(uc24.auth).toBe('public');
    const uc1 = res.body.useCases.find((uc) => uc.id === 'UC1');
    expect(uc1.auth).toBe('user');
  });

  test('admin demo steps are stamped too', async () => {
    const res = await request(makeApp()).get('/api/use-cases?vertical=pingone-admin');
    expect(res.status).toBe(200);
    expect(res.body.useCases.every((uc) => uc.auth === 'admin')).toBe(true);
  });

  test('single-use-case reads carry the level', async () => {
    const res = await request(makeApp()).get('/api/use-cases/UC24?vertical=banking');
    expect(res.status).toBe(200);
    expect(res.body.useCase.auth).toBe('public');
  });
});
