'use strict';

/**
 * GET /admin/current-snapshot
 *
 * Regenerates the P1AZ import file from scope-topology.json — the same
 * reconciler `snapshots/gen-authorize-snapshot.js` runs as a CLI — instead of
 * serving whatever was last written to disk. Keeps the downloaded snapshot
 * current with the source of truth without requiring anyone to remember to
 * re-run the script and commit the result.
 */

const fs = require('fs');
const path = require('path');
const { reconcile, loadSot, SNAP } = require(path.join(__dirname, '../../snapshots/gen-authorize-snapshot.js'));

module.exports = function generateSnapshot(_req, res) {
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  reconcile(snap, loadSot());
  const out = '[\n  ' + snap.map((o) => JSON.stringify(o)).join(',\n  ') + '\n]\n';
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="Super_Banking_Transaction_Authorization_P1AZ.snapshot.json"');
  res.send(out);
};
