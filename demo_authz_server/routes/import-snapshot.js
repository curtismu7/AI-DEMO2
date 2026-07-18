'use strict';

/**
 * POST /admin/import-snapshot
 *
 * Validates that a P1AZ snapshot can be imported and its policies match
 * the mock authz server's decision logic. This ensures P1AZ and mock stay
 * in sync — if the import succeeds, they have identical policies.
 *
 * Body: multipart/form-data with snapshot.json file
 * Response: { valid: true/false, policies: [...], conflicts: [...] }
 */

const path = require('path');
const manifest = require(path.join(__dirname, '../../scope-topology.json'));

module.exports = async function importSnapshot(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No snapshot file provided' });
  }

  try {
    const content = req.file.buffer.toString('utf8');
    const snapshot = JSON.parse(content);

    // Extract all object types from snapshot
    const attributes = snapshot.filter(o => o.type === 'ATTRIBUTE');
    const policies = snapshot.filter(o => o.type === 'Policy' || o.type === 'PolicySet');
    const conditions = snapshot.filter(o => o.type === 'CONDITION');
    const statements = snapshot.filter(o => o.type === 'Statement');
    const rules = snapshot.filter(o => o.type === 'Rule');

    const conflicts = [];
    const report = {
      valid: true,
      summary: {
        attributes: attributes.length,
        policies: policies.length,
        conditions: conditions.length,
        statements: statements.length,
        rules: rules.length,
      },
      conflicts: [],
    };

    // Extract tool lists from snapshot conditions
    const extractToolsFromCondition = (cond) => {
      const tools = [];
      const walk = (obj) => {
        if (obj.comparison && obj.comparison.right && obj.comparison.right.constant) {
          const val = obj.comparison.right.constant.value;
          // Tool names only: skip booleans and any numeric constant (amount
          // thresholds like 250/500/2000 are env-driven, so don't hardcode them —
          // a changed threshold must not be mis-extracted as a tool name).
          const isNumeric = typeof val === 'string' && /^\d+(\.\d+)?$/.test(val);
          if (typeof val === 'string' && val && !['true', 'false'].includes(val) && !isNumeric) {
            tools.push(val);
          }
        }
        if (obj.and) obj.and.conditions?.forEach(walk);
        if (obj.or) obj.or.conditions?.forEach(walk);
      };
      walk(cond.condition);
      return [...new Set(tools)].sort();
    };

    // Verify consent tools
    const consentCond = conditions.find(c => c.name === 'RequiresHitlConsent');
    if (consentCond) {
      const snapshotConsent = extractToolsFromCondition(consentCond);
      const sotConsent = Object.entries(manifest.tools || {})
        .filter(([_, t]) => t.challengeType === 'consent')
        .map(([n]) => n)
        .sort();

      if (JSON.stringify(snapshotConsent) !== JSON.stringify(sotConsent)) {
        conflicts.push({
          type: 'consent_tool_mismatch',
          snapshot: snapshotConsent,
          sot: sotConsent,
        });
      }
    }

    // Verify step-up tools
    const stepUpCond = conditions.find(c => c.name === 'RequiresMcpStepUp');
    if (stepUpCond) {
      const snapshotStepUp = extractToolsFromCondition(stepUpCond);
      const sotStepUp = Object.entries(manifest.tools || {})
        .filter(([_, t]) => t.challengeType === 'step_up')
        .map(([n]) => n)
        .sort();

      if (JSON.stringify(snapshotStepUp) !== JSON.stringify(sotStepUp)) {
        conflicts.push({
          type: 'step_up_tool_mismatch',
          snapshot: snapshotStepUp,
          sot: sotStepUp,
        });
      }
    }

    // Verify statement sharing. Any statement referenced by MORE THAN ONE rule
    // is multi-parented and must be `shared: true`, or the import produces a
    // multi-parent conflict. This is derived from the snapshot's own rule graph
    // rather than a hardcoded id: the previous check only covered the step-up
    // statement, so `mcp-authorization-denied` — shared across seven MCP deny
    // rules — was never validated.
    const referencedBy = new Map();
    for (const rule of rules) {
      for (const ref of rule.statements || []) {
        const id = typeof ref === 'string' ? ref : ref && ref.id;
        if (!id) continue;
        referencedBy.set(id, (referencedBy.get(id) || 0) + 1);
      }
    }
    for (const stmt of statements) {
      const count = referencedBy.get(stmt.id) || 0;
      if (count > 1 && !stmt.shared) {
        conflicts.push({
          type: 'statement_not_shared',
          statement: `${stmt.code || stmt.name || 'unknown'} (${stmt.id})`,
          referencedBy: count,
          message: `Referenced by ${count} rules — must be shared: true to avoid multi-parent conflict`,
        });
      }
    }

    report.conflicts = conflicts;
    report.valid = conflicts.length === 0;

    // Parity failures BLOCK the import (F9). Returning 200 with `valid:false`
    // let an automated importer treat a drifted snapshot as success — e.g. a
    // snapshot that drops tools from RequiresHitlConsent silently un-gates them.
    // The full report is still returned so the caller can show the conflicts.
    if (!report.valid) {
      return res.status(409).json(report);
    }
    res.json(report);
  } catch (err) {
    res.status(400).json({
      error: 'Invalid snapshot file',
      message: err.message,
    });
  }
};
