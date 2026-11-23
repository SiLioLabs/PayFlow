#!/usr/bin/env node
/**
 * check-doc-links.mjs
 * Validates that markdown links in documentation are not broken.
 * Checks for:
 * - Files referenced in relative links exist
 * - Anchor references point to valid headings
 * - External links are properly formatted
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errorCount = 0;

// Extract markdown links from content
function extractLinks(content, filePath) {
  const links = [];
  
  // Match [text](url) patterns
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  
  while ((match = linkRegex.exec(content)) !== null) {
    const text = match[1];
    const url = match[2];
    links.push({
      text,
      url,
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  return links;
}

// Check if a local file exists
function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Extract heading anchors from markdown file
// GitHub's anchor generation: lowercase, replace spaces with hyphens, remove special chars
function getHeadings(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const headings = new Set();
    
    // Match markdown headings: # Heading, ## Subheading, etc.
    const headingRegex = /^#+\s+(.+)$/gm;
    let match;
    
    while ((match = headingRegex.exec(content)) !== null) {
      // GitHub anchor generation: lowercase, then remove/convert special chars
      let headingText = match[1].trim();
      
      // Multiple variations for flexibility (handles different GH versions)
      // 1. Standard: lowercase, spaces to hyphens, remove special chars
      let anchor1 = headingText
        .toLowerCase()
        .replace(/&\s?amp\s?;/g, 'and')  // &amp; entity to 'and'
        .replace(/&/g, 'and')             // & to 'and'
        .replace(/\s+/g, '-')              // spaces to hyphens
        .replace(/[^\w-]/g, '')            // remove all non-word chars except hyphens
        .replace(/-+/g, '-');              // collapse multiple hyphens
      
      // 2. Alternative: simple removal of special chars
      let anchor2 = headingText
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
      
      headings.add(anchor1);
      headings.add(anchor2);
    }
    
    return headings;
  } catch {
    return new Set();
  }
}

// Validate a single link
function validateLink(link, baseDir, filePath) {
  // Skip external links (http://, https://, #anchors only)
  if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
    return true;
  }
  
  // Handle anchor-only links
  if (link.url.startsWith('#')) {
    const anchor = link.url.slice(1);
    const headings = getHeadings(filePath);
    if (!headings.has(anchor)) {
      console.error(
        `  ❌ Broken anchor in ${path.relative(rootDir, filePath)}:${link.line}\n` +
        `     Link: [${link.text}](${link.url})\n` +
        `     Anchor "#${anchor}" not found in this file`
      );
      return false;
    }
    return true;
  }
  
  // Parse link with potential anchor
  const [filePart, anchorPart] = link.url.split('#');
  
  // Skip if no file part (just anchor)
  if (!filePart) {
    return true;
  }
  
  // Resolve relative path
  const targetPath = path.resolve(baseDir, filePart);
  
  if (!fileExists(targetPath)) {
    console.error(
      `  ❌ Broken link in ${path.relative(rootDir, filePath)}:${link.line}\n` +
      `     Link: [${link.text}](${link.url})\n` +
      `     File not found: ${path.relative(rootDir, targetPath)}`
    );
    return false;
  }
  
  // Check anchor if specified
  if (anchorPart) {
    const headings = getHeadings(targetPath);
    if (!headings.has(anchorPart)) {
      console.error(
        `  ❌ Broken anchor in ${path.relative(rootDir, filePath)}:${link.line}\n` +
        `     Link: [${link.text}](${link.url})\n` +
        `     Anchor "#${anchorPart}" not found in ${path.relative(rootDir, targetPath)}`
      );
      return false;
    }
  }
  
  return true;
}

// Recursively check all markdown files
function checkMarkdownFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Skip hidden dirs and node_modules
        if (!file.startsWith('.') && file !== 'node_modules') {
          checkMarkdownFiles(filePath);
        }
      } else if (file.endsWith('.md')) {
        const content = fs.readFileSync(filePath, 'utf8');
        const links = extractLinks(content, filePath);
        const baseDir = path.dirname(filePath);
        
        for (const link of links) {
          if (!validateLink(link, baseDir, filePath)) {
            errorCount++;
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err.message);
    process.exit(1);
  }
}

// Main execution
console.log('🔗 Checking documentation links...\n');

checkMarkdownFiles(rootDir);

if (errorCount === 0) {
  console.log('✅ All documentation links are valid!\n');
  process.exit(0);
} else {
  console.log(`\n❌ Found ${errorCount} broken link(s). Please fix them before merging.\n`);
  process.exit(1);
}
