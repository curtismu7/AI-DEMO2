'use strict';

const { getDb } = require('./openEnv');

const DB_NAME = 'hostedRegistrations';

function db() { return getDb(DB_NAME); }
function get(id) { return db().get(String(id)) || null; }
function put(record) { db().putSync(String(record.id), record); return record; }
function remove(id) { db().removeSync(String(id)); }
function list() { return [...db().getRange()].map(({ value }) => value).filter(Boolean); }

module.exports = { DB_NAME, get, put, remove, list };
