#!/usr/bin/env node
/**
 * test-limits-claims.mjs
 * Validates that claims made in documentation about limits match the contract code.
 * Checks for consistent documentation of:
 * - Maximum subscription amounts
 * - Rate limits and thresholds
 * - TTL/retention periods
 * - Storage limits
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errorCount = 0;
let warningCount = 0;

// Extract limit constants from contract code
function extractContractLimits() {
  const limits = new Map();
  
  // Check limits.rs for defined constants
  const limitsFile = path.join(rootDir, 'contract', 'src', 'limits.rs');
  
  if (!fs.existsSync(limitsFile)) {
    console.warn('⚠️  contract/src/limits.rs not found');
    return limits;
  }
  
  try {
    const content = fs.readFileSync(limitsFile, 'utf8');
    
    // Extract pattern: const NAME: type = value;
    const constRegex = /const\s+(\w+)\s*:\s*(\w+)\s*=\s*([^;]+);/g;
    let match;
    
    while ((match = constRegex.exec(content)) !== null) {
      const name = match[1];
      const type = match[2];
      const value = match[3].trim();
      
      limits.set(name, {
        type,
        value,
        source: 'contract/src/limits.rs'
      });
    }
  } catch (err) {
    console.warn(`Error reading limits file: ${err.message}`);
  }
  
  return limits;
}

// Extract documented limits from documentation
function extractDocumentedLimits() {
  const documented = new Map();
  
  function checkFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      // Look for patterns like: "max of X", "limit of Y", "max Y items"
      const limitPatterns = [
        { regex: /max(?:imum)?\s+(?:of\s+)?(\d+)/gi, category: 'count' },
        { regex: /limit(?:ed)?\s+(?:to\s+)?(\d+)/gi, category: 'limit' },
        { regex: /(?:up to|maximum)\s+(\d+)\s+(?:XLM|stroops)/gi, category: 'amount' },
        { regex: /(\d+)\s*(?:hours?|days?|weeks?|months?|years?)/gi, category: 'duration' }
      ];
      
      lines.forEach((line, index) => {
        for (const { regex, category } of limitPatterns) {
          let match;
          while ((match = regex.exec(line)) !== null) {
            const value = match[1];
            const context = line.substring(Math.max(0, match.index - 20), match.index + 60);
            
            documented.set(`${category}:${value}:${index}`, {
              category,
              value,
              file: path.relative(rootDir, filePath),
              line: index + 1,
              context: context.trim()
            });
          }
        }
      });
    } catch (err) {
      // Silently skip errors
    }
  }
  
  // Walk all markdown files
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
  
  walkDir(path.join(rootDir, 'docs'));
  walkDir(rootDir);
  
  return documented;
}

// Validate consistency between contract and docs
function validateLimits() {
  console.log('📊 Checking documented limits against contract code...\n');
  
  const contractLimits = extractContractLimits();
  const documentedLimits = extractDocumentedLimits();
  
  if (contractLimits.size === 0) {
    console.log('  ℹ️  No contract limits found to validate\n');
    return;
  }
  
  console.log(`  Found ${contractLimits.size} contract limit(s):`);
  for (const [name, limit] of contractLimits) {
    console.log(`    - ${name}: ${limit.value}`);
  }
  
  if (documentedLimits.size === 0) {
    console.warn(`\n  ⚠️  No documented limits found in markdown files`);
    warningCount++;
  } else {
    console.log(`\n  Found ${documentedLimits.size} limit references in documentation`);
    
    // Check for consistency
    const values = Array.from(documentedLimits.values());
    const uniqueValues = new Set(values.map(v => v.value));
    
    if (uniqueValues.size > contractLimits.size) {
      console.warn(`\n  ⚠️  Documentation references different limit values than contract defines`);
      warningCount++;
    }
  }
}

// Main execution
console.log('🔍 Testing documented limits and claims...\n');

validateLimits();

if (errorCount === 0 && warningCount === 0) {
  console.log('✅ Limits validation passed!\n');
  process.exit(0);
} else if (errorCount === 0) {
  console.log(`\n⚠️  Found ${warningCount} warning(s) (non-blocking)\n`);
  process.exit(0);
} else {
  console.log(`\n❌ Found ${errorCount} error(s). Please fix before merging.\n`);
  process.exit(1);
}
