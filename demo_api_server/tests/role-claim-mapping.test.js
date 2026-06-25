'use strict';
/**
 * Role Claim Mapping Tests (Phase 169-04)
 *
 * Verifies roleClaimResolver correctly maps token claims to admin/customer role
 * for PingOne, Azure AD, Auth0, Okta, and edge cases.
 * No live credentials — all env-var driven.
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch (_) {}

describe('roleClaimResolver', () => {
  let resolver;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.OAUTH_ROLE_CLAIM_NAME;
    delete process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN;
    delete process.env.OAUTH_ROLE_CLAIM_VALUE_CUSTOMER;
    delete process.env.OAUTH_ROLE_CLAIM_IS_ARRAY;
  });

  afterEach(() => {
    delete process.env.OAUTH_ROLE_CLAIM_NAME;
    delete process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN;
    delete process.env.OAUTH_ROLE_CLAIM_VALUE_CUSTOMER;
    delete process.env.OAUTH_ROLE_CLAIM_IS_ARRAY;
  });

  // ── Test 1: PingOne population_id string ──────────────────────────────────
  test('returns admin for PingOne population_id string match', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'population_id';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'admin-pop-uuid-123';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'false';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ population_id: 'admin-pop-uuid-123' })).toBe('admin');
  });

  // ── Test 2: PingOne population_id — customer ──────────────────────────────
  test('returns customer for PingOne population_id customer match', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME           = 'population_id';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN    = 'admin-pop-uuid-123';
    process.env.OAUTH_ROLE_CLAIM_VALUE_CUSTOMER = 'customer-pop-uuid-456';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY       = 'false';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ population_id: 'customer-pop-uuid-456' })).toBe('customer');
  });

  // ── Test 3: Azure AD app_roles array ─────────────────────────────────────
  test('returns admin for Azure AD app_roles array containing admin value', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'app_roles';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'admin';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ app_roles: ['admin', 'user'] })).toBe('admin');
  });

  // ── Test 4: Azure AD — customer ───────────────────────────────────────────
  test('returns customer for Azure AD app_roles array with only user role', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME           = 'app_roles';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN    = 'admin';
    process.env.OAUTH_ROLE_CLAIM_VALUE_CUSTOMER = 'user';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY       = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ app_roles: ['user', 'viewer'] })).toBe('customer');
  });

  // ── Test 5: Auth0 role URI suffix matching ────────────────────────────────
  test('returns admin for Auth0 role URI when suffix matches', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'roles';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'admin';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({
      roles: ['https://banking.auth0.com/roles/admin', 'https://banking.auth0.com/roles/user'],
    })).toBe('admin');
  });

  // ── Test 6: Auth0 — no admin URI ─────────────────────────────────────────
  test('returns null for Auth0 when no role matches admin or customer', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME           = 'roles';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN    = 'admin';
    process.env.OAUTH_ROLE_CLAIM_VALUE_CUSTOMER = 'customer';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY       = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({
      roles: ['https://banking.auth0.com/roles/viewer'],
    })).toBeNull();
  });

  // ── Test 7: Okta groups array ─────────────────────────────────────────────
  test('returns admin for Okta groups array containing admin group', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'groups';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'banking-admins';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ groups: ['all-users', 'banking-admins'] })).toBe('admin');
  });

  // ── Test 8: missing claim — returns null ──────────────────────────────────
  test('returns null when claim is missing from token', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'app_roles';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'admin';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ sub: 'user-123', email: 'user@example.com' })).toBeNull();
  });

  // ── Test 9: no config — returns null ─────────────────────────────────────
  test('returns null when neither admin nor customer value is configured', () => {
    // Default: OAUTH_ROLE_CLAIM_VALUE_ADMIN and _CUSTOMER are both empty
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ population_id: 'some-uuid' })).toBeNull();
  });

  // ── Test 10: array with multiple roles — admin wins ───────────────────────
  test('admin wins when array contains both admin and customer values', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME           = 'roles';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN    = 'admin';
    process.env.OAUTH_ROLE_CLAIM_VALUE_CUSTOMER = 'customer';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY       = 'true';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ roles: ['customer', 'admin'] })).toBe('admin');
  });

  // ── Test 11: exact string match — case sensitive ──────────────────────────
  test('role value matching is case-sensitive', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'role';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'Admin';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'false';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims({ role: 'admin' })).toBeNull(); // lowercase ≠ 'Admin'
    expect(resolver.getRoleFromClaims({ role: 'Admin' })).toBe('admin');
  });

  // ── Test 12: null/undefined claims ───────────────────────────────────────
  test('returns null for null or undefined claims argument', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'population_id';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'admin-uuid';
    resolver = require('../services/roleClaimResolver');

    expect(resolver.getRoleFromClaims(null)).toBeNull();
    expect(resolver.getRoleFromClaims(undefined)).toBeNull();
  });

  // ── Test 13: single-value array treated as array ──────────────────────────
  test('wraps non-array claim in array when oauth_role_claim_is_array=true', () => {
    process.env.OAUTH_ROLE_CLAIM_NAME        = 'role';
    process.env.OAUTH_ROLE_CLAIM_VALUE_ADMIN = 'admin';
    process.env.OAUTH_ROLE_CLAIM_IS_ARRAY    = 'true';
    resolver = require('../services/roleClaimResolver');

    // IDP returned a string instead of array — still matched
    expect(resolver.getRoleFromClaims({ role: 'admin' })).toBe('admin');
  });
});
