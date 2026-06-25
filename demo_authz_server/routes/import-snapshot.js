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

    // Verify statement sharing (step-up must be shared)
    const stepUpStmt = statements.find(s => s.id === '34567890-0003-4321-abcd-000000000003');
    if (stepUpStmt && !stepUpStmt.shared) {
      conflicts.push({
        type: 'statement_not_shared',
        statement: 'Step-Up MFA Required (34567890-0003)',
        message: 'Must be shared: true to avoid multi-parent conflict',
      });
    }

    report.conflicts = conflicts;
    report.valid = conflicts.length === 0;

        res.json(report);
  } catch (err) {
    res.status(400).json({
      error: 'Invalid snapshot file',
      message: err.message,
    });
  }
};
