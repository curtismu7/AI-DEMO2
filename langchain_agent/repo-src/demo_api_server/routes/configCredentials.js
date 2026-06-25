// banking_api_server/routes/configCredentials.js
const express = require('express');
const router = express.Router();
const configStore = require('../services/configStore');

/**
 * Credential type → required config keys mapping.
 * Each entry defines the fields the user must provide and the
 * configStore keys they map to.
 */
const CREDENTIAL_SCHEMAS = {
  customer_oauth: {
    fields: ['client_id', 'client_secret'],
    configMap: {
      client_id:     'PINGONE_CLIENT_ID',
      client_secret: 'PINGONE_CLIENT_SECRET',
    },
    label: 'Customer OAuth Application',
  },
  admin_oauth: {
    fields: ['client_id', 'client_secret'],
    configMap: {
      client_id:     'PINGONE_ADMIN_CLIENT_ID',
      client_secret: 'PINGONE_ADMIN_CLIENT_SECRET',
    },
    label: 'Admin OAuth Application',
  },
  worker_token: {
    fields: ['worker_app_id', 'worker_app_secret'],
    configMap: {
      worker_app_id:     'PINGONE_WORKER_APP_ID',
      worker_app_secret: 'PINGONE_WORKER_APP_SECRET',
    },
    label: 'Worker Application',
  },
  ai_agent: {
    fields: ['client_id', 'client_secret'],
    configMap: {
      client_id:     'PINGONE_AI_AGENT_CLIENT_ID',
      client_secret: 'PINGONE_AI_AGENT_CLIENT_SECRET',
    },
    label: 'AI Agent Application',
  },
  environment: {
    fields: ['environment_id'],
    configMap: {
      environment_id: 'PINGONE_ENVIRONMENT_ID',
    },
    label: 'PingOne Environment',
  },
};

/**
 * Action type → required credential types.
 * When a user tries an action, we check all required credential types
 * and report the first set of missing fields.
 */
const ACTION_REQUIREMENTS = {
  agent_mcp:     ['environment', 'ai_agent'],
  admin_login:   ['environment', 'admin_oauth'],
  user_login:    ['environment', 'customer_oauth'],
  worker_api:    ['environment', 'worker_token'],
};

// Allowed config keys that can be set via this endpoint (whitelist)
const ALLOWED_CONFIG_KEYS = new Set(
  Object.values(CREDENTIAL_SCHEMAS)
    .flatMap((s) => Object.values(s.configMap))
);

/**
 * GET /api/config/credentials/missing?action=<actionType>
 * Returns which credentials are missing for the requested action.
 */
router.get('/missing', (req, res) => {
  const { action } = req.query;

  if (!action || !ACTION_REQUIREMENTS[action]) {
    return res.json({
      allSet: true,
      missing: [],
      credentialType: null,
      message: action ? `Unknown action "${action}"` : 'No action specified',
    });
  }

  const requiredTypes = ACTION_REQUIREMENTS[action];

  for (const credType of requiredTypes) {
    const schema = CREDENTIAL_SCHEMAS[credType];
    if (!schema) continue;

    const missing = [];
    for (const field of schema.fields) {
      const configKey = schema.configMap[field];
      const value = configStore.getEffective(configKey);
      if (!value) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return res.json({
        allSet: false,
        missing,
        credentialType: credType,
        label: schema.label,
        message: `${schema.label} credentials are required for this operation.`,
      });
    }
  }

  return res.json({ allSet: true, missing: [], credentialType: null });
});

/**
 * POST /api/config/credentials/set
 * Body: { credentialType, credentials: { field: value, ... } }
 * Saves credentials to configStore.
 */
router.post('/set', async (req, res) => {
  try {
    const { credentialType, credentials } = req.body;

    // Validate credential type
    const schema = CREDENTIAL_SCHEMAS[credentialType];
    if (!schema) {
      return res.status(400).json({
        error: 'invalid_credential_type',
        message: `Unknown credential type: ${credentialType}`,
      });
    }

    // Validate that only expected fields are provided
    const configUpdate = {};
    const updated = [];

    for (const [field, value] of Object.entries(credentials || {})) {
      const configKey = schema.configMap[field];
      if (!configKey || !ALLOWED_CONFIG_KEYS.has(configKey)) {
        return res.status(400).json({
          error: 'invalid_field',
          message: `Field "${field}" is not allowed for credential type "${credentialType}".`,
        });
      }
      if (typeof value !== 'string' || !value.trim()) {
        return res.status(400).json({
          error: 'invalid_value',
          message: `Field "${field}" must be a non-empty string.`,
        });
      }
      configUpdate[configKey] = value.trim();
      updated.push(field);
    }

    if (updated.length === 0) {
      return res.status(400).json({
        error: 'no_credentials',
        message: 'No credentials provided.',
      });
    }

    // Persist to configStore
    await configStore.setConfig(configUpdate);

    console.log(`[configCredentials] Updated ${updated.length} credential(s) for ${credentialType}: ${updated.join(', ')}`);

    return res.json({
      ok: true,
      updated,
      credentialType,
    });
  } catch (err) {
    console.error('[configCredentials] Error saving credentials:', err.message);
    return res.status(500).json({
      error: 'save_failed',
      message: 'Failed to save credentials. Please try again.',
    });
  }
});

module.exports = router;
