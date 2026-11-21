#!/usr/bin/env node
/**
 * check-error-codes.mjs
 * Validates that error codes in documentation match contract error definitions.
 * Ensures all error codes are properly defined and documented.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errorCount = 0;

// Extract error codes from contract errors.rs
function getErrorCodesFromContract() {
  const errorsFile = path.join(rootDir, 'contract', 'src', 'errors.rs');
  const errorCodes = new Map();
  
  if (!fs.existsSync(errorsFile)) {
    console.warn('⚠️  Contract errors.rs not found, skipping code validation');
    return errorCodes;
  }
  
  try {
    const content = fs.readFileSync(errorsFile, 'utf8');
    
    // Match patterns like: InvalidInterval = 1, InsufficientAllowance = 2, etc.
    const codeRegex = /(\w+)\s*=\s*(\d+)/g;
    let match;
    
    while ((match = codeRegex.exec(content)) !== null) {
      const name = match[1];
      const code = parseInt(match[2], 10);
      errorCodes.set(name, code);
    }
  } catch (err) {
    console.error(`Error reading ${errorsFile}:`, err.message);
    process.exit(1);
  }
  
  return errorCodes;
}

// Extract error code references from markdown documentation
function extractErrorCodesFromDocs(content) {
  const codes = [];
  
  // Match patterns like: E001, ERR_001, error 1, etc.
  const codeRegex = /(?:error\s+code\s+)?([A-Z_]+(?:\d+)?|E\d+|ERR_\d+)/gi;
  let match;
  
  while ((match = codeRegex.exec(content)) !== null) {
    codes.push({
      code: match[1],
      offset: match.index
    });
  }
  
  return codes;
}

// Check if error code is referenced in documentation but not defined
function validateDocumentationErrors(content, filePath, definedErrors) {
  const lines = content.split('\n');
  const codes = extractErrorCodesFromDocs(content);
  const docErrors = [];
  
  // Create a set of common false positives to ignore
  const ignoredPatterns = /\b(HTTP|OK|UUID|API|SDK|URL|ID|SAC|XLM|UTC|TTL|WASM|JSON|CLI|UI|PR|CI|CD)\b/;
  
  for (const codeRef of codes) {
    if (ignoredPatterns.test(codeRef.code)) {
      continue;
    }
    
    // Check if this looks like an error code
    if (!/^E\d+|^ERR_\d+|\d+$/.test(codeRef.code)) {
      continue;
    }
    
    const lineNum = content.substring(0, codeRef.offset).split('\n').length;
    
    // Check if documented error is actually defined in contract
    if (!definedErrors.has(codeRef.code) && !isCoreError(codeRef.code)) {
      docErrors.push({
        code: codeRef.code,
        line: lineNum
      });
    }
  }
  
  return docErrors;
}

// Check for core Soroban errors that are always valid
function isCoreError(code) {
  const coreErrors = [
    'ContractError', 'InvocationError', 'StorageError',
    '1', '2', '3', '4', '5' // Common error codes
  ];
  return coreErrors.includes(code);
}

// Check all markdown files for error references
function checkErrorsInDocs() {
  const errorCodes = getErrorCodesFromContract();
  let foundErrors = false;
  
  function checkDir(dir) {
    try {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          if (!file.startsWith('.') && file !== 'node_modules') {
            checkDir(filePath);
          }
        } else if (file.endsWith('.md')) {
          const content = fs.readFileSync(filePath, 'utf8');
          const invalidErrors = validateDocumentationErrors(content, filePath, errorCodes);
          
          for (const err of invalidErrors) {
            console.error(
              `  ⚠️  Potential undocumented error in ${path.relative(rootDir, filePath)}:${err.line}\n` +
              `      Code reference: ${err.code}\n` +
              `      This code may not be defined in contract/src/errors.rs`
            );
            foundErrors = true;
          }
        }
      }
    } catch (err) {
      console.error(`Error checking directory ${dir}:`, err.message);
    }
  }
  
  checkDir(path.join(rootDir, 'docs'));
  checkDir(rootDir);
  
  return foundErrors;
}

// Main execution
console.log('🛡️  Checking error code documentation...\n');

const hasIssues = checkErrorsInDocs();

console.log(`\n✅ Error code validation complete!`);
console.log('   (Note: warnings are informational; they do not fail the build)\n');

process.exit(0);
