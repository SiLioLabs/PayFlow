# Testnet Account Data

## ⚠️ Security Notice

This directory contains **locally generated testnet account secrets** that must **NEVER** be committed to version control.

## Files

- **`testnet-accounts.json`** _(gitignored)_: Generated locally by `testnet-setup.ts`. Contains secret keys for testnet testing. This file is automatically created when you run the setup script.

- **`testnet-accounts.example.json`**: Template file showing the expected structure. Contains placeholder values only. Safe to commit.

## Setup

### First Time Setup

1. Run the testnet setup script:
   ```bash
   npm run testnet:setup
   # or
   npx tsx scripts/testnet-setup.ts
   ```

2. The script will:
   - Generate fresh random keypairs for admin, merchant, and subscriber accounts
   - Fund them via Stellar's testnet friendbot
   - Save credentials to `testnet-accounts.json` (automatically gitignored)

3. The generated `testnet-accounts.json` will never be tracked by git

### Reset Accounts

To generate fresh accounts:
```bash
npm run testnet:setup --reset
```

This will:
- Backup the existing `testnet-accounts.json` to `testnet-accounts.json.bak`
- Generate new random keypairs
- Fund the new accounts

## Security Best Practices

✅ **DO:**
- Let the setup script generate accounts automatically
- Keep `testnet-accounts.json` local only
- Use `.example.json` files for documentation
- Run secret scanning before commits (`gitleaks`)

❌ **DON'T:**
- Commit `testnet-accounts.json` to git
- Share secret keys in chat/email
- Use these keys for mainnet (they're testnet only)
- Remove `testnet-accounts.json` from `.gitignore`

## Secret Scanning

This repository uses `gitleaks` for secret detection:

```bash
# Install gitleaks
brew install gitleaks  # macOS
# or see https://github.com/gitleaks/gitleaks

# Scan for secrets
gitleaks detect --config .gitleaks.toml

# Scan staged changes (pre-commit)
gitleaks protect --staged --config .gitleaks.toml
```

The pre-commit hook automatically runs secret scanning to prevent accidental commits of sensitive data.

## Historical Note

**Previous committed secrets are considered burned.** If you cloned this repository before the security fix, the secret keys that were previously tracked in git history should not be used for any purpose. The setup script generates fresh keys automatically.
