/**
 * Setup Wizard Routes
 * 
 * SSE streaming API for PingOne environment provisioning.
 * Provides real-time progress updates during setup process.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
const path = require('path');
const router = express.Router();

const SERVER_ROOT = path.resolve(__dirname, '..');
const UI_ROOT = path.resolve(__dirname, '../../banking_api_ui');

const TEST_SUITES = {
  'bff:unit':  { cwd: SERVER_ROOT, cmd: 'npm', args: ['run', 'test:unit'],  label: 'BFF unit tests' },
  'bff:auth':  { cwd: SERVER_ROOT, cmd: 'npm', args: ['run', 'test:auth'],  label: 'BFF auth tests' },
  'bff:all':   { cwd: SERVER_ROOT, cmd: 'npm', args: ['test'],               label: 'BFF all tests' },
  'ui:unit':   { cwd: UI_ROOT,     cmd: 'npm', args: ['run', 'test:unit'],  label: 'UI unit tests' },
};
const {
    provisionEnvironment,
    recreateResource,
    wipeEnvironment,
    PingOneProvisionService
} = require('../services/pingoneProvisionService');
const {
    requireAdmin
} = require('../middleware/auth');

/**
 * POST /api/admin/setup/run
 * 
 * Main setup endpoint that provisions entire PingOne environment
 * and streams progress via Server-Sent Events.
 */
