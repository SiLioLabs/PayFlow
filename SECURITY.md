# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in PayFlow, please report it by emailing the maintainers or opening a private security advisory on GitHub. Do not open public issues for security vulnerabilities.

## Secret Management

### Testnet Keys

**All testnet secret keys previously committed to this repository are considered burned and should not be used.**

As of commit [this security fix], the repository has been cleaned to:
- Remove `scripts/data/testnet-accounts.json` from version control
- Add `.gitignore` rules to prevent future commits of secret files
- Implement pre-commit secret scanning with `gitleaks`
- Generate testnet accounts locally on-demand

### Historical Context

Prior to this security fix, `scripts/data/testnet-accounts.json` was tracked in git and contained Stellar secret keys for testnet accounts. While these were testnet-only keys with no mainnet value, their presence in the repository normalized committing secrets and created a poor security precedent.

**If you cloned this repository before this fix:** The old secret keys remain in git history and should be considered compromised. Do not use them. The `testnet-setup.ts` script now generates fresh random keypairs automatically.

### Current Security Measures

1. **Local Generation**: All testnet account keypairs are generated locally by `testnet-setup.ts`
2. **Gitignored**: `testnet-accounts.json` and all `*.local.json` files are excluded from git
3. **Secret Scanning**: Pre-commit hooks run `gitleaks` to detect accidentally staged secrets
4. **Example Files**: `testnet-accounts.example.json` provides structure without secrets
5. **Documentation**: Clear warnings in README files about secret handling

## Secret Scanning Setup

### Install Gitleaks

```bash
# macOS
brew install gitleaks

# Linux
wget https://github.com/gitleaks/gitleaks/releases/download/v8.18.0/gitleaks_8.18.0_linux_x64.tar.gz
tar -xzf gitleaks_8.18.0_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/

# Windows
choco install gitleaks
```

### Manual Scanning

```bash
# Scan entire repository
gitleaks detect --config .gitleaks.toml --verbose

# Scan staged changes (pre-commit)
gitleaks protect --staged --config .gitleaks.toml --verbose

# Scan specific commits
gitleaks detect --log-opts="--all" --config .gitleaks.toml
```

### Pre-commit Hook

The repository includes a pre-commit hook at `.husky/pre-commit-secret-scan` that automatically runs gitleaks. To enable:

```bash
npm install  # Installs husky and sets up git hooks
```

If gitleaks is not installed, the hook will warn but allow the commit (enforced in CI instead).

## Best Practices

### For Contributors

✅ **DO:**
- Run `gitleaks detect` before pushing
- Use `.example` or `.template` files for configuration templates
- Store secrets in environment variables or secure credential stores
- Use `.gitignore` for any files containing sensitive data
- Review git history before making repositories public

❌ **DON'T:**
- Commit secret keys, passwords, or API tokens
- Store secrets in configuration files tracked by git
- Use production credentials in test/development code
- Share secret keys via email, chat, or screenshots
- Reuse testnet keys for mainnet

### For Maintainers

- Regularly audit `.gitignore` for complete coverage
- Review PRs for accidentally committed secrets
- Rotate any secrets that are accidentally exposed
- Keep secret scanning tools updated
- Document security practices clearly

## Mainnet Deployment

**CRITICAL**: Never use testnet keys, development seeds, or any credentials from this repository for mainnet deployments. Always:

1. Generate fresh keypairs for mainnet
2. Use hardware wallets or secure key management systems for mainnet admin keys
3. Store mainnet secrets in encrypted vaults (1Password, AWS Secrets Manager, etc.)
4. Enable multi-signature for critical mainnet operations
5. Regularly rotate credentials and audit access logs

## Incident Response

If secrets are accidentally committed:

1. **Immediately** rotate the exposed credentials
2. Remove the secret from git history using `git filter-repo` or similar
3. Update `.gitignore` to prevent recurrence
4. Notify affected users if necessary
5. Document the incident and remediation steps

## CI/CD Security

The CI pipeline enforces:
- Secret scanning with gitleaks (fails on detection)
- No `testnet-accounts.json` in committed files
- Linting and security audits on dependencies

## Contact

For security concerns, contact the maintainers via GitHub security advisories or the project's designated security contact.
