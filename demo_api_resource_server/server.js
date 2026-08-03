'use strict';

/**
 * banking_api_resource_server — Phase 266 Path A backend.
 *
 * A minimal API-key-gated service that returns dummy demo records per vertical.
 * The MCP gateway calls this service on the api_key disposition: it sends
 * `X-API-Key: <key>` (no OAuth bearer) and gets the record payload back.
 *
 * Auth model: shared secret in `API_RESOURCE_SERVER_API_KEY`. No JWT, no aud check.
 * This is intentionally the simplest possible service — the demo point is
 * "the gateway swapped the user's bearer for a service API key and called a
 * different backend."
 *
 * Port: 8082 (default; override with API_RESOURCE_SERVER_PORT)
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');

// Accept API_RESOURCE_SERVER_PORT=0 (ephemeral port); only fall back on a
// missing/non-integer value rather than any falsy value.
const parsedPort = Number(process.env.API_RESOURCE_SERVER_PORT);
const PORT = Number.isInteger(parsedPort) && parsedPort >= 0 ? parsedPort : 8082;
const HOST = process.env.API_RESOURCE_SERVER_HOST || '127.0.0.1';

// Never ship a usable committed default. Production requires an explicit env key;
// local/dev generates an ephemeral key for the process lifetime when unset.
const DEFAULT_MORTGAGE_KEY = 'demo-mortgage-key-0000';
const envKey = (process.env.API_RESOURCE_SERVER_API_KEY || '').trim();
if (envKey === DEFAULT_MORTGAGE_KEY || (process.env.NODE_ENV === 'production' && !envKey)) {
  console.error(
    '[demo-api-resource-server] FATAL: set API_RESOURCE_SERVER_API_KEY to a non-default secret. ' +
    'The committed demo default is rejected.'
  );
  process.exit(1);
}
const API_KEY = envKey || crypto.randomBytes(24).toString('hex');
if (!envKey) {
  console.warn(
    '[demo-api-resource-server] API_RESOURCE_SERVER_API_KEY unset — using ephemeral process key. ' +
    'Set API_RESOURCE_SERVER_API_KEY so the MCP gateway can call this service.'
  );
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Health — unauthenticated, used by run-demo.sh status checks. Returns no
// secret-derived material (the endpoint is public).
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'banking_api_resource_server',
    port: PORT,
  });
});

// Constant-time API-key compare. Hashing both inputs to a fixed-width digest
// before timingSafeEqual avoids leaking the secret's length and uses the
// stdlib primitive instead of a hand-rolled loop. The secret's digest is
// computed once at startup; only the presented key is hashed per request.
const API_KEY_DIGEST = crypto.createHash('sha256').update(API_KEY, 'utf8').digest();

function apiKeyMatches(presented) {
  const presentedDigest = crypto.createHash('sha256').update(presented, 'utf8').digest();
  return crypto.timingSafeEqual(presentedDigest, API_KEY_DIGEST);
}

// Middleware: X-API-Key gate.
function requireApiKey(req, res, next) {
  const presented = req.headers['x-api-key'];
  if (!presented || typeof presented !== 'string') {
    return res.status(401).json({ error: 'api_key_missing', message: 'X-API-Key header required' });
  }
  if (!apiKeyMatches(presented)) {
    return res.status(401).json({ error: 'api_key_invalid' });
  }
  next();
}

// Per-vertical demo records. Each entry maps a route to the record it returns
// (keyed by its top-level field) and the noun used in the teaching `note`.
const VERTICALS = {
  mortgage: {
    noun: 'data',
    record: {
      mortgage: {
        id: 'mtg-001',
        propertyAddress: '1234 Maple Street, Springfield, IL 62704',
        loanAmount: 425000.00,
        currentBalance: 387542.18,
        interestRate: 6.125,
        monthlyPayment: 2582.43,
        nextPaymentDate: '2026-06-01',
        term: '30-year fixed',
        originationDate: '2023-04-15',
        currency: 'USD',
      },
    },
  },
  retail: {
    noun: 'large purchase record',
    record: {
      largePurchase: {
        orderId: 'ORD-20260501-8821',
        product: 'Samsung 65" QLED TV',
        sku: 'BB-65QLED',
        category: 'TV',
        amount: 1299.00,
        currency: 'USD',
        status: 'Shipped',
        estimatedDelivery: '2026-06-03',
        rewardsPointsEarned: 1299,
        retailer: 'Great Buy',
      },
    },
  },
  healthcare: {
    noun: 'health record',
    record: {
      healthRecord: {
        recordId: 'REC-2026-04881',
        recordType: 'Annual Wellness Visit',
        provider: 'Dr. Sarah Mitchell, MD',
        facility: 'Springfield Family Health',
        visitDate: '2026-04-18',
        coveredAmount: 380.00,
        copay: 20.00,
        currency: 'USD',
        status: 'Processed',
        coveragePlan: 'BlueShield PPO Gold',
      },
    },
  },
  gear: {
    noun: 'gear order',
    record: {
      gearOrder: {
        orderId: 'SS-20260419-4471',
        item: 'Garmin Fenix 8 GPS Watch',
        category: 'Wearable',
        amount: 799.00,
        currency: 'USD',
        status: 'Delivered',
        deliveredDate: '2026-04-22',
        loyaltyPointsEarned: 1598,
        memberTier: 'Elite Member',
      },
    },
  },
  gearWarranty: {
    noun: 'gear warranty',
    record: {
      gearWarranty: {
        warrantyId: 'SS-WTY-20260419-4471',
        item: 'Garmin Fenix 8 GPS Watch',
        coverageTier: 'Elite Protect (3 year)',
        startDate: '2026-04-22',
        expiresDate: '2029-04-22',
        claimsUsed: 1,
        claimLimit: 3,
        status: 'Active',
      },
    },
  },
  expense: {
    noun: 'expense report',
    record: {
      expenseReport: {
        reportId: 'EXP-2026-00312',
        category: 'Travel & Accommodation',
        description: 'Q2 Sales Summit — Chicago, IL',
        amount: 1847.50,
        currency: 'USD',
        submittedDate: '2026-05-02',
        status: 'Approved',
        approver: 'Jordan Lee (Finance)',
        reimbursementDate: '2026-05-15',
      },
    },
  },
  invest: {
    noun: 'portfolio',
    record: {
      invest: {
        portfolioId: 'INV-8842',
        holder: 'Jordan A. Rivera',
        totalValue: 184320.55,
        cashSweep: 12580.10,
        ytdReturnPct: 11.4,
        riskProfile: 'Growth',
        holdings: [
          { symbol: 'VTI', name: 'Vanguard Total Market ETF', quantity: 220, marketValue: 62480.00 },
          { symbol: 'UST-10Y', name: 'US Treasury Note', quantity: null, marketValue: 60010.35 },
          { symbol: 'AAPL', name: 'Apple Inc.', quantity: 90, marketValue: 19260.00 },
          { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', quantity: 340, marketValue: 29990.10 },
        ],
      },
    },
  },
};

// Records migrated to their own vertical (config/verticals/<id>/feature-data.json)
// are emitted here by `node scripts/gen-feature-data.js generate`. Generated wins
// over the inline VERTICALS map above; absence is fine (the inline map is the
// fallback for verticals not yet migrated). Keyed by backend route segment.
const GENERATED_RECORDS = {};
try {
  const gen = require('./feature-records.generated.json');
  for (const [route, val] of Object.entries(gen)) {
    if (route !== '_generated') GENERATED_RECORDS[route] = val;
  }
} catch (_e) { /* no generated file — inline map only */ }

const ALL_RECORDS = { ...VERTICALS, ...GENERATED_RECORDS };

for (const [route, { noun, record }] of Object.entries(ALL_RECORDS)) {
  app.get(`/${route}`, requireApiKey, (_req, res) => {
    res.json({
      ...record,
      source: 'demo_data_service',
      authMechanism: 'X-API-Key (shared secret)',
      note: `This ${noun} was returned because the gateway presented a valid service API key. No OAuth bearer was involved on this hop.`,
    });
  });
}

// 404 for anything else.
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

if (require.main === module) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`[demo-api-resource-server] Ready on :${PORT}`);
  });

  // Graceful shutdown — drain in-flight requests before exit
  const shutdown = (signal) => {
    console.log(`[demo-api-resource-server] ${signal} received — shutting down`);
    server.close(() => {
      console.log('[demo-api-resource-server] HTTP server closed');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[demo-api-resource-server] Drain timeout — forcing exit');
      process.exit(1);
    }, 5000);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = app;
