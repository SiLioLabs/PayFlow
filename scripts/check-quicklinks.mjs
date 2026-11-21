#!/usr/bin/env node
/**
 * check-quicklinks.mjs
 * Validates that common "quicklinks" and reference shortcuts are valid.
 * Checks for patterns like:
 * - [API Reference](docs/API.md)
 * - [Testing](docs/TESTING.md)
 * - [Architecture](docs/ARCHITECTURE.md)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errorCount = 0;

// Known documentation files that should exist
const expectedDocFiles = [
  'docs/API.md',
  'docs/ARCHITECTURE.md',
  'docs/DEPENDENCIES.md',
  'docs/DEPLOYMENT.md',
  'docs/TESTING.md',
  'docs/STRUCTURE.md',
  'docs/SECURITY.md',
  'docs/ERROR-CODES.md',
  'docs/EVENTS.md',
  'CONTRIBUTING.md',
  'README.md'
];

// Validate that all expected doc files exist
function validateDocFilesExist() {
  console.log('📚 Checking core documentation files...\n');
  
  for (const docFile of expectedDocFiles) {
    const filePath = path.join(rootDir, docFile);
    
    if (!fs.existsSync(filePath)) {
      console.error(`  ❌ Missing expected documentation: ${docFile}`);
      errorCount++;
    } else {
      console.log(`  ✓ ${docFile}`);
    }
  }
}

// Check for broken references in common quicklink patterns
function validateQuickLinks() {
  console.log('\n🔗 Checking common quicklink references...\n');
  
  const quickLinkPatterns = [
    { pattern: /\[.*?\]\((docs\/API\.md.*?)\)/, name: 'API.md' },
    { pattern: /\[.*?\]\((docs\/ARCHITECTURE\.md.*?)\)/, name: 'ARCHITECTURE.md' },
    { pattern: /\[.*?\]\((docs\/TESTING\.md.*?)\)/, name: 'TESTING.md' },
    { pattern: /\[.*?\]\((docs\/DEPLOYMENT\.md.*?)\)/, name: 'DEPLOYMENT.md' },
    { pattern: /\[.*?\]\((CONTRIBUTING\.md.*?)\)/, name: 'CONTRIBUTING.md' },
    { pattern: /\[.*?\]\((README\.md.*?)\)/, name: 'README.md' }
  ];
  
  function checkFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        for (const { pattern, name } of quickLinkPatterns) {
          const match = line.match(pattern);
          if (match) {
            const linkPath = match[1].split('#')[0]; // Remove anchor
            const targetPath = path.resolve(path.dirname(filePath), linkPath);
            
            if (!fs.existsSync(targetPath)) {
              console.error(
                `  ❌ Broken quicklink in ${path.relative(rootDir, filePath)}:${index + 1}\n` +
                `     Expected file: ${linkPath}`
              );
              errorCount++;
            }
          }
        }
      });
    } catch (err) {
      // Silently skip non-readable files
    }
  }
  
  // Check all markdown files
  function walkDir(dir) {
    try {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          if (!file.startsWith('.') && file !== 'node_modules') {
            walkDir(filePath);
          }
        } else if (file.endsWith('.md')) {
          checkFile(filePath);
        }
      }
    } catch (err) {
      // Silently skip errors
    }
  }
  
  walkDir(rootDir);
}

// Main execution
console.log('🔍 Validating documentation quicklinks...\n');

validateDocFilesExist();
validateQuickLinks();

if (errorCount === 0) {
  console.log('\n✅ All documentation quicklinks are valid!\n');
  process.exit(0);
} else {
  console.log(`\n❌ Found ${errorCount} quicklink issue(s). Please fix them before merging.\n`);
  process.exit(1);
}
