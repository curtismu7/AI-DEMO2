#!/usr/bin/env node
/**
 * verify-act-claims.js
 * 
 * Utility to verify if PingOne is issuing act claims in tokens.
 * Tests token exchange flow and inspects the returned token for delegation claims.
 * 
 * Usage:
 *   node scripts/verify-act-claims.js
 * 
 * Prerequisites:
 *   - Valid session with access token in req.session.oauthTokens
 *   - MCP_RESOURCE_URI configured
 *   - Token exchange grant enabled in PingOne
 */

// loadDemoEnv rather than raw dotenv: a bare config() is CWD-relative, and
// post-dotenvx-cutover returns `encrypted:...` ciphertext even when it finds .env.
require('./loadDemoEnv').loadDemoEnv();
const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');

/**
 * Decode JWT without verification (for inspection only)
 */
function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, claims };
  } catch (e) {
    return null;
  }
}

/**
 * Mock request object with session token
 */
function createMockRequest(accessToken) {
  return {
    session: {
      oauthTokens: {
        accessToken,
        tokenType: 'Bearer'
      }
    }
  };
}

async function verifyActClaims() {
  console.log('\n=== PingOne act Claim Verification ===\n');

  // Check environment configuration
  const mcpResourceUri = process.env.PINGONE_RESOURCE_MCP_SERVER_URI;
  const useActor = process.env.USE_AGENT_ACTOR_FOR_MCP === 'true';

  console.log('Configuration:');
  console.log(`  PINGONE_RESOURCE_MCP_SERVER_URI: ${mcpResourceUri || '(not set - exchange will be skipped)'}`);
  console.log(`  USE_AGENT_ACTOR_FOR_MCP: ${useActor}`);
  // Same alias chain configStore uses for pingone_token_exchanger_client_id
  // (services/configStore.js ~1180). This line previously read only the
  // PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID / AGENT_OAUTH_CLIENT_ID pair and so
  // printed "(not set)" on a correctly configured system — docs/ENV.md declares
  // PINGONE_TOKEN_EXCHANGER_CLIENT_ID canonical and that is the name .env
  // actually carries. A diagnostic that reports working config as missing is
  // worse than no diagnostic: it sends you looking for the wrong thing.
  const exchangerClientId = process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID
    || process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID
    || process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID
    || process.env.AGENT_OAUTH_CLIENT_ID;
  console.log(`  Token exchanger client id: ${exchangerClientId || '(not set)'}\n`);

  if (!mcpResourceUri) {
    console.log('⚠️  PINGONE_RESOURCE_MCP_SERVER_URI not configured. Token exchange will be skipped.');
    console.log('   Set PINGONE_RESOURCE_MCP_SERVER_URI to the Super Banking MCP Server audience to enable delegation token exchange.\n');
    return;
  }

  // You need to provide a valid access token from a real session
  console.log('⚠️  This script requires a valid user access token.');
  console.log('   To obtain one:');
  console.log('   1. Start the stack and sign in via the browser');
  console.log('   2. npm run token:extract    (writes .env.test-tokens)');
  console.log('   3. Re-run this script — the token is picked up automatically\n');
  console.log('   Or pass one directly: ACCESS_TOKEN=eyJhbG... node scripts/verify-act-claims.js\n');

  // INTEGRATION_SUBJECT_ACCESS_TOKEN is the name the rest of the repo uses —
  // it is what scripts/extract-browser-token.js writes and what jest's
  // globalSetup reads. Accepting only ACCESS_TOKEN meant this script demanded a
  // login even when a freshly extracted token was already on disk.
  const userToken = process.env.ACCESS_TOKEN
    || process.env.INTEGRATION_SUBJECT_ACCESS_TOKEN
    || require('./loadDemoEnv').readTestToken();
  if (!userToken) {
    console.log('❌ No user access token — checked ACCESS_TOKEN, INTEGRATION_SUBJECT_ACCESS_TOKEN, and .env.test-tokens.\n');
    process.exit(1);
  }

  console.log('User token:');
  const t1Decoded = decodeJwt(userToken);
  if (!t1Decoded) {
    console.log('❌ Failed to decode user token. Invalid JWT format.\n');
    process.exit(1);
  }

  console.log(`  sub: ${t1Decoded.claims.sub}`);
  console.log(`  aud: ${t1Decoded.claims.aud}`);
  console.log(`  scope: ${t1Decoded.claims.scope}`);
  console.log(`  exp: ${new Date(t1Decoded.claims.exp * 1000).toISOString()}`);
  console.log('');

  // Perform token exchange
  console.log('Performing token exchange...');
  const mockReq = createMockRequest(userToken);
  
  try {
    const result = await resolveMcpAccessTokenWithEvents(mockReq, 'get_my_accounts');
    
    console.log('\nToken Exchange Result:');
    console.log(`  Status: ${result.token ? '✅ Success' : '❌ Failed'}`);
    console.log(`  Token Events: ${result.tokenEvents.length} events\n`);

    // Display token events
    result.tokenEvents.forEach((event, idx) => {
      console.log(`Event ${idx + 1}: ${event.label} (${event.status})`);
      console.log(`  ${event.explanation}`);
      if (event.actPresent !== undefined) {
        console.log(`  act present: ${event.actPresent}`);
        if (event.actDetails) {
          console.log(`  act details: ${event.actDetails}`);
        }
      }
      console.log('');
    });

    if (result.token) {
      console.log('Exchanged Token (T2):');
      const t2Decoded = decodeJwt(result.token);
      if (t2Decoded) {
        console.log(`  sub: ${t2Decoded.claims.sub}`);
        console.log(`  aud: ${t2Decoded.claims.aud}`);
        console.log(`  scope: ${t2Decoded.claims.scope}`);
        
        if (t2Decoded.claims.act) {
          console.log(`  ✅ act: ${JSON.stringify(t2Decoded.claims.act, null, 2)}`);
          console.log('\n🎉 SUCCESS: PingOne is issuing act claims!');
          console.log('   Delegation chain is functional.');
        } else {
          console.log(`  ❌ act: (not present)`);
          console.log('\n⚠️  WARNING: Token exchange succeeded but act claim is missing.');
          console.log('   PingOne policy may need configuration to include act claim.');
          console.log('   See: https://docs.pingidentity.com/r/en-us/pingone/p1_t_configure_token_exchange');
        }
      }
    } else {
      console.log('\n❌ Token exchange failed. Check token events above for details.');
    }

  } catch (err) {
    console.log(`\n❌ Error during token exchange: ${err.message}`);
    console.log(err.stack);
  }

  console.log('\n=== Verification Complete ===\n');
}

// Run verification
verifyActClaims().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
