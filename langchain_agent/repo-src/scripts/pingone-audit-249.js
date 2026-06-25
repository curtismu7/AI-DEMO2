#!/usr/bin/env node
'use strict';

const https = require('https');

const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID;
// PingOne TLD differs by region (com=NA, eu, ca, asia, com.au). Operators outside
// NA must set PINGONE_REGION or this audit hits the wrong tenant host. Matches the
// PINGONE_REGION convention used in config/oauth.js and demo_authz_server.
const REGION = process.env.PINGONE_REGION || 'com';
const CLIENT_ID = process.env.PINGONE_WORKER_TOKEN_CLIENT_ID;
const CLIENT_SECRET = process.env.PINGONE_WORKER_TOKEN_CLIENT_SECRET;

function request(url, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  var TOKEN_URL = 'https://auth.pingone.' + REGION + '/' + ENV_ID + '/as/token';
  var API_BASE = 'https://api.pingone.' + REGION + '/v1/environments/' + ENV_ID;
  var creds = Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');

  var tr = await request(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + creds
    },
    body: 'grant_type=client_credentials'
  });
  if (tr.status !== 200) {
    throw new Error('Token error ' + tr.status + ': ' + JSON.stringify(tr.body));
  }
  var token = tr.body.access_token;
  var authHdr = { Authorization: 'Bearer ' + token };

  // ── Fetch all resources and build scope ID → name map ──────────────────
  var resData = await request(API_BASE + '/resources?limit=100', { headers: authHdr });
  var resources = (resData.body._embedded && resData.body._embedded.resources) || resData.body.resources || [];

  var scopeMap = {};    // scope ID → {name, resourceName, audience}
  var resourceMap = {}; // resource ID → display label

  for (var res of resources) {
    resourceMap[res.id] = res.name + ' [' + (res.audience || res.type) + ']';
    var sd = await request(API_BASE + '/resources/' + res.id + '/scopes?limit=100', { headers: authHdr });
    var scopes = (sd.body._embedded && sd.body._embedded.scopes) || sd.body.scopes || [];
    for (var s of scopes) {
      scopeMap[s.id] = { name: s.name, resource: res.name, audience: res.audience };
    }
  }

  // ── Per-app grant matrix ────────────────────────────────────────────────
  var TARGET_APPS = [
    { id: '14cefa5b-d9d6-4e51-8749-e938d4edd1c0', label: 'Admin App (Auth Code)' },
    { id: 'b2752071-2d03-4927-b865-089dc40b9c85', label: 'User App (Auth Code)' },
    { id: '2533a614-fcb6-4ab9-82cc-9ab407f1dbda', label: 'AI Agent App (CC)' },
    { id: '6380065f-f328-41c2-81ed-1daeec811285', label: 'MCP Token Exchanger (CC)' },
    { id: '95dc946f-5e0a-4a8b-a8ba-b587b244e005', label: 'Worker Token (Management API)' },
  ];

  console.log('');
  console.log('='.repeat(70));
  console.log('SCOPE-RESOLVED GRANT MATRIX');
  console.log('='.repeat(70));

  for (var app of TARGET_APPS) {
    var gd = await request(API_BASE + '/applications/' + app.id + '/grants', { headers: authHdr });
    var grants = (gd.body._embedded && gd.body._embedded.grants) || gd.body.grants || [];
    console.log('\n## ' + app.label + ' (' + app.id + ')');
    if (!grants.length) {
      console.log('   (no resource grants)');
      continue;
    }
    for (var g of grants) {
      var resId = (g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id) || '?';
      console.log('  Resource: ' + (resourceMap[resId] || resId));
      var scopeNames = (g.scopes || []).map(function(s) {
        return (scopeMap[s.id] && scopeMap[s.id].name) || s.id;
      }).join(', ');
      console.log('  Scopes:   ' + (scopeNames || '(none)'));
    }
  }

  // ── Gap analysis ────────────────────────────────────────────────────────
  console.log('\n');
  console.log('='.repeat(70));
  console.log('GAP ANALYSIS — What PingOne needs to be fixed');
  console.log('='.repeat(70));

  function getAudienceForResourceId(rid) {
    var r = resources.find(function(x) { return x.id === rid; });
    return r ? r.audience : null;
  }

  // Helper to get grants for an app
  async function getGrants(appId) {
    var d = await request(API_BASE + '/applications/' + appId + '/grants', { headers: authHdr });
    return (d.body._embedded && d.body._embedded.grants) || d.body.grants || [];
  }

  // Check MCP Exchanger
  var excGrants = await getGrants('6380065f-f328-41c2-81ed-1daeec811285');
  var excAuds = excGrants.map(function(g) {
    return getAudienceForResourceId((g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id));
  });
  var excScopesByAud = {};
  for (var g of excGrants) {
    var rid = (g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id);
    var aud = getAudienceForResourceId(rid) || rid;
    excScopesByAud[aud] = (g.scopes || []).map(function(s) {
      return (scopeMap[s.id] && scopeMap[s.id].name) || s.id;
    });
  }

  console.log('\n1. MCP Token Exchanger (6380065f) — resource grants:');
  var needsMcpGw = !excAuds.includes('https://mcp-gateway.pingdemo.com');
  var hasMcpServer = excAuds.includes('mcpserver.ping.demo');
  console.log('   mcp-gateway.pingdemo.com: ' + (needsMcpGw ? '❌ MISSING — needs mcp:invoke read write' : '✓ ' + excScopesByAud['https://mcp-gateway.pingdemo.com'].join(' ')));
  console.log('   mcpserver.ping.demo:  ' + (hasMcpServer ? '✓ ' + excScopesByAud['mcpserver.ping.demo'].join(' ') : '❌ MISSING — needs read write'));

  // Check AI Agent App
  var agentGrants = await getGrants('2533a614-fcb6-4ab9-82cc-9ab407f1dbda');
  var agentAuds = agentGrants.map(function(g) {
    return getAudienceForResourceId((g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id));
  });
  var agentScopesByAud = {};
  for (var g of agentGrants) {
    var rid = (g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id);
    var aud = getAudienceForResourceId(rid) || rid;
    agentScopesByAud[aud] = (g.scopes || []).map(function(s) {
      return (scopeMap[s.id] && scopeMap[s.id].name) || s.id;
    });
  }
  console.log('\n2. AI Agent App (2533a614) — resource grants:');
  console.log('   agentgateway.ping.demo: ' + (agentAuds.includes('agentgateway.ping.demo') ? '✓ ' + (agentScopesByAud['agentgateway.ping.demo'] || []).join(' ') : '❌ MISSING — needs grant for CC actor token'));
  console.log('   agentgateway.ping.demo:      ' + (agentAuds.includes('agentgateway.ping.demo') ? '✓ ' + agentScopesByAud['agentgateway.ping.demo'].join(' ') : '❌ MISSING'));

  // Check User App scopes
  var userGrants = await getGrants('b2752071-2d03-4927-b865-089dc40b9c85');
  console.log('\n3. User App (b2752071) — resource grants:');
  for (var g of userGrants) {
    var rid = (g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id);
    var aud = getAudienceForResourceId(rid) || rid;
    var snames = (g.scopes || []).map(function(s) {
      return (scopeMap[s.id] && scopeMap[s.id].name) || s.id;
    });
    if (aud && !aud.includes('openid') && !aud.includes('null')) {
      console.log('   ' + aud + ': ' + snames.join(', '));
    }
  }
  var userHasAiAgent = userGrants.some(function(g) {
    var rid = (g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id);
    if (getAudienceForResourceId(rid) !== 'https://resource-server.pingdemo.com') return false;
    return (g.scopes || []).some(function(s) {
      return scopeMap[s.id] && scopeMap[s.id].name === 'ai:agent';
    });
  });
  console.log('   ai:agent on resource-server: ' + (userHasAiAgent ? '✓' : '❌ MISSING — user token needs this to get may_act delegation'));

  // Check Admin App grants
  var adminGrants = await getGrants('14cefa5b-d9d6-4e51-8749-e938d4edd1c0');
  console.log('\n4. Admin App (14cefa5b) — resource grants:');
  for (var g of adminGrants) {
    var rid = (g.resource && g.resource.id) || (g.resourceServer && g.resourceServer.id);
    var aud = getAudienceForResourceId(rid) || rid;
    var snames = (g.scopes || []).map(function(s) {
      return (scopeMap[s.id] && scopeMap[s.id].name) || s.id;
    });
    if (aud) console.log('   ' + aud + ': ' + snames.join(', '));
  }

  // Scope cleanliness on mcp-server (should NOT have mcp:invoke)
  var mcpServerRes = resources.find(function(r) { return r.audience === 'mcpserver.ping.demo'; });
  if (mcpServerRes) {
    var msd = await request(API_BASE + '/resources/' + mcpServerRes.id + '/scopes?limit=100', { headers: authHdr });
    var mscopes = (msd.body._embedded && msd.body._embedded.scopes) || msd.body.scopes || [];
    var mnames = mscopes.map(function(s) { return s.name; });
    console.log('\n5. mcpserver.ping.demo scopes: ' + mnames.join(', '));
    if (mnames.includes('mcp:invoke')) {
      console.log('   ⚠️  mcp:invoke is on mcp-server — should be mcp-gateway only');
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('DONE');
  console.log('='.repeat(70));
}

main().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
