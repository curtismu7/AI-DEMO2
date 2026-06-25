#!/usr/bin/env node
/**
 * Health Check Script
 * Checks if the Banking MCP Server is running and healthy
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_HOST = process.env.MCP_SERVER_HOST || 'localhost';
const DEFAULT_PORT = process.env.MCP_SERVER_PORT || '8080';
const HEALTH_ENDPOINT = process.env.HEALTH_ENDPOINT || '/health';
const TIMEOUT = parseInt(process.env.HEALTH_CHECK_TIMEOUT || '5000');

function performHealthCheck(url, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'GET',
      timeout: timeout,
      headers: {
        'User-Agent': 'Banking-MCP-Server-Health-Check/1.0'
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const result = {
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          timestamp: new Date().toISOString()
        };
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(result);
        } else {
          reject(new Error(`Health check failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Health check request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Health check timed out after ${timeout}ms`));
    });

    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const host = args[0] || DEFAULT_HOST;
  const port = args[1] || DEFAULT_PORT;
  const endpoint = args[2] || HEALTH_ENDPOINT;
  
  const url = `http://${host}:${port}${endpoint}`;
  
  console.log(`Performing health check on: ${url}`);
  console.log(`Timeout: ${TIMEOUT}ms`);
  
  try {
    const result = await performHealthCheck(url);
    
    console.log('✅ Health check passed');
    console.log(`Status: ${result.statusCode}`);
    console.log(`Timestamp: ${result.timestamp}`);
    
    if (result.body) {
      try {
        const healthData = JSON.parse(result.body);
        console.log('Health data:', JSON.stringify(healthData, null, 2));
      } catch (e) {
        console.log('Response body:', result.body);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Health check failed');
    console.error(`Error: ${error.message}`);
    
    // Additional debugging information
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = { performHealthCheck };