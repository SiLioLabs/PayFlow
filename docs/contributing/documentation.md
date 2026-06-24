# 📚 Documentation Contributing Guide

Clear documentation is as important as working code. This guide covers how to write, format, structure, and submit changes to SoroScan's documentation.

---

## 🛠️ How to Write Documentation

SoroScan documentation is written in **GitHub Flavored Markdown (GFM)**. When writing docs:
- **Be Concise**: Write clear, direct sentences. Avoid unnecessary jargon.
- **Provide Context**: Always start with a brief summary explaining *why* the concept or feature matters.
- **Include Code Snippets**: Provide copy-pasteable, verified CLI commands, Rust code, or JavaScript code blocks.
- **Link Proactively**: Link to other relevant sections or source code files. Use standard markdown links.

---

## 🎨 Documentation Style Guide

Follow these styling conventions to maintain visual consistency:

### 1. File Links & Code Symbols
- Format file paths and directories as links: `[main.rs](file:///workspaces/PayFlow/contract/src/lib.rs)`.
- Use code blocks for commands, types, and variables: `` `Address` `` or `` `cargo test` ``.
- Do not wrap file links inside code backticks.
  - *Correct*: `[lib.rs](file:///workspaces/PayFlow/contract/src/lib.rs)`
  - *Incorrect*: `` [`lib.rs`](file:///workspaces/PayFlow/contract/src/lib.rs) ``

### 2. GitHub-Style Alerts
Use alerts strategically to draw attention to crucial information:

> [!NOTE]
> Background details, useful tips, or context.

> [!IMPORTANT]
> Essential steps or information that is critical to follow.

> [!WARNING]
> Warnings about actions that could cause errors, data loss, or downtime.

---

## 🦕 Adding to Docusaurus

SoroScan's documentation is powered by **Docusaurus**. Follow these steps to add new documentation categories or files:

### 1. Place Markdown Files
New markdown documents must be stored in the appropriate subdirectories of the `docs/` folder:
- **Architecture**: `docs/architecture/`
- **Database**: `docs/database/`
- **Contributing**: `docs/contributing/`
- **Troubleshooting**: `docs/troubleshooting/`

### 2. Update the Sidebar (`sidebars.js`)
If you add a new file, register it in `sidebars.js` (located in the root of the Docusaurus setup) to ensure it appears in the sidebar navigation:

```javascript
module.exports = {
  mySidebar: [
    {
      type: 'category',
      label: 'Contributing Guide',
      items: [
        'contributing/code_style',
        'contributing/git_workflow',
        'contributing/pull_request',
        'contributing/community_standards',
        'contributing/documentation', // New file registered
      ],
    },
  ],
};
```

### 3. Front Matter
Include standard metadata at the top of your markdown files:
```yaml
---
id: documentation
title: Documentation Guidelines
sidebar_label: Writing Docs
description: Guidelines for writing and editing Docusaurus documentation for SoroScan.
---
```

---

## 🔍 Reviewing Documentation PRs

When reviewing documentation PRs, maintainers verify:
1. **Broken Links**: Ensure all relative and absolute links resolve correctly.
2. **Formatting**: Confirm markdown renders correctly without broken HTML/Markdown tags.
3. **Clarity**: Verify instructions are straightforward and easy to follow.
4. **Accuracy**: Ensure the command flags, APIs, or settings match the code behavior.