router.post('/run', requireAdmin, async (req, res) => {
    const {
        envId,
        workerClientId,
        workerClientSecret,
        region,
        publicAppUrl,
        audience,
        stepUpAcrValue
    } = req.body;

    // Validate required fields
    if (!envId || !workerClientId || !workerClientSecret) {
        return res.status(400).json({
            error: 'missing_required_fields',
            message: 'envId, workerClientId, and workerClientSecret are required'
        });
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Prevent nginx buffering
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ 
    step: 'connected', 
    icon: '🔗', 
    message: 'Connected to setup wizard' 
  })}\n\n`);

    const onStep = (step) => {
        try {
            res.write(`data: ${JSON.stringify(step)}\n\n`);
        } catch (error) {
            console.error('[setupWizard] Failed to write SSE event:', error.message);
        }
    };

    try {
        const config = {
            envId,
            workerClientId,
            workerClientSecret,
            region: region || 'com',
            publicAppUrl: publicAppUrl || process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000',
            audience: audience || 'enduser.ping.demo',
            stepUpAcrValue: stepUpAcrValue || 'Multi_factor'
        };

        console.log(`[setupWizard] Starting setup for environment ${envId}`);
        const result = await provisionEnvironment(config, onStep);

        // Send final success event
        onStep({
            step: 'complete',
            icon: '🎉',
            message: 'Setup complete! All resources provisioned successfully.',
            result: result.provisioned
        });

        console.log(`[setupWizard] Setup completed for environment ${envId}`);

    } catch (err) {
        console.error('[setupWizard] Setup failed:', err.message);

        // Send error event but don't close connection immediately
        onStep({
            step: 'error',
            icon: '❌',
            message: `Setup failed: ${err.message}`,
            error: err.message
        });
    }

    // Send termination signal
    try {
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        console.error('[setupWizard] Failed to close SSE connection:', error.message);
    }
});

/**
 * POST /api/admin/setup/recreate
 * 
 * Recreate a specific resource that was marked as existing
 */
router.post('/recreate', requireAdmin, async (req, res) => {
    const {
        resource,
        envId,
        workerClientId,
        workerClientSecret,
        region
    } = req.body;

    if (!resource || !envId || !workerClientId || !workerClientSecret) {
        return res.status(400).json({
            error: 'missing_required_fields',
            message: 'resource, envId, workerClientId, and workerClientSecret are required'
        });
    }

    // Set SSE headers for progress updates
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const onStep = (step) => {
        try {
            res.write(`data: ${JSON.stringify(step)}\n\n`);
        } catch (error) {
            console.error('[setupWizard] Failed to write SSE event:', error.message);
        }
    };

    try {
        const config = {
            envId,
            workerClientId,
            workerClientSecret,
            region: region || 'com'
        };

        onStep({
            step: 'recreate-start',
            icon: '🔄',
            message: `Recreating resource: ${resource}`
        });

        const result = await recreateResource(config, resource);

        if (result.success) {
            onStep({
                step: 'recreate-success',
                icon: '✅',
                message: result.message
            });
        } else {
            onStep({
                step: 'recreate-error',
                icon: '❌',
                message: `Failed to recreate resource: ${result.error}`
            });
        }

    } catch (err) {
        console.error('[setupWizard] Recreate failed:', err.message);
        onStep({
            step: 'recreate-error',
            icon: '❌',
            message: `Recreate failed: ${err.message}`
        });
    }

    try {
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        console.error('[setupWizard] Failed to close SSE connection:', error.message);
    }
});

/**
 * POST /api/admin/setup/validate
 * 
 * Validate worker credentials without running full setup
 */
router.post('/validate', requireAdmin, async (req, res) => {
    const {
        envId,
        workerClientId,
        workerClientSecret,
        region
    } = req.body;

    if (!envId || !workerClientId || !workerClientSecret) {
        return res.status(400).json({
            error: 'missing_required_fields',
            message: 'envId, workerClientId, and workerClientSecret are required'
        });
    }

    try {
        const {
            PingOneProvisionService
        } = require('../services/pingoneProvisionService');
        const service = new PingOneProvisionService();

        await service.initialize(envId, workerClientId, workerClientSecret, region || 'com');

        res.json({
            valid: true,
            message: 'Worker credentials are valid',
            environment: {
                envId,
                region: region || 'com',
                populationId: service.populationId
            }
        });

    } catch (err) {
        console.error('[setupWizard] Validation failed:', err.message);
        res.status(400).json({
            valid: false,
            message: 'Invalid worker credentials',
            error: err.message
        });
    }
});

/**
 * GET /api/admin/setup/status
 * 
 * Get current setup status and check what resources already exist
 */
router.get('/status', requireAdmin, async (req, res) => {
    const {
        envId,
        workerClientId,
        workerClientSecret,
        region
    } = req.query;

    if (!envId || !workerClientId || !workerClientSecret) {
        return res.status(400).json({
            error: 'missing_required_fields',
            message: 'envId, workerClientId, and workerClientSecret are required'
        });
    }

    try {
        const {
            PingOneProvisionService
        } = require('../services/pingoneProvisionService');
        const service = new PingOneProvisionService();

        await service.initialize(envId, workerClientId, workerClientSecret, region || 'com');

        // Check existing resources
        const existingResources = {
            resourceServer: await service.findResourceByName('resource', 'Super Banking API'),
            mcpResourceServer: await service.findResourceByName('resource', 'Super Banking MCP Server'),
            mcpGwResourceServer: await service.findResourceByName('resource', 'Super Banking MCP Gateway'),
            adminApp: await service.findResourceByName('application', 'Super Banking Admin App'),
            userApp: await service.findResourceByName('application', 'Super Banking User App'),
            mcpApp: await service.findResourceByName('application', 'Super Banking MCP Server'),
            workerApp: await service.findResourceByName('application', 'Super Banking Worker'),
            mcpExchangerApp: await service.findResourceByName('application', 'Super Banking MCP Exchanger'),
            mcpGwApp: await service.findResourceByName('application', 'Super Banking MCP Gateway'),
            agentApp: await service.findResourceByName('application', 'Super Banking Agent'),
            demoUser: await service.findUserByUsername('demoUser'),
            demoAdmin: await service.findUserByUsername('demoAdmin')
        };

        const status = {
            environment: {
                envId,
                region: region || 'com',
                populationId: service.populationId
            },
            existingResources,
            setupComplete: Object.values(existingResources).every(resource => resource !== null),
            canRun: true
        };

        res.json(status);

    } catch (err) {
        console.error('[setupWizard] Status check failed:', err.message);
        res.status(400).json({
            error: 'status_check_failed',
            message: 'Failed to check setup status',
            details: err.message
        });
    }
});

/**
 * GET /api/admin/setup/config-template
 * 
 * Get a template of required configuration fields
 */
router.get('/config-template', requireAdmin, async (req, res) => {
    const template = {
        required: {
            envId: {
                label: 'Environment ID',
                type: 'string',
                description: 'PingOne Environment ID',
                example: '12345678-1234-1234-1234-123456789012'
            },
            workerClientId: {
                label: 'Worker Client ID',
                type: 'string',
                description: 'Client ID of worker application with Management API access',
                example: 'worker-app-client-id'
            },
            workerClientSecret: {
                label: 'Worker Client Secret',
                type: 'password',
                description: 'Client secret of worker application',
                example: 'worker-app-client-secret'
            }
        },
        optional: {
            region: {
                label: 'Region',
                type: 'select',
                description: 'PingOne region',
                options: ['com', 'eu', 'ca', 'asia', 'com.au'],
                default: 'com'
            },
            publicAppUrl: {
                label: 'Public App URL',
                type: 'url',
                description: 'Public URL of your application',
                example: 'https://your-app.example.com',
                default: process.env.PUBLIC_APP_URL || 'https://api.ping.demo:4000'
            },
            audience: {
                label: 'Resource Server Audience',
                type: 'string',
                description: 'Audience for the resource server',
                example: 'enduser.ping.demo',
                default: 'enduser.ping.demo'
            }
        }
    };

    res.json(template);
});

/**
 * POST /api/admin/setup/wipe-environment
 *
 * NUCLEAR OPTION: deletes every app, resource server, group, custom user
 * attribute, and user in the PingOne environment. Streams progress via SSE.
 *
 * Required body:
 *   envId, workerClientId, workerClientSecret, region — same as /run
 *   confirmEnvId — must EXACTLY match envId. Type-the-env-id confirmation
 *                  prevents one-click accidents AND wrong-tenant disasters.
 *
 * Worker app being used to authenticate is preserved (deleting it mid-run
 * would invalidate our token). System-default resources (PingOne API, openid)
 * are also preserved — PingOne refuses to delete them anyway.
 */
router.post('/wipe-environment', requireAdmin, async (req, res) => {
    const { envId, workerClientId, workerClientSecret, region, confirmEnvId } = req.body;

    if (!envId || !workerClientId || !workerClientSecret) {
        return res.status(400).json({
            error: 'missing_required_fields',
            message: 'envId, workerClientId, and workerClientSecret are required',
        });
    }
    if (!confirmEnvId || confirmEnvId !== envId) {
        return res.status(400).json({
            error: 'confirmation_mismatch',
            message: 'confirmEnvId must EXACTLY match envId. Type the environment ID to confirm.',
        });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ step: 'connected', icon: '🔗', message: 'Connected to wipe stream' })}\n\n`);

    const onStep = (step) => {
        try { res.write(`data: ${JSON.stringify(step)}\n\n`); }
        catch (err) { console.error('[wipe] write failed:', err.message); }
    };

    try {
        console.warn(`[wipe] WIPE STARTED for env ${envId} by admin ${req.user?.username}`);
        const summary = await wipeEnvironment({ envId, workerClientId, workerClientSecret, region: region || 'com' }, onStep);
        onStep({ step: 'complete', icon: '🎉', message: 'Wipe complete', summary });
        console.warn(`[wipe] WIPE COMPLETE for env ${envId}: ${JSON.stringify(summary.deleted)}`);
    } catch (err) {
        console.error('[wipe] failed:', err.message);
        onStep({ step: 'error', icon: '❌', message: `Wipe failed: ${err.message}`, error: err.message });
    }

    try { res.write('data: [DONE]\n\n'); res.end(); } catch (_) {}
});

