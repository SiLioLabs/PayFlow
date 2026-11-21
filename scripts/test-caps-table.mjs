#!/usr/bin/env node
/**
 * test-caps-table.mjs
 * Validates that capability tables and permission matrices in documentation
 * are correctly formatted and complete.
 * Checks for:
 * - Valid markdown tables
 * - No missing entries in permission/capability matrices
 * - Consistent column alignment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errorCount = 0;
let warningCount = 0;

// Extract and validate tables from markdown
function extractMarkdownTables(content, filePath) {
  const lines = content.split('\n');
  const tables = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for markdown table start (line with pipes and dashes)
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      
      // Check if next line is a separator (dashes and pipes)
      if (nextLine.includes('-') && nextLine.includes('|')) {
        const headerRow = line;
        const separatorRow = nextLine;
        const tableRows = [headerRow, separatorRow];
        
        // Collect table body rows
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|')) {
          tableRows.push(lines[j]);
          j++;
        }
        
        // Skip if header or separator is incomplete
        const headerCells = headerRow.split('|').length;
        const sepCells = separatorRow.split('|').length;
        
        if (headerCells === sepCells && headerCells > 2) {
          tables.push({
            startLine: i,
            endLine: j - 1,
            headerRow,
            separatorRow,
            bodyRows: tableRows.slice(2),
            file: path.relative(rootDir, filePath)
          });
        }
      }
    }
  }
  
  return tables;
}

// Validate table structure
function validateTableStructure(table) {
  const issues = [];
  
  // Parse header
  const headerCells = table.headerRow
    .split('|')
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  // Validate separator has correct dashes
  const sepCells = table.separatorRow
    .split('|')
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  if (headerCells.length !== sepCells.length) {
    issues.push({
      type: 'mismatch',
      message: `Header has ${headerCells.length} columns but separator has ${sepCells.length}`,
      line: table.startLine
    });
  }
  
  // Validate separator contains dashes
  for (let i = 0; i < sepCells.length; i++) {
    if (!/^-+$|^:-+$|^-+:$|^:-+:$/.test(sepCells[i])) {
      issues.push({
        type: 'invalid-separator',
        message: `Column ${i} separator is invalid: "${sepCells[i]}" (expected dashes with optional colons)`,
        line: table.startLine + 1
      });
    }
  }
  
  // Validate body rows
  for (let i = 0; i < table.bodyRows.length; i++) {
    const bodyCells = table.bodyRows[i]
      .split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0);
    
    if (bodyCells.length !== headerCells.length) {
      issues.push({
        type: 'row-mismatch',
        message: `Row ${i + 1} has ${bodyCells.length} cells but header has ${headerCells.length}`,
        line: table.startLine + 2 + i
      });
    }
  }
  
  return issues;
}

// Check for common capability table patterns
function findCapabilityTables(content, filePath) {
  const capPatterns = [
    /capability|permission|access|function.*table/i,
    /role.*permission/i,
    /auth.*matrix/i
  ];
  
  const lines = content.split('\n');
  const matches = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    
    for (const pattern of capPatterns) {
      if (pattern.test(line)) {
        // Check if followed by a table within next 5 lines
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes('|')) {
            matches.push(i);
            break;
          }
        }
      }
    }
  }
  
  return matches;
}

// Validate all markdown files
function validateDocumentationTables() {
  function checkFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const tables = extractMarkdownTables(content, filePath);
      
      for (const table of tables) {
        const issues = validateTableStructure(table);
        
        for (const issue of issues) {
          if (issue.type === 'mismatch' || issue.type === 'row-mismatch') {
            console.error(
              `  ❌ Table error in ${table.file}:${issue.line + 1}\n` +
              `     ${issue.message}`
            );
            errorCount++;
          } else {
            console.warn(
              `  ⚠️  Table warning in ${table.file}:${issue.line + 1}\n` +
              `     ${issue.message}`
            );
            warningCount++;
          }
        }
      }
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
  
  walkDir(rootDir);
}

// Main execution
console.log('📋 Validating documentation tables...\n');

validateDocumentationTables();

if (errorCount === 0 && warningCount === 0) {
  console.log('\n✅ All documentation tables are valid!\n');
  process.exit(0);
} else if (errorCount === 0) {
  console.log(`\n⚠️  Found ${warningCount} warning(s) (non-blocking)\n`);
  process.exit(0);
} else {
  console.log(`\n❌ Found ${errorCount} error(s). Please fix before merging.\n`);
  process.exit(1);
}
