/**
 * naming-validation.test.js
 * 
 * Comprehensive validation test for PingOne naming consistency
 * Ensures all "Ping Identity" references have been standardized to "PingOne"
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

describe('PingOne Naming Consistency Validation', () => {
  test('should not contain "Ping Identity" in source files', () => {
    const { issues, totalIssues } = validateProject();
    
    const pingIdentityIssues = Object.entries(issues)
      .filter(([file, fileIssues]) => 
        fileIssues.some(issue => issue.pattern.includes('Ping Identity'))
      );
    
    expect(pingIdentityIssues).toHaveLength(0);
    
    if (pingIdentityIssues.length > 0) {
      console.error('Ping Identity references found:');
      pingIdentityIssues.forEach(([file, fileIssues]) => {
        console.error(`  ${file}:`);
        fileIssues.forEach(issue => {
          if (issue.pattern.includes('Ping Identity')) {
            console.error(`    - ${issue.pattern}: ${issue.occurrences} occurrences`);
            console.error(`      Samples: ${issue.samples.join(', ')}`);
          }
        });
      });
    }
  });

  test('should not contain "pingid" in source files', () => {
    const { issues } = validateProject();
    
    const pingidIssues = Object.entries(issues)
      .filter(([file, fileIssues]) => 
        fileIssues.some(issue => issue.pattern.includes('pingid'))
      );
    
    expect(pingidIssues).toHaveLength(0);
  });

  test('should not contain "PingID" in source files', () => {
    const { issues } = validateProject();
    
    const pingIDIssues = Object.entries(issues)
      .filter(([file, fileIssues]) => 
        fileIssues.some(issue => issue.pattern.includes('PingID'))
      );
    
    expect(pingIDIssues).toHaveLength(0);
  });

  test('should use "PingOne Directory Services" consistently', () => {
    const { issues } = validateProject();
    
    const directoryIssues = Object.entries(issues)
      .filter(([file, fileIssues]) => 
        fileIssues.some(issue => issue.pattern.includes('PingOne Directory'))
      );
    
    expect(directoryIssues).toHaveLength(0);
  });

  test('should use "PingOne API" consistently', () => {
    const { issues } = validateProject();
    
    const apiIssues = Object.entries(issues)
      .filter(([file, fileIssues]) => 
        fileIssues.some(issue => issue.pattern.includes('Ping Identity API'))
      );
    
    expect(apiIssues).toHaveLength(0);
  });

  test('should have consistent PingOne terminology in authentication flows', () => {
    const authFiles = [
      'demo_api_server/routes/oauth.js',
      'demo_api_server/services/oauthService.js',
      'demo_api_ui/src/components/auth/LoginFlow.js',
      'demo_api_ui/src/services/authService.js'
    ];
    
    for (const file of authFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        
        // Should contain PingOne
        expect(content).toMatch(/PingOne/);
        
        // Should not contain Ping Identity
        expect(content).not.toMatch(/Ping Identity/);
      }
    }
  });

  test('should have consistent PingOne terminology in education components', () => {
    const educationDir = 'demo_api_ui/src/components/education';
    
    if (fs.existsSync(educationDir)) {
      const educationFiles = fs.readdirSync(educationDir)
        .filter(file => file.endsWith('.js'))
        .map(file => path.join(educationDir, file));
      
      for (const file of educationFiles) {
        const content = fs.readFileSync(file, 'utf8');
        
        // Should not contain Ping Identity
        expect(content).not.toMatch(/Ping Identity/);
      }
    }
  });

  test('should have consistent PingOne terminology in documentation', () => {
    const docFiles = [
      'README.md',
      'FEATURES.md',
      'docs/SETUP.md'
    ];
    
    for (const file of docFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        
        // Should not contain Ping Identity
        expect(content).not.toMatch(/Ping Identity/);
      }
    }
  });
});

// Export validation function for use in other scripts
module.exports = {
  validateProject,
  validateFile,
  findFiles
};