/**
 * POST /api/admin/setup/run-tests
 *
 * Streams Jest test output via SSE. Requires admin session.
 * suite: 'bff:unit' | 'bff:auth' | 'bff:all' | 'ui:unit'
 */
router.post('/run-tests', (req, res) => {
    const { suite = 'bff:unit' } = req.body;
    const suiteConfig = TEST_SUITES[suite];
    if (!suiteConfig) {
        return res.status(400).json({
            ok: false,
            error: 'unknown_suite',
            known: Object.keys(TEST_SUITES),
        });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const send = (data) => {
        try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
    };

    send({ type: 'start', suite, label: suiteConfig.label });

    const child = spawn(suiteConfig.cmd, suiteConfig.args, {
        cwd: suiteConfig.cwd,
        env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
        shell: true,
    });

    child.stdout.on('data', (chunk) => send({ type: 'stdout', text: chunk.toString() }));
    child.stderr.on('data', (chunk) => send({ type: 'stderr', text: chunk.toString() }));

    child.on('close', (code) => {
        send({ type: 'done', exitCode: code });
        try { res.write('data: [DONE]\n\n'); res.end(); } catch (_) {}
    });

    child.on('error', (err) => {
        send({ type: 'error', message: err.message });
        try { res.write('data: [DONE]\n\n'); res.end(); } catch (_) {}
    });

    req.on('close', () => child.kill());
});

/**
 * Error handling middleware
 */
router.use((error, req, res, next) => {
    console.error('[setupWizard] Route error:', error);

    if (!res.headersSent) {
        res.status(500).json({
            error: 'internal_server_error',
            message: 'An internal error occurred',
            ...(process.env.NODE_ENV === 'development' && {
                stack: error.stack
            })
        });
    }
});

module.exports = router;