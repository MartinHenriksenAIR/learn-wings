---
id: "ADR-0010"
title: "Secrets and Environment Variables Must Never Be Committed to Git"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['security', 'secrets', 'environment', 'gitignore']
policy:
  rationales: ['Secrets committed to git are permanently exposed in history, CI artifacts, and clones — rotation alone does not remediate', 'VITE_ prefixed variables are bundled into the browser bundle and must never contain secrets', 'Azure Key Vault is the designated secrets store for all production credentials']approval_date: 2026-05-19
approval_notes: "HIGH severity finding from differential security review 2026-05-19 (F-01). .env tracked since commit 43a079e. Immediate mitigation: git rm --cached .env, .gitignore updated (commit 8c292bb). Full remediation: Supabase project decommission at migration cutover."

---

## Context

On 2026-01-27 (commit 43a079e), a .env file containing VITE_SUPABASE_PROJECT_ID, VITE_SUPABASE_PUBLISHABLE_KEY, and VITE_SUPABASE_URL was committed to git by the Lovable platform bot. The file was tracked for ~4 months before detection via differential security review on 2026-05-19. CI/CD workflows uploading the full repo checkout (path: .) meant the .env was included in every GitHub Actions artifact (90-day retention). Although the Supabase anon key is a low-privilege client credential by design, tracking secrets in git creates permanent exposure in commit history, CI artifacts, and any clone of the repository. Full remediation requires decommissioning the Supabase project at migration cutover.

## Decision

Never commit .env files or any file containing secrets, API keys, tokens, passwords, or credentials to git. All secrets live in Azure Key Vault (production) or local .env files (development). .env and .env.* are added to .gitignore. Don't commit .env.local, .env.development, .env.production, or any variant. Don't store secrets in vite.config.ts, source files, or GitHub Actions workflow YAML. Don't use VITE_ prefixed env vars for secrets — VITE_ vars are bundled into the browser. Runtime secrets (DATABASE_URL, RESEND_API_KEY, storage keys) go in Azure Key Vault referenced via @Microsoft.KeyVault(...) in Function App application settings. Development secrets go in .env (gitignored) only.

## Consequences

Positive: Secrets never appear in git history, CI artifacts, or clones. Key rotation is possible without rewriting git history. Azure Key Vault provides audit trail and RBAC for all production secrets. Negative: Developers must manually create .env from .env.example on first checkout. CI/CD must use GitHub Actions secrets or Key Vault references — no plaintext in workflow YAML. Historical exposure of commit 43a079e persists in git history; full remediation requires Supabase project decommission at cutover.

## Alternatives

1. git-crypt / SOPS — rejected: adds key management overhead; Key Vault already available in Azure subscription. 2. Allow anon keys in git (treat as public) — rejected: normalises secrets-in-git pattern, creates precedent for committing higher-privilege keys. 3. GitHub secret scanning only — rejected: detection after the fact; prevention via .gitignore is the correct control.
