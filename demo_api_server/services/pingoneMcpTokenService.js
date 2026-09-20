'use strict';

const axios = require('axios');

/**
 * Redeem a PingOne refresh token for the next hosted-MCP access token.
 * The built-in pingone-mcp-server client is public, so this request carries
 * client_id but no client secret.
 */
async function refreshAccessToken({ refreshToken, clientId, tokenEndpoint }) {
  if (!refreshToken || !clientId || !tokenEndpoint) {
    throw new Error('PingOne MCP refresh requires refreshToken, clientId, and tokenEndpoint');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const response = await axios.post(tokenEndpoint, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });
  const accessToken = response.data?.access_token;
  if (!accessToken) throw new Error('PingOne refresh response did not contain an access token');

  const expiresIn = Number(response.data.expires_in) > 0 ? Number(response.data.expires_in) : 3600;
  return {
    accessToken,
    // PingOne may rotate the refresh token. Retain the previous one only when
    // the provider explicitly omits a replacement.
    refreshToken: response.data.refresh_token || refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

module.exports = { refreshAccessToken };
