#!/usr/bin/env node

/**
 * Resource Server Setup Script
 * 
 * Automated setup script for creating PingOne resource servers and scopes
 * using the Management API for streamlined deployment.
 */

'use strict';

const { managementService } = require('../services/pingoneManagementService');

// Command line arguments
const args = process.argv.slice(2);
const command = args[0];
const configType = args[1];

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Resource Server Setup Script

Usage: node setupResourceServers.js <command> [config-type]

Commands:
  validate               - Validate Management API connection
  setup <config-type>    - Setup resource server with predefined configuration
  list                   - List existing resource servers
  help                   - Show this help message

Config Types:
  mcp-server             - MCP server resource setup
  two-exchange           - 2-exchange delegation resource setup
  all                    - Setup all predefined configurations

Examples:
  node setupResourceServers.js validate
  node setupResourceServers.js setup mcp-server
  node setupResourceServers.js setup two-exchange
  node setupResourceServers.js list
`);
}

/**
 * Validate Management API connection
 */
async function validateConnection() {
  console.log('🔍 Validating Management API connection...');
  
  try {
    managementService.initialize();
    const result = await managementService.validateConnection();
    
    if (result.success) {
      console.log('✅ Management API connection successful!');
      console.log(`📋 Environment: ${result.environment.name}`);
      console.log(`🆔 Environment ID: ${result.environment.id}`);
      console.log(`🌐 Region: ${result.environment.region}`);
    } else {
      console.error('❌ Management API connection failed:');
      console.error(`   ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Failed to validate connection:');
    console.error(`   ${error.message}`);
    console.log('\n💡 Make sure PINGONE_MANAGEMENT_API_TOKEN and PINGONE_ENVIRONMENT_ID are set');
    process.exit(1);
  }
}

/**
 * Setup resource server with predefined configuration
 */
async function setupResourceServer(configType) {
  console.log(`🚀 Setting up resource server: ${configType}`);
  
  try {
    managementService.initialize();
    
    const configs = managementService.getPredefinedConfigurations();
    const config = configs[configType];
    
    if (!config) {
      console.error(`❌ Unknown configuration type: ${configType}`);
      console.log('\nAvailable configurations:');
      Object.keys(configs).forEach(key => {
        console.log(`  - ${key}`);
      });
      process.exit(1);
    }
    
    console.log(`📋 Configuration: ${config.name}`);
    console.log(`🌐 Audience URI: ${config.audienceUri}`);
    console.log(`📝 Scopes: ${config.scopes.length} scopes`);
    console.log(`🔗 Applications: ${config.applications.length} applications`);
    console.log('');
    
    // Perform setup
    const result = await managementService.setupCompleteResourceServer(config);
    
    if (result.success) {
      console.log('✅ Resource server setup completed successfully!');
      console.log('');
      console.log('📋 Created Resources:');
      
      // Resource Server Info
      if (result.resourceServer) {
        console.log(`  🏗️  Resource Server: ${result.resourceServer.name}`);
        console.log(`     ID: ${result.resourceServer.id}`);
        console.log(`     Audience: ${result.resourceServer.audience.join(', ')}`);
      }
      
      // Scopes Info
      const createdScopes = result.scopes.filter(s => s.success);
      if (createdScopes.length > 0) {
        console.log(`  🎯 Scopes: ${createdScopes.length} created`);
        createdScopes.forEach(scope => {
          console.log(`     - ${scope.scope.name}: ${scope.scope.description}`);
        });
      }
      
      // Applications Info
      const createdApps = result.applications.filter(a => a.success);
      if (createdApps.length > 0) {
        console.log(`  🔗 Applications: ${createdApps.length} created`);
        createdApps.forEach(app => {
          console.log(`     - ${app.application.name}: ${app.application.clientId}`);
        });
      }
      
      console.log('');
      console.log('🎉 Setup completed! You can now use these resources in your application.');
      
      // Show next steps
      console.log('');
      console.log('📝 Next Steps:');
      console.log('1. Update your .env file with the new application credentials');
      console.log('2. Configure your application to use the new resource server');
      console.log('3. Test the token exchange flow');
      
    } else {
      console.error('❌ Resource server setup failed:');
      result.errors.forEach(error => {
        console.error(`   ${error}`);
      });
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Setup failed:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

/**
 * List existing resource servers
 */
async function listResourceServers() {
  console.log('📋 Listing existing resource servers...');
  
  try {
    managementService.initialize();
    const result = await managementService.getResourceServers();
    
    if (result.success) {
      const servers = result.resourceServers;
      
      if (servers.length === 0) {
        console.log('📭 No resource servers found');
        return;
      }
      
      console.log(`📊 Found ${servers.length} resource servers:\n`);
      
      servers.forEach((server, index) => {
        console.log(`${index + 1}. ${server.name}`);
        console.log(`   ID: ${server.id}`);
        console.log(`   Audience: ${server.audience.join(', ')}`);
        console.log(`   Description: ${server.description || 'No description'}`);
        console.log(`   Created: ${new Date(server.createdAt).toLocaleString()}`);
        console.log('');
      });
      
    } else {
      console.error('❌ Failed to list resource servers:');
      console.error(`   ${result.error}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Failed to list resource servers:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

/**
 * Setup all predefined configurations
 */
async function setupAll() {
  console.log('🚀 Setting up all predefined resource server configurations...\n');
  
  const configs = managementService.getPredefinedConfigurations();
  const configNames = Object.keys(configs);
  
  for (const configName of configNames) {
    console.log(`\n--- Setting up ${configName} ---`);
    await setupResourceServer(configName);
  }
  
  console.log('\n🎉 All configurations completed!');
}

/**
 * Main execution function
 */
async function main() {
  if (!command || command === 'help') {
    printUsage();
    return;
  }
  
  switch (command) {
    case 'validate':
      await validateConnection();
      break;
      
    case 'setup':
      if (!configType) {
        console.error('❌ Configuration type required for setup command');
        printUsage();
        process.exit(1);
      }
      
      if (configType === 'all') {
        await setupAll();
      } else {
        await setupResourceServer(configType);
      }
      break;
      
    case 'list':
      await listResourceServers();
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// Execute main function
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Unexpected error:');
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  validateConnection,
  setupResourceServer,
  listResourceServers,
  setupAll
};
