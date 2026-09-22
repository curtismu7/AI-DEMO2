#!/usr/bin/env node
'use strict';

// Adds a PingOne user to a group using the user-centric memberOfGroups endpoint.
// The group-centric /groups/{id}/members endpoint is rejected for the demo
// worker app (403 with a misleading JWT-parse error), so scripts must use this
// shape. Never prints a secret.
const axios = require('axios');
const { loadDemoEnv } = require('./loadDemoEnv');

loadDemoEnv();

(async () => {
  const [userId, groupId] = process.argv.slice(2);
  if (!userId || !groupId) {
    console.error('usage: addUserToGroup.js <userId> <groupId>');
    process.exit(1);
  }
  const envId = process.env.PINGONE_ENVIRONMENT_ID;
  const clientId = process.env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = process.env.PINGONE_WORKER_CLIENT_SECRET;
  if (!envId || !clientId || !clientSecret) {
    console.error('missing PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID / PINGONE_WORKER_CLIENT_SECRET');
    process.exit(1);
  }
  const token = (await axios.post(
    `https://auth.pingone.com/${envId}/as/token`,
    'grant_type=client_credentials',
    { auth: { username: clientId, password: clientSecret } },
  )).data.access_token;
  await axios.post(
    `https://api.pingone.com/v1/environments/${envId}/users/${encodeURIComponent(userId)}/memberOfGroups`,
    { id: groupId },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  console.log(`added ${userId} to ${groupId}`);
})().catch((err) => {
  console.error(err.response ? `${err.response.status} ${JSON.stringify(err.response.data).slice(0, 200)}` : err.message);
  process.exit(1);
});
