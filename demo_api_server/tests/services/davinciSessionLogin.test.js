'use strict';
jest.mock('../../data/store', () => ({ getUserByUsername: jest.fn() }));
const dataStore = require('../../data/store');
const { findDemoUser, regenerateSession, saveSession } = require('../../services/davinciSessionLogin');

function mockRes() {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
}

describe('davinciSessionLogin', () => {
  let errSpy;
  beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errSpy.mockRestore(); jest.clearAllMocks(); });

  test('findDemoUser returns the existing user', () => {
    const user = { username: 'u1' };
    dataStore.getUserByUsername.mockReturnValue(user);
    const res = mockRes();
    expect(findDemoUser({ username: 'u1' }, res)).toBe(user);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('findDemoUser sends 404 user_not_found and returns null', () => {
    dataStore.getUserByUsername.mockReturnValue(undefined);
    const res = mockRes();
    expect(findDemoUser({ username: 'ghost' }, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'user_not_found', message: 'No demo user found for "ghost".' });
  });

  test('regenerateSession calls next on success', () => {
    const req = { session: { regenerate: (cb) => cb(null) } };
    const next = jest.fn();
    regenerateSession(req, mockRes(), '[x]', next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('regenerateSession is fatal on failure: 500, logs with prefix, no next', () => {
    const req = { session: { regenerate: (cb) => cb(new Error('boom')) } };
    const res = mockRes();
    const next = jest.fn();
    regenerateSession(req, res, '[x]', next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'session_regenerate_failed', message: 'Could not establish a session.' });
    expect(errSpy).toHaveBeenCalledWith('[x] Session regenerate FAILED — aborting login:', 'boom');
  });

  test('saveSession runs onSaved on success', () => {
    const req = { session: { save: (cb) => cb(null) } };
    const onSaved = jest.fn();
    saveSession(req, mockRes(), '[x]', onSaved);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test('saveSession sends 500 on failure', () => {
    const req = { session: { save: (cb) => cb(new Error('nope')) } };
    const res = mockRes();
    const onSaved = jest.fn();
    saveSession(req, res, '[x]', onSaved);
    expect(onSaved).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'session_save_failed', message: 'Could not persist session.' });
    expect(errSpy).toHaveBeenCalledWith('[x] Session save FAILED:', 'nope');
  });
});
