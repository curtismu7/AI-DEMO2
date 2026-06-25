/**
 * Tier Resolver — resolves user tier from vertical-scoped tier config
 * Reads tier definitions from active vertical's manifest
 */

function resolveTierConfig(manifest) {
  if (!manifest || !manifest.tiers) {
    return { default: 'Standard', definitions: {} };
  }
  return manifest.tiers;
}

function getUserTierFromGroups(userGroups, tierConfig) {
  if (!Array.isArray(userGroups) || !tierConfig.groupToTier) {
    return tierConfig.default || 'Standard';
  }

  for (const group of userGroups) {
    if (tierConfig.groupToTier[group]) {
      return tierConfig.groupToTier[group];
    }
  }

  return tierConfig.default || 'Standard';
}

function getTierDefinition(tier, tierConfig) {
  return tierConfig.definitions?.[tier] || {
    maxAmountUsd: 2000,
    restrictedTools: []
  };
}

module.exports = {
  resolveTierConfig,
  getUserTierFromGroups,
  getTierDefinition
};
