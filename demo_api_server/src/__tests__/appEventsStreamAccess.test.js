'use strict';
const { controlPlaneVisible, isAdmin } = require('../../routes/appEventsStreamFilter');

describe('control_plane stream visibility', () => {
  it('admin (role) sees every category', () => {
    expect(controlPlaneVisible({ role: 'admin' }, { category: 'agent' })).toBe(true);
    expect(controlPlaneVisible({ role: 'admin' }, { category: 'control_plane' })).toBe(true);
  });

  it('admin (scope) sees every category', () => {
    expect(isAdmin({ role: 'user', scopes: ['admin'] })).toBe(true);
    expect(controlPlaneVisible({ scopes: ['admin'] }, { category: 'agent' })).toBe(true);
  });

  it('non-admin sees only control_plane', () => {
    expect(controlPlaneVisible({ role: 'user' }, { category: 'agent' })).toBe(false);
    expect(controlPlaneVisible({ role: 'user' }, { category: 'control_plane' })).toBe(true);
  });

  it('no user / no event is not visible', () => {
    expect(controlPlaneVisible(null, { category: 'control_plane' })).toBe(false);
    expect(controlPlaneVisible({ role: 'user' }, null)).toBe(false);
  });
});
