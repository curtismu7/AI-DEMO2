'use strict';

const axios = require('axios');
const configStore = require('./configStore');

const DEFAULT_BASE_URL = 'https://authentication-service.eks.core-production.saas-us-east.keyless.technology';

function getConfig() {
  const apiKey = configStore.getEffective('RECOGNIZE_API_KEY');
  const tenantName = configStore.getEffective('RECOGNIZE_TENANT_NAME');
  const baseUrl = configStore.getEffective('RECOGNIZE_BASE_URL') || DEFAULT_BASE_URL;
  if (!apiKey) throw new Error('RECOGNIZE_API_KEY is not configured');
  if (!tenantName) throw new Error('RECOGNIZE_TENANT_NAME is not configured');
  return { apiKey, tenantName, baseUrl };
}

function headers(apiKey) {
  return { 'X-API-Key': apiKey, 'Content-Type': 'application/json' };
}

async function initiateSession(userId) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/sessions`;
  const { data } = await axios.post(url, { username: userId }, { headers: headers(apiKey) });
  return { sessionToken: data.sessionToken, sessionId: data.sessionId };
}

async function verifySession(sessionId, sdkResult) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/sessions/${sessionId}/verify`;
  const { data } = await axios.post(url, sdkResult || {}, { headers: headers(apiKey) });
  return data.status === 'ACCEPTED';
}

async function enrollUser(userId) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/enrollments`;
  await axios.post(url, { username: userId }, { headers: headers(apiKey) });
}

async function enrollFromImage(userId, imageBase64, scenario) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/enrollments`;
  await axios.post(
    url,
    { username: userId, image: imageBase64, scenario: scenario || 'TRUSTED_SOURCE' },
    { headers: headers(apiKey) },
  );
}

async function unenrollUser(userId) {
  const { apiKey, tenantName, baseUrl } = getConfig();
  const url = `${baseUrl}/v1/customers/${tenantName}/enrollments/${userId}`;
  await axios.delete(url, { headers: headers(apiKey) });
}

module.exports = { initiateSession, verifySession, enrollUser, enrollFromImage, unenrollUser };
