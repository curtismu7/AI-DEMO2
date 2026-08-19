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

    /** Tool names the SoT gates with the given challengeType. */
    const sotToolsForChallenge = (challengeType) => Object.entries(manifest.tools || {})
      .filter(([_, t]) => t.challengeType === challengeType)
      .map(([n]) => n)
      .sort();

    /**
     * Compare one challenge condition against the SoT.
     *
     * The condition being ABSENT is drift in its own right, and a worse one than
     * a tool being dropped from it: a snapshot missing RequiresHitlConsent
     * un-gates EVERY consent tool, where the .FIXED.json variant only un-gated
     * three. The previous `if (cond) {...}` shape skipped the whole comparison in
     * that case and scored zero conflicts — valid:true, HTTP 200.
     *
     * A rename lands here too. The lookup is by NAME while
     * gen-authorize-snapshot.js addresses conditions by stable ID, so an
     * ID-preserving rename is invisible to the generator and would otherwise
     * silently disable this check forever.
     *
     * Absence is only a conflict when the SoT actually expects tools of that
     * kind — if nothing is gated with this challengeType, a snapshot without the
     * condition is correct, not drift.
     */
    const checkChallengeCondition = ({ conditionName, challengeType, missingType, mismatchType }) => {
      const sotTools = sotToolsForChallenge(challengeType);
      const cond = conditions.find(c => c.name === conditionName);

      if (!cond) {
        if (sotTools.length > 0) {
          conflicts.push({
            type: missingType,
            condition: conditionName,
            snapshot: null,
            sot: sotTools,
            message:
              `Condition "${conditionName}" is absent from the snapshot (deleted or renamed) while ` +
              `scope-topology.json still gates ${sotTools.length} tool(s) with challengeType=${challengeType}. ` +
              `Importing would un-gate all of them.`,
          });
        }
        return;
      }

      const snapshotTools = extractToolsFromCondition(cond);
      if (JSON.stringify(snapshotTools) !== JSON.stringify(sotTools)) {
        conflicts.push({
          type: mismatchType,
          snapshot: snapshotTools,
          sot: sotTools,
        });
      }
    };

    // Verify consent tools
    checkChallengeCondition({
      conditionName: 'RequiresHitlConsent',
      challengeType: 'consent',
      missingType: 'consent_condition_missing',
      mismatchType: 'consent_tool_mismatch',
    });

    // Verify step-up tools
    checkChallengeCondition({
      conditionName: 'RequiresMcpStepUp',
      challengeType: 'step_up',
      missingType: 'step_up_condition_missing',
      mismatchType: 'step_up_tool_mismatch',
    });

    // Verify HasValidMcpAudience — the round-3 import blocker. Post-C1 every
    // caller sends the token's REAL single aud as TokenAudience, so the
    // condition must be an OR of `TokenAudience Equals <accepted gateway
    // identity>` whose constants match the SoT gateway resources exactly.
    // Two shapes make an import deny ALL MCP traffic and must block:
    //   1. the pre-round-3 attribute-to-attribute equality
    //      (TokenAudience == McpResourceUri) — never true post-C1;
    //   2. a wrong/partial constant set — a dropped identity denies that
    //      gateway wholesale, a foreign one admits nobody real.
    // Lookup is by NAME (like the challenge conditions): a rename or delete
    // reads as missing and blocks too. Must list every accepted gateway
    // identity in scope-topology.json's resources — the A2A gateway
    // (mcpgateway-a2a.ping.demo) is a real, distinct accepted audience
    // alongside the primary MCP and PingGateway ones; omitting it here made
    // this check compare the SoT's 2 known audiences against the tracked
    // snapshot's real 3, reporting a false mcp_audience_mismatch on every
    // snapshot that correctly includes A2A.
    // Must stay in step with the generator's own list
    // (snapshots/gen-authorize-snapshot.js GATEWAY_RESOURCE_NAMES) — these are
    // two hand-maintained copies of the same set, and they DID drift: the
    // API-Key PingGateway identity was added to the SoT and the generator but
    // not here, so this validator rejected the correctly-generated snapshot
    // with a false mcp_audience_mismatch (409). That is the same omission the
    // comment above records fixing once for the A2A gateway — second time for
    // this list. Adding a gateway resource to the SoT means adding it in BOTH
    // places.
    const GATEWAY_RESOURCE_NAMES = [
      'Super Banking MCP Gateway',
      'Super Banking PingGateway MCP',
      'Super Banking PingGateway MCP - API-Key',
      'Super Banking A2A MCP Gateway',
    ];
    const sotGatewayAuds = GATEWAY_RESOURCE_NAMES
      .map((n) => manifest.resources && manifest.resources[n] && manifest.resources[n].uri)
      .filter(Boolean)
      .sort();
    const audCond = conditions.find((c) => c.name === 'HasValidMcpAudience');
    if (sotGatewayAuds.length !== GATEWAY_RESOURCE_NAMES.length) {
      conflicts.push({
        type: 'mcp_audience_sot_missing',
        sot: sotGatewayAuds,
        message:
          `scope-topology.json resources does not define every accepted gateway identity ` +
          `(${GATEWAY_RESOURCE_NAMES.join(', ')}) — cannot validate HasValidMcpAudience; failing closed.`,
      });
    } else if (!audCond) {
      conflicts.push({
        type: 'mcp_audience_condition_missing',
        condition: 'HasValidMcpAudience',
        snapshot: null,
        sot: sotGatewayAuds,
        message:
          'Condition "HasValidMcpAudience" is absent from the snapshot (deleted or renamed). ' +
          'Importing would leave MCP audience validation undefined.',
      });
    } else {
      let attributeEquality = false;
      const audConstants = [];
      const walkAud = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.comparison) {
          if (node.comparison.right && node.comparison.right.attribute) attributeEquality = true;
          if (node.comparison.right && node.comparison.right.constant) {
            const v = node.comparison.right.constant.value;
            if (typeof v === 'string' && v) audConstants.push(v);
          }
        }
        if (node.and) (node.and.conditions || []).forEach(walkAud);
        if (node.or) (node.or.conditions || []).forEach(walkAud);
        if (node.not) walkAud(node.not.condition);
      };
      walkAud(audCond.condition);
      if (attributeEquality) {
        conflicts.push({
          type: 'mcp_audience_attribute_equality',
          condition: 'HasValidMcpAudience',
          message:
            'HasValidMcpAudience compares TokenAudience against another ATTRIBUTE (the pre-round-3 ' +
            'TokenAudience == McpResourceUri equality). Post-C1 that is never true — importing this ' +
            'snapshot would deny ALL MCP traffic. It must be an OR of Equals against the accepted ' +
            'gateway identity constants.',
        });
      }
      const snapshotAuds = [...new Set(audConstants)].sort();
      if (!attributeEquality && JSON.stringify(snapshotAuds) !== JSON.stringify(sotGatewayAuds)) {
        conflicts.push({
          type: 'mcp_audience_mismatch',
          snapshot: snapshotAuds,
          sot: sotGatewayAuds,
          message:
            'HasValidMcpAudience constants do not match the SoT gateway identities. A dropped identity ' +
            'denies that gateway wholesale; a foreign one admits no real caller.',
        });
      }
    }

    // Verify the round-3 fine-grained deny statement codes exist. The BFF
    // obligation classifier keys on these codes; a snapshot missing one ships a
    // rule whose deny is unclassifiable (or drops the rule entirely).
    const REQUIRED_STATEMENT_CODES = [
      'mcp-bypass-attempt',
      'mcp-resource-owner-mismatch',
      'mcp-intent-invalid',
      'mcp-intent-mismatch',
      'mcp-admin-role-not-permitted',
      // RAR amount-cap deny (#611/#615) — code matches the simulated engine's
      // deny_reason (rar_amount_exceeded), not the mcp-* convention.
      'rar_amount_exceeded',
    ];
    for (const code of REQUIRED_STATEMENT_CODES) {
      if (!statements.some((s) => s.code === code)) {
        conflicts.push({
          type: 'statement_code_missing',
          code,
          message: `Statement code "${code}" is required by the round-3 fine-grained deny rules but is absent from the snapshot.`,
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
