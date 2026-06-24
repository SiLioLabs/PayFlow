# ⚡ Contributing to SoroScan

Thank you for your interest in contributing to SoroScan! We welcome contributors of all skill levels to help build the best subscription and indexer ecosystem on Stellar Soroban.

---

## 🗺️ Contribution Guide Directory

To keep our guidelines structured, we've broken them down into specialized sub-guides. Please review the relevant documents before submitting your work:

- **[🎨 Code Style Guidelines](file:///workspaces/PayFlow/docs/contributing/code_style.md)**: Python (PEP 8), TypeScript/JavaScript (ESLint/Prettier), Rust (clippy/fmt), Tailwind CSS class sorting, and SQL style.
- **[🌿 Git Workflow & Commits](file:///workspaces/PayFlow/docs/contributing/git_workflow.md)**: Branching strategy, Conventional Commit formatting, rebasing, squashing, and cherry-picking.
- **[📥 Pull Requests & Issues](file:///workspaces/PayFlow/docs/contributing/pull_request.md)**: PR templates, peer reviews, change requests, and issue triaging/labels.
- **[🤝 Community Standards & Swag](file:///workspaces/PayFlow/docs/contributing/community_standards.md)**: Code of conduct, communication norms, conflict resolution, mentorship, swag packages, and maintainership.
- **[📚 Writing Documentation](file:///workspaces/PayFlow/docs/contributing/documentation.md)**: Formatting rules (GFM), alerts, diagrams, and Docusaurus configuration details.

---

## ⚡ Development Quickstart

To quickly set up your development environment, follow the steps below:

### 🦀 Smart Contract Environment (Rust)
```bash
# 1. Install Rust
curl https://sh.rustup.rs -sSf | sh

# 2. Add WASM target
rustup target add wasm32-unknown-unknown

# 3. Install Soroban CLI
cargo install --locked soroban-cli

# 4. Clone and test
cd contract
cargo test
```

### ⚛️ Frontend Environment (React + TS)
```bash
cd frontend
npm install
cp .env.example .env.local   # Fill in VITE_CONTRACT_ID
npm run dev
```

---

## 🏷️ PR Submission Checklist

Before opening a Pull Request, confirm that:
- [ ] `cargo test` passes successfully (for contract changes).
- [ ] `npm run lint` and `npm run build` pass with zero errors (for frontend changes).
- [ ] Code conforms to the [Code Style Guidelines](file:///workspaces/PayFlow/docs/contributing/code_style.md).
- [ ] New functionality has corresponding tests in `contract/src/test.rs` or frontend test suites.
- [ ] No private environment variables or `.env` files are tracked by git.
- [ ] PR description is filled out using the template in the [Pull Request Guide](file:///workspaces/PayFlow/docs/contributing/pull_request.md).

---

## 💬 Got Questions?

If you get stuck or have questions:
1. Search the **[Troubleshooting Guide & FAQ](file:///workspaces/PayFlow/docs/troubleshooting/README.md)**.
2. Join our Discord server and post in the `#development` channel.
3. Open a GitHub Discussion under the "Q&A" category.
