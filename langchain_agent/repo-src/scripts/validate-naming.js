#!/usr/bin/env node

/**
 * validate-naming.js
 * 
 * Simple validation script for PingOne naming consistency
 * Checks for remaining "Ping Identity" references in the codebase
 */

const fs = require('fs');
const path = require('path');

// Inconsistent patterns to validate against
const inconsistentPatterns = [
  /Ping Identity/g,
  /pingid/g,
  /PingID/g,
  /PingOne Directory(?! Services)/g,
  /Ping Identity API/g
];

// File patterns to validate
const fileExtensions = ['.js', '.jsx', '.md', '.json', '.env.example'];
const excludeDirs = ['node_modules', '.git', 'build', 'dist', '.planning'];

/**
 * Find all files to validate
 */
function findFiles(dir, extensions, exclude) {
  const files = [];
  
  function traverse(currentDir) {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory() && !exclude.includes(item)) {
        traverse(fullPath);
      } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }
  
  traverse(dir);
  return files;
}

/**
 * Validate a single file for inconsistent naming
 */
function validateFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const issues = [];
  
  for (const pattern of inconsistentPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      issues.push({
        pattern: pattern.toString(),
        occurrences: matches.length,
        samples: matches.slice(0, 3) // Show first 3 occurrences
      });
    }
  }
  
  return issues;
}

/**
 * Validate all files in the project
 */
function validateProject() {
  const files = findFiles(process.cwd(), fileExtensions, excludeDirs);
  const issues = {};
  let totalIssues = 0;
  
  for (const file of files) {
    const fileIssues = validateFile(file);
    if (fileIssues.length > 0) {
      issues[file] = fileIssues;
      totalIssues += fileIssues.reduce((sum, issue) => sum + issue.occurrences, 0);
    }
  }
  
  return { issues, totalIssues, files };
}

// Main execution
function main() {
  console.log('🔍 Validating PingOne naming consistency...\n');
  
  const result = validateProject();
  
  console.log(`📁 Files scanned: ${result.files.length}`);
  console.log(`❌ Issues found: ${result.totalIssues}`);
  console.log(`📄 Files with issues: ${Object.keys(result.issues).length}\n`);
  
  if (Object.keys(result.issues).length > 0) {
    console.log('🚨 Naming inconsistencies found:\n');
    
    Object.entries(result.issues).forEach(([file, issues]) => {
      console.log(`📄 ${file}:`);
      issues.forEach(issue => {
        console.log(`  ❌ ${issue.pattern}: ${issue.occurrences} occurrences`);
        console.log(`     Samples: ${issue.samples.join(', ')}`);
      });
      console.log('');
    });
    
    console.log('❌ Validation failed - please fix the above issues');
    process.exit(1);
  } else {
    console.log('✅ No naming inconsistencies found!');
    console.log('🎉 PingOne naming standardization is complete!');
    process.exit(0);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateProject, validateFile, findFiles };
